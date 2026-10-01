import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  AttributeGroup,
  AttributeOption,
  CashAccountBalance,
  CategoryDefinition,
  InvestmentAccountBalance,
  MonthCreationPolicy,
  TagDefinition,
  TaxonomyRemoval,
  TaxonomyWorkspace
} from "../types/configuration";
import type {
  AnnualOverview
} from "../types/analysis";
import type {
  CategoryBackfillPreview,
  CategoryBackfillRequest,
  CategoryBackfillResult,
  ProductHistoryIndexResult,
  ProductHistoryQuery,
  ProductHistoryResult,
  ProductRenamePreview,
  ProductRenameRequest,
  ProductRenameResult,
  CounterpartyRenamePreview,
  CounterpartyRenameRequest,
  CounterpartyRenameResult
} from "../types/history";
import type {
  CurrentAsset,
  DebtRecord,
  FixedAsset,
  MonthSectionSaveRequest,
  MonthOverview,
  MonthWorkspace
} from "../types/month";
import type {
  RuleCandidate,
  SavedRule,
  RuleWorkspaceAnalytics,
  RuleWorkspaceShell,
  RuleImpactPreview
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import type { AnalysisRuntimeSettings } from "../types/settings";
import type {
  OperationLogSummary,
  OperationAuditContext,
  OperationKind,
  OperationPreview
} from "../types/operations";
import { calculateMonthly } from "../domain/calculator";
import {
  isMonth,
  localMonth,
  localTimestamp,
  monthEnd,
  nextMonth
} from "../domain/dates";
import { roundHalfEven, sum } from "../domain/money";
import { DatabaseManager } from "./DatabaseManager";
import { AnalysisReadModel } from "./analysisReadModel";
import { ConfigurationWriteRepository } from "./configurationWriteRepository";
import { HistoryWriteRepository } from "./historyWriteRepository";
import { MonthWriteRepository } from "./monthWriteRepository";
import { RuleHistoryReadModel } from "./ruleHistoryReadModel";
import { OperationLogRepository } from "./operationLogRepository";
import {
  boolean,
  contentRevision,
  debtFromRow,
  fixedAssetFromRow,
  RepositoryValidationError,
  RevisionConflictError,
  rows,
  text,
  transactionFromRow,
  type Row
} from "./repositoryPrimitives";
import type { ValidationIssue } from "../domain/validators";
import type {
  ConfigurationWriteDependencies,
  HistoryWriteDependencies,
  MonthWriteDependencies
} from "./repositoryWriteContext";

export class AssetTrackRepository {
  private readonly options: AnalysisRuntimeSettings;
  private readonly analysis: AnalysisReadModel;
  private readonly ruleHistory: RuleHistoryReadModel;
  private readonly monthWrites: MonthWriteRepository;
  private readonly configurationWrites: ConfigurationWriteRepository;
  private readonly historyWrites: HistoryWriteRepository;
  private readonly operations: OperationLogRepository;
  private monthsCache: string[] | null = null;

  constructor(
    private readonly manager: DatabaseManager,
    options: AnalysisRuntimeSettings = {
      reconciliationTolerance: 100
    }
  ) {
    this.options = { ...options };
    this.analysis = new AnalysisReadModel({
      reconciliationTolerance: this.options.reconciliationTolerance,
      getMonths: (db) => this.getMonths(db),
      savedMonths: (db) => this.savedMonths(db),
      categoryDefinitions: (db) => this.categoryDefinitions(db),
      attributeGroups: (db) => this.attributeGroups(db),
      attributeOptions: (db) => this.attributeOptions(db),
      tagDefinitions: (db) => this.tagDefinitions(db),
      cashAccounts: (db, month) => this.cashAccounts(db, month),
      investmentAccounts: (db, month) => this.investmentAccounts(db, month)
    });
    this.ruleHistory = new RuleHistoryReadModel({
      categoryDefinitions: (db) => this.categoryDefinitions(db),
      categories: (db) => this.categories(db),
      savedMonths: (db) => this.savedMonths(db),
      getRevision: (month, db) => this.getRevision(month, db)
    });
    const monthDependencies: MonthWriteDependencies = {
      monthStatus: (db, month) => this.monthStatus(db, month),
      checkMonthRevision: (db, month, revision) =>
        this.checkMonthRevision(db, month, revision),
      touchMonth: (db, month, revision, fixedInitialized) =>
        this.touchMonth(db, month, revision, fixedInitialized),
      getMonths: (db) => this.getMonths(db),
      getRevision: (month, db) => this.getRevision(month, db),
      categoryDefinitions: (db) => this.categoryDefinitions(db),
      debts: (db) => this.debts(db),
      monthDebts: (db, month) => this.monthDebts(db, month),
      rules: (db) => this.rules(db),
    };
    const configurationDependencies: ConfigurationWriteDependencies = {
      categoryDefinitions: (db) => this.categoryDefinitions(db),
      categories: (db) => this.categories(db),
      accounts: (db) => this.accounts(db),
      rules: (db) => this.rules(db),
      bumpMonthRevision: (db, month) => this.bumpMonthRevision(db, month)
    };
    const historyDependencies: HistoryWriteDependencies = {
      categoryDefinitions: (db) => this.categoryDefinitions(db),
      normalizedRuleRows: (db) => this.ruleHistory.normalizedRuleRows(db),
      historicalCategoryCounts: (group, categories) =>
        this.ruleHistory.historicalCategoryCounts(group, categories),
      getRevision: (month, db) => this.getRevision(month, db),
      touchMonth: (db, month, revision, fixedInitialized) =>
        this.touchMonth(db, month, revision, fixedInitialized)
    };
    this.monthWrites = new MonthWriteRepository(monthDependencies);
    this.configurationWrites = new ConfigurationWriteRepository(configurationDependencies);
    this.historyWrites = new HistoryWriteRepository(historyDependencies);
    this.operations = new OperationLogRepository();
  }

  initialize(): void {
    this.manager.open();
  }

  invalidateCaches(): void {
    this.monthsCache = null;
  }

  updateRuntimeSettings(settings: AnalysisRuntimeSettings): void {
    Object.assign(this.options, settings);
    this.analysis.updateRuntimeSettings(settings);
  }

  private db(): DatabaseSync {
    return this.manager.connection();
  }

  private entityOperation(
    before: Row[],
    after: Row[],
    entity: "category" | "rule",
    operationType: Extract<OperationKind, "save-categories" | "save-rules">,
    audit: OperationAuditContext
  ): OperationPreview {
    const keyOf = (row: Row): string => entity === "category"
      ? text(row.category_key)
      : String(Number(row.id));
    const beforeByKey = new Map(before.map((row) => [keyOf(row), row]));
    const afterByKey = new Map(after.map((row) => [keyOf(row), row]));
    const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
    const changes = keys.map((key) => {
      const oldRow = beforeByKey.get(key) ?? {};
      const newRow = afterByKey.get(key) ?? {};
      const changed = JSON.stringify(oldRow) !== JSON.stringify(newRow);
      return {
        transaction_id: null,
        transaction_key: `${entity}:${key}`,
        month: "",
        before: oldRow,
        after: newRow,
        status: changed ? "change" as const : "skip" as const,
        reason: changed ? undefined : "保存前后没有字段变化"
      };
    });
    const effectiveOperationType = audit.operation_type ?? operationType;
    return {
      operation_id: audit.operation_id ?? randomUUID(),
      actor: audit.actor ?? "local-user",
      operation_type: effectiveOperationType,
      source_page: audit.source_page,
      business_tab: audit.business_tab,
      total_count: changes.length,
      change_count: changes.filter((change) => change.status === "change").length,
      skipped_count: changes.filter((change) => change.status === "skip").length,
      failure_count: 0,
      changes,
      metadata: {
        entity,
        actor: audit.actor ?? "local-user",
        ...(audit.metadata ?? {})
      }
    };
  }

  private historicalTransactionRows(db: DatabaseSync, ids: number[]): Row[] {
    const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!uniqueIds.length) return [];
    const placeholders = uniqueIds.map(() => "?").join(",");
    return rows(db.prepare(`
      SELECT id,month,transaction_date,type,category_key,category,counterparty,product,source,account_key,amount
      FROM transactions WHERE id IN (${placeholders}) ORDER BY month,transaction_date,id
    `).all(...uniqueIds));
  }

  private historyOperation(
    before: Row[],
    after: Row[],
    operationType: Extract<OperationKind, "history-category-backfill" | "history-product-rename" | "history-counterparty-rename">,
    audit: OperationAuditContext,
    metadata: Record<string, unknown>
  ): OperationPreview {
    const beforeById = new Map(before.map((row) => [Number(row.id), row]));
    const afterById = new Map(after.map((row) => [Number(row.id), row]));
    const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort((left, right) => left - right);
    const changes = ids.map((id) => {
      const oldRow = beforeById.get(id) ?? {};
      const newRow = afterById.get(id) ?? {};
      const changed = JSON.stringify(oldRow) !== JSON.stringify(newRow);
      return {
        transaction_id: Number.isFinite(id) ? id : null,
        transaction_key: `id:${id}`,
        month: text(newRow.month) || text(oldRow.month),
        before: oldRow,
        after: newRow,
        status: changed ? "change" as const : "skip" as const,
        reason: changed ? undefined : "保存前后没有字段变化"
      };
    });
    return {
      operation_id: audit.operation_id ?? randomUUID(),
      actor: audit.actor ?? "local-user",
      operation_type: operationType,
      source_page: audit.source_page,
      business_tab: audit.business_tab,
      total_count: changes.length,
      change_count: changes.filter((change) => change.status === "change").length,
      skipped_count: changes.filter((change) => change.status === "skip").length,
      failure_count: 0,
      changes,
      metadata: { ...metadata, actor: audit.actor ?? "local-user" }
    };
  }

  private monthStatus(db: DatabaseSync, month: string): Row | null {
    const row = (db.prepare("SELECT * FROM month_status WHERE month=?").get(month) as Row | undefined)
      ?? null;
    if (row && !["draft", "saved", "locked"].includes(text(row.status))) {
      throw new RepositoryValidationError({
        code: "month.status_invalid",
        params: { month, status: text(row.status) }
      });
    }
    return row;
  }

  private checkMonthRevision(
    db: DatabaseSync,
    month: string,
    expectedRevision: number
  ): number {
    if (!isMonth(month)) throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    const actual = Number(this.monthStatus(db, month)?.revision ?? 0);
    if (actual !== expectedRevision) throw new RevisionConflictError(expectedRevision, actual);
    return actual;
  }

  private touchMonth(
    db: DatabaseSync,
    month: string,
    revision: number,
    fixedInitialized?: number
  ): number {
    const current = this.monthStatus(db, month);
    if (current?.status === "locked") {
      throw new RepositoryValidationError({
        code: "month.locked",
        params: { month }
      });
    }
    const initialized = fixedInitialized ?? Number(current?.fixed_assets_initialized ?? 0);
    const nextRevision = revision + 1;
    db.prepare(`
      INSERT INTO month_status
        (month,status,updated_at,fixed_assets_initialized,revision)
      VALUES (?, 'saved', ?, ?, ?)
      ON CONFLICT(month) DO UPDATE SET
        status=excluded.status,
        updated_at=excluded.updated_at,
        fixed_assets_initialized=excluded.fixed_assets_initialized,
        revision=excluded.revision
    `).run(month, localTimestamp(), initialized, nextRevision);
    return nextRevision;
  }

  private bumpMonthRevision(db: DatabaseSync, month: string): number {
    const current = this.monthStatus(db, month);
    if (!current) return 0;
    if (current.status === "locked") {
      throw new RepositoryValidationError({
        code: "month.locked",
        params: { month }
      });
    }
    const revision = Number(current.revision ?? 0) + 1;
    db.prepare(
      "UPDATE month_status SET revision=?,updated_at=? WHERE month=?"
    ).run(revision, localTimestamp(), month);
    return revision;
  }

  getMonths(db = this.db()): string[] {
    if (this.monthsCache) return [...this.monthsCache];
    const result = rows(db.prepare(`
      SELECT DISTINCT month
      FROM (
        SELECT month FROM cash_account_balances
        UNION ALL SELECT month FROM investment_account_balances
        UNION ALL SELECT month FROM transactions
        UNION ALL SELECT month FROM fixed_assets
        UNION ALL SELECT month FROM month_status
      )
      ORDER BY month
    `).all())
      .map((row) => text(row.month))
      .filter(isMonth);
    this.monthsCache = result;
    return [...this.monthsCache];
  }

  savedMonths(db = this.db()): string[] {
    return rows(db.prepare(
      "SELECT month,status FROM month_status ORDER BY month"
    ).all()).map((row) => {
      const status = text(row.status);
      if (!["draft", "saved", "locked"].includes(status)) {
        throw new RepositoryValidationError({
          code: "month.status_invalid",
          params: { month: text(row.month), status }
        });
      }
      return { month: text(row.month), status };
    }).filter((row) => row.status === "saved" || row.status === "locked")
      .map((row) => row.month)
      .filter(isMonth);
  }

  monthCreationPolicy(): MonthCreationPolicy {
    const db = this.db();
    const months = this.getMonths(db);
    const savedMonths = this.savedMonths(db);
    const drafts = rows(db.prepare(
      "SELECT month FROM month_status WHERE status='draft' ORDER BY month"
    ).all()).map((row) => text(row.month)).filter(isMonth);
    const current = localMonth();
    const max = nextMonth(current);
    const target = months.length ? nextMonth(months.at(-1)!) : current;
    let reason: MonthCreationPolicy["reason"] = null;
    if (drafts.length) {
      reason = { code: "month.draft_exists", params: { month: drafts[0] } };
    } else if (target > max) {
      reason = { code: "month.creation_limit", params: { max } };
    }
    return {
      months,
      saved_months: savedMonths,
      draft_month: drafts[0] ?? null,
      next_target: target,
      max_creatable_month: max,
      can_create: reason === null,
      reason
    };
  }

  async createMonth(month: string): Promise<MonthWorkspace> {
    const result = await this.manager.write((db) => {
      this.monthWrites.createMonth(db, month);
      const inherited = this.monthWrites.ensureFixedAssetsInherited(db, month);
      const workspace = this.getMonthFromDb(month, db);
      (workspace as MonthWorkspace & { inherited_fixed_assets?: number }).inherited_fixed_assets = inherited;
      return workspace;
    });
    this.monthsCache = null;
    return result;
  }

  async deleteMonth(month: string, expectedRevision: number): Promise<Record<string, unknown>> {
    const deletedRows = await this.manager.write((db) =>
      this.monthWrites.deleteMonth(db, month, expectedRevision)
    );
    this.monthsCache = null;
    return { deleted: true, month, deleted_rows: deletedRows, months: this.getMonths() };
  }

  private mapCategoryRows(result: Row[]): CategoryDefinition[] {
    return result.map((row) => ({
      category_key: text(row.category_key),
      name: text(row.name),
      transaction_type: text(row.transaction_type) as CategoryDefinition["transaction_type"],
      necessity: text(row.necessity) as CategoryDefinition["necessity"],
      pattern: text(row.pattern) as CategoryDefinition["pattern"],
      is_big_ticket: boolean(row.is_big_ticket),
      color: text(row.color),
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order),
      description: text(row.description),
      transaction_count: Number(row.transaction_count ?? 0),
      rule_count: Number(row.rule_count ?? 0),
      impact_months: text(row.impact_months).split(",").filter(Boolean).sort()
      ,attribute_keys: text(row.attribute_keys).split(",").filter(Boolean).sort()
    }));
  }

  private categoryDefinitions(db = this.db()): CategoryDefinition[] {
    return this.mapCategoryRows(rows(db.prepare(`
      SELECT d.*,
        (SELECT GROUP_CONCAT(ca.attribute_key)
         FROM category_attributes ca WHERE ca.category_key=d.category_key) AS attribute_keys,
        (SELECT COUNT(*) FROM transactions t WHERE t.category_key=d.category_key) AS transaction_count,
        (SELECT COUNT(*) FROM auto_rules r WHERE r.category_key=d.category_key) AS rule_count,
        (SELECT GROUP_CONCAT(DISTINCT t.month)
         FROM transactions t WHERE t.category_key=d.category_key) AS impact_months
      FROM category_definitions d
      ORDER BY d.sort_order,d.name
    `).all()));
  }

  categories(db = this.db()): { revision: number; rows: CategoryDefinition[] } {
    const result = this.categoryDefinitions(db);
    // Usage counters and affected months are read-only impact metadata.  They
    // change whenever a month is saved and must not make a category draft
    // stale; the editable category fields and attribute assignments do.
    const revisionRows = result.map(({
      transaction_count: _transactionCount,
      rule_count: _ruleCount,
      conflict_product_count: _conflictProductCount,
      impact_months: _impactMonths,
      ...editable
    }) => editable);
    return { revision: contentRevision(revisionRows), rows: result };
  }

  private attributeGroups(db = this.db()): AttributeGroup[] {
    return rows(db.prepare(`
      SELECT g.*,
        (SELECT COUNT(*) FROM attribute_options o WHERE o.group_key=g.group_key) AS option_count,
        (SELECT COUNT(DISTINCT ca.category_key)
         FROM attribute_options o
         JOIN category_attributes ca ON ca.attribute_key=o.attribute_key
         WHERE o.group_key=g.group_key) AS usage_count,
        (SELECT GROUP_CONCAT(DISTINCT t.month)
         FROM attribute_options o
         JOIN category_attributes ca ON ca.attribute_key=o.attribute_key
         JOIN transactions t ON t.category_key=ca.category_key
         WHERE o.group_key=g.group_key) AS impact_months
      FROM attribute_groups g
      ORDER BY g.sort_order,g.name
    `).all()).map((row) => ({
      group_key: text(row.group_key),
      name: text(row.name),
      selection_mode: "single",
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order),
      option_count: Number(row.option_count ?? 0),
      usage_count: Number(row.usage_count ?? 0),
      impact_months: text(row.impact_months).split(",").filter(Boolean).sort()
    }));
  }

  private attributeOptions(db = this.db()): AttributeOption[] {
    return rows(db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM category_attributes ca WHERE ca.attribute_key=o.attribute_key) AS category_count,
        (SELECT GROUP_CONCAT(DISTINCT t.month)
         FROM category_attributes ca
         JOIN transactions t ON t.category_key=ca.category_key
         WHERE ca.attribute_key=o.attribute_key) AS impact_months
      FROM attribute_options o
      ORDER BY o.group_key,o.sort_order,o.name
    `).all()).map((row) => ({
      attribute_key: text(row.attribute_key),
      group_key: text(row.group_key),
      name: text(row.name),
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order),
      category_count: Number(row.category_count ?? 0),
      impact_months: text(row.impact_months).split(",").filter(Boolean).sort()
    }));
  }

  private tagDefinitions(db = this.db()): TagDefinition[] {
    return rows(db.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM transaction_tags tt WHERE tt.tag_key=t.tag_key) AS transaction_count,
        (SELECT GROUP_CONCAT(DISTINCT tr.month)
         FROM transaction_tags tt JOIN transactions tr ON tr.id=tt.transaction_id
         WHERE tt.tag_key=t.tag_key) AS impact_months
      FROM tags t
      ORDER BY t.sort_order,t.name
    `).all()).map((row) => ({
      tag_key: text(row.tag_key),
      name: text(row.name),
      description: text(row.description),
      color: text(row.color),
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order),
      transaction_count: Number(row.transaction_count ?? 0),
      impact_months: text(row.impact_months).split(",").filter(Boolean).sort()
    }));
  }

  taxonomy(db = this.db()): TaxonomyWorkspace {
    const groups = this.attributeGroups(db);
    const options = this.attributeOptions(db);
    const tags = this.tagDefinitions(db);
    const categoryUses = rows(db.prepare(`SELECT ca.category_key,ca.attribute_key,o.group_key
      FROM category_attributes ca JOIN attribute_options o ON o.attribute_key=ca.attribute_key
      ORDER BY o.group_key,ca.attribute_key,ca.category_key`).all());
    const tagUses = rows(db.prepare(`SELECT tag_key,transaction_id FROM transaction_tags
      ORDER BY tag_key,transaction_id`).all());
    const groupUses = new Map<string, unknown[]>();
    const optionUses = new Map<string, unknown[]>();
    const tagUseMap = new Map<string, unknown[]>();
    categoryUses.forEach((row) => {
      const groupKey = text(row.group_key);
      const optionKey = text(row.attribute_key);
      if (!groupUses.has(groupKey)) groupUses.set(groupKey, []);
      if (!optionUses.has(optionKey)) optionUses.set(optionKey, []);
      groupUses.get(groupKey)?.push([text(row.category_key), optionKey]);
      optionUses.get(optionKey)?.push(text(row.category_key));
    });
    tagUses.forEach((row) => {
      const key = text(row.tag_key);
      if (!tagUseMap.has(key)) tagUseMap.set(key, []);
      tagUseMap.get(key)?.push(Number(row.transaction_id));
    });
    groups.forEach((group) => {
      group.usage_revision = contentRevision(groupUses.get(group.group_key) ?? []);
    });
    options.forEach((option) => {
      option.usage_revision = contentRevision(optionUses.get(option.attribute_key) ?? []);
    });
    tags.forEach((tag) => {
      tag.usage_revision = contentRevision(tagUseMap.get(tag.tag_key) ?? []);
    });
    // Revisions protect the editable definitions themselves.  Historical
    // usage counts and affected months are read-only impact metadata; they
    // change whenever a month is saved and must not make an unrelated
    // taxonomy draft stale.
    const attributeRevision = contentRevision([
      groups.map(({ group_key, name, selection_mode, is_active, sort_order }) =>
        ({ group_key, name, selection_mode, is_active, sort_order })),
      options.map(({ attribute_key, group_key, name, is_active, sort_order }) =>
        ({ attribute_key, group_key, name, is_active, sort_order }))
    ]);
    const tagRevision = contentRevision(tags.map(({
      tag_key, name, description, color, is_active, sort_order
    }) => ({ tag_key, name, description, color, is_active, sort_order })));
    return {
      attribute_revision: attributeRevision,
      tag_revision: tagRevision,
      groups,
      options,
      tags
    };
  }

  async saveCategories(
    expectedRevision: number,
    input: CategoryDefinition[],
    audit: OperationAuditContext = { source_page: "配置/分类定义" }
  ): Promise<{
    revision: number;
    rows: CategoryDefinition[];
    rules_revision: number;
  }> {
    return this.manager.write((db) => {
      const before = rows(db.prepare("SELECT * FROM category_definitions ORDER BY category_key").all());
      const beforeAttributes = new Map<string, string[]>();
      rows(db.prepare(
        "SELECT category_key,attribute_key FROM category_attributes ORDER BY category_key,attribute_key"
      ).all()).forEach((row) => {
        const categoryKey = text(row.category_key);
        const keys = beforeAttributes.get(categoryKey) ?? [];
        keys.push(text(row.attribute_key));
        beforeAttributes.set(categoryKey, keys);
      });
      this.configurationWrites.saveCategories(db, expectedRevision, input);
      // Keep migrated/previously saved assignments when an older caller does
      // not yet send the optional attribute_keys field. Newer callers can
      // explicitly send [] to clear a category's attributes.
      const categoryAttributeRows = input.filter((category) => category.attribute_keys !== undefined).map((category) => ({
        category_key: category.category_key,
        attribute_keys: [...new Set(category.attribute_keys ?? [])]
      }));
      const knownOptions = new Set(rows(db.prepare(
        "SELECT attribute_key FROM attribute_options"
      ).all()).map((row) => text(row.attribute_key)));
      const optionActive = new Map(rows(db.prepare(
        "SELECT attribute_key,is_active FROM attribute_options"
      ).all()).map((row) => [text(row.attribute_key), boolean(row.is_active)] as const));
      const groupsByOption = new Map(rows(db.prepare(
        "SELECT attribute_key,group_key FROM attribute_options"
      ).all()).map((row) => [text(row.attribute_key), text(row.group_key)] as const));
      const groupActive = new Map(rows(db.prepare(
        "SELECT group_key,is_active FROM attribute_groups"
      ).all()).map((row) => [text(row.group_key), boolean(row.is_active)] as const));
      categoryAttributeRows.forEach(({ category_key, attribute_keys }) => {
        const selectedGroups = new Set<string>();
        attribute_keys.forEach((attributeKey) => {
          if (!knownOptions.has(attributeKey)) {
            throw new RepositoryValidationError({
              code: "category.attribute_invalid",
              params: { category_key, attribute_key: attributeKey }
            });
          }
          if (optionActive.get(attributeKey) !== true
            && !(beforeAttributes.get(category_key) ?? []).includes(attributeKey)) {
            throw new RepositoryValidationError({
              code: "category.attribute_invalid",
              params: { category_key, attribute_key: attributeKey }
            });
          }
          const groupKey = groupsByOption.get(attributeKey);
          if (groupKey && groupActive.get(groupKey) !== true
            && !(beforeAttributes.get(category_key) ?? []).includes(attributeKey)) {
            throw new RepositoryValidationError({
              code: "category.attribute_invalid",
              params: { category_key, attribute_key: attributeKey }
            });
          }
          if (groupKey && selectedGroups.has(groupKey)) {
            throw new RepositoryValidationError({
              code: "category.attribute_group_duplicate",
              params: { category_key, group_key: groupKey }
            });
          }
          if (groupKey) selectedGroups.add(groupKey);
        });
        db.prepare("DELETE FROM category_attributes WHERE category_key=?").run(category_key);
        const insert = db.prepare(
          "INSERT INTO category_attributes(category_key,attribute_key) VALUES (?,?)"
        );
        attribute_keys.forEach((attributeKey) => insert.run(category_key, attributeKey));
      });
      const changedAttributeCategories = categoryAttributeRows.filter(({ category_key, attribute_keys }) =>
        JSON.stringify([...(beforeAttributes.get(category_key) ?? [])].sort())
          !== JSON.stringify([...attribute_keys].sort())
      ).map(({ category_key }) => category_key);
      const affectedMonths = new Set(rows(db.prepare(
        `SELECT DISTINCT month FROM transactions
         WHERE category_key IN (${changedAttributeCategories.length ? changedAttributeCategories.map(() => "?").join(",") : "''"})`
      ).all(...changedAttributeCategories)).map((row) => text(row.month)).filter(Boolean));
      affectedMonths.forEach((month) => this.bumpMonthRevision(db, month));
      const after = rows(db.prepare("SELECT * FROM category_definitions ORDER BY category_key").all());
      const operation = this.entityOperation(before, after, "category", "save-categories", audit);
      this.operations.write(
        db,
        operation,
        audit.selection ?? operation.changes.map((change) => change.transaction_key ?? "")
      );
      const categories = this.categories(db);
      return {
        ...categories,
        rules_revision: this.rules(db).revision
      };
    });
  }

  async saveTaxonomy(
    expectedAttributeRevision: number,
    groups: AttributeGroup[],
    options: AttributeOption[],
    expectedTagRevision: number,
    tags: TagDefinition[],
    removals: TaxonomyRemoval[] = []
  ): Promise<TaxonomyWorkspace> {
    return this.manager.write((db) => {
      const current = this.taxonomy(db);
      const currentGroups = new Map(current.groups.map((group) => [group.group_key, group]));
      const currentOptions = new Map(current.options.map((option) => [option.attribute_key, option]));
      const currentTags = new Map(current.tags.map((tag) => [tag.tag_key, tag]));
      if (current.attribute_revision !== expectedAttributeRevision) {
        throw new RevisionConflictError(expectedAttributeRevision, current.attribute_revision);
      }
      if (current.tag_revision !== expectedTagRevision) {
        throw new RevisionConflictError(expectedTagRevision, current.tag_revision);
      }
      const changedAttributeKeys = new Set<string>();
      const submittedGroupKeys = new Set(groups.map((group) => text(group.group_key)));
      const submittedOptionKeys = new Set(options.map((option) => text(option.attribute_key)));
      groups.forEach((group) => {
        const key = text(group.group_key);
        const before = currentGroups.get(key);
        if (!before || before.name !== text(group.name)
          || before.is_active !== Boolean(group.is_active)
          || before.sort_order !== Number(group.sort_order)) {
          current.options
            .filter((option) => option.group_key === key)
            .forEach((option) => changedAttributeKeys.add(option.attribute_key));
        }
      });
      currentGroups.forEach((group, key) => {
        if (!submittedGroupKeys.has(key)) {
          current.options
            .filter((option) => option.group_key === key)
            .forEach((option) => changedAttributeKeys.add(option.attribute_key));
        }
      });
      options.forEach((option) => {
        const key = text(option.attribute_key);
        const before = currentOptions.get(key);
        if (!before || before.group_key !== text(option.group_key)
          || before.name !== text(option.name)
          || before.is_active !== Boolean(option.is_active)
          || before.sort_order !== Number(option.sort_order)) {
          changedAttributeKeys.add(key);
          if (before) changedAttributeKeys.add(before.attribute_key);
        }
      });
      currentOptions.forEach((option, key) => {
        if (!submittedOptionKeys.has(key)) changedAttributeKeys.add(key);
      });
      const changedTagKeys = new Set<string>();
      const submittedTagKeys = new Set(tags.map((tag) => text(tag.tag_key)));
      tags.forEach((tag) => {
        const key = text(tag.tag_key);
        const before = currentTags.get(key);
        if (!before || before.name !== text(tag.name)
          || before.description !== text(tag.description)
          || before.color !== text(tag.color)
          || before.is_active !== Boolean(tag.is_active)
          || before.sort_order !== Number(tag.sort_order)) {
          changedTagKeys.add(key);
        }
      });
      currentTags.forEach((_tag, key) => {
        if (!submittedTagKeys.has(key)) changedTagKeys.add(key);
      });
      const groupKeys = new Set<string>();
      const groupNames = new Set<string>();
      groups.forEach((group, index) => {
        const key = text(group.group_key);
        const name = text(group.name);
        if (!key || !name || groupNames.has(name)) {
          throw new RepositoryValidationError({ code: "attribute.group_invalid", params: { row: index + 1 } });
        }
        groupKeys.add(key);
        groupNames.add(name);
        db.prepare(`
          INSERT INTO attribute_groups(group_key,name,selection_mode,is_active,sort_order)
          VALUES (?,?,'single',?,?)
          ON CONFLICT(group_key) DO UPDATE SET
            name=excluded.name,is_active=excluded.is_active,sort_order=excluded.sort_order
        `).run(key, name, group.is_active ? 1 : 0, group.sort_order);
      });
      const optionKeys = new Set<string>();
      const optionNames = new Set<string>();
      options.forEach((option, index) => {
        const key = text(option.attribute_key);
        const groupKey = text(option.group_key);
        const name = text(option.name);
        const groupNameKey = `${groupKey}\u0000${name}`;
        if (!key || !name || !groupKeys.has(groupKey) || optionKeys.has(key) || optionNames.has(groupNameKey)) {
          throw new RepositoryValidationError({ code: "attribute.option_invalid", params: { row: index + 1 } });
        }
        optionKeys.add(key);
        optionNames.add(groupNameKey);
        db.prepare(`
          INSERT INTO attribute_options(attribute_key,group_key,name,is_active,sort_order)
          VALUES (?,?,?,?,?)
          ON CONFLICT(attribute_key) DO UPDATE SET
            group_key=excluded.group_key,name=excluded.name,
            is_active=excluded.is_active,sort_order=excluded.sort_order
        `).run(key, groupKey, name, option.is_active ? 1 : 0, option.sort_order);
      });
      const tagKeys = new Set<string>();
      const tagNames = new Set<string>();
      tags.forEach((tag, index) => {
        const key = text(tag.tag_key);
        const name = text(tag.name);
        if (!key || !name || tagKeys.has(key) || tagNames.has(name)) {
          throw new RepositoryValidationError({ code: "tag.invalid", params: { row: index + 1 } });
        }
        tagKeys.add(key);
        tagNames.add(name);
        db.prepare(`
          INSERT INTO tags(tag_key,name,description,color,is_active,sort_order)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(tag_key) DO UPDATE SET
            name=excluded.name,description=excluded.description,color=excluded.color,
            is_active=excluded.is_active,sort_order=excluded.sort_order
        `).run(key, name, text(tag.description), text(tag.color) || "#7c3aed", tag.is_active ? 1 : 0, tag.sort_order);
      });
      const affectedMonths = new Set<string>();
      const removalKeys = new Set<string>();
      removals.forEach((removal) => {
        const identity = `${removal.kind}:${removal.key}`;
        const source = removal.kind === "tag" ? currentTags.get(removal.key)
          : removal.kind === "option" ? currentOptions.get(removal.key) : currentGroups.get(removal.key);
        const stillSubmitted = removal.kind === "tag" ? submittedTagKeys.has(removal.key)
          : removal.kind === "option" ? submittedOptionKeys.has(removal.key) : submittedGroupKeys.has(removal.key);
        if (!source || stillSubmitted || removalKeys.has(identity) || !Number.isInteger(removal.expected_count)
          || !Number.isInteger(removal.expected_usage_revision)) {
          throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
        }
        removalKeys.add(identity);
        const actual = removal.kind === "tag" ? currentTags.get(removal.key)?.transaction_count ?? 0
          : removal.kind === "option" ? currentOptions.get(removal.key)?.category_count ?? 0
            : currentGroups.get(removal.key)?.usage_count ?? 0;
        if (actual !== removal.expected_count) throw new RevisionConflictError(removal.expected_count, actual);
        if (source.usage_revision !== removal.expected_usage_revision) {
          throw new RevisionConflictError(removal.expected_usage_revision, source.usage_revision ?? 0);
        }
        if (removal.kind === "tag") {
          rows(db.prepare(`SELECT DISTINCT t.month FROM transaction_tags tt
            JOIN transactions t ON t.id=tt.transaction_id WHERE tt.tag_key=?`).all(removal.key))
            .forEach((row) => affectedMonths.add(text(row.month)));
          if (removal.action === "transfer") {
            if (!removal.target_key || !submittedTagKeys.has(removal.target_key)
              || removal.target_key === removal.key || !tags.find((tag) => tag.tag_key === removal.target_key)?.is_active) {
              throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
            }
            db.prepare(`INSERT OR IGNORE INTO transaction_tags(transaction_id,tag_key)
              SELECT transaction_id,? FROM transaction_tags WHERE tag_key=?`)
              .run(removal.target_key, removal.key);
          } else if (removal.action !== "clear") throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
          db.prepare("DELETE FROM transaction_tags WHERE tag_key=?").run(removal.key);
        } else if (removal.kind === "option") {
          const option = currentOptions.get(removal.key);
          if (!option) throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
          rows(db.prepare(`SELECT DISTINCT t.month FROM category_attributes ca
            JOIN transactions t ON t.category_key=ca.category_key WHERE ca.attribute_key=?`).all(removal.key))
            .forEach((row) => affectedMonths.add(text(row.month)));
          if (removal.action === "transfer") {
            const target = options.find((item) => item.attribute_key === removal.target_key);
            if (!target || !target.is_active || target.group_key !== option.group_key
              || target.attribute_key === removal.key) throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
            db.prepare("UPDATE category_attributes SET attribute_key=? WHERE attribute_key=?")
              .run(target.attribute_key, removal.key);
          } else if (removal.action === "clear") {
            db.prepare("DELETE FROM category_attributes WHERE attribute_key=?").run(removal.key);
          } else throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
        } else {
          rows(db.prepare(`SELECT DISTINCT t.month FROM attribute_options o
            JOIN category_attributes ca ON ca.attribute_key=o.attribute_key
            JOIN transactions t ON t.category_key=ca.category_key WHERE o.group_key=?`).all(removal.key))
            .forEach((row) => affectedMonths.add(text(row.month)));
          if (removal.action === "transfer") {
            const target = options.find((item) => item.attribute_key === removal.target_key);
            const targetGroup = target && currentGroups.get(target.group_key);
            if (!target || !target.is_active || target.group_key === removal.key
              || !targetGroup || !groups.find((group) => group.group_key === target.group_key)?.is_active
              || targetGroup.usage_revision !== removal.expected_target_group_usage_revision) {
              throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
            }
            const sourceCategories = rows(db.prepare(`SELECT DISTINCT ca.category_key
              FROM category_attributes ca JOIN attribute_options o ON o.attribute_key=ca.attribute_key
              WHERE o.group_key=?`).all(removal.key)).map((row) => text(row.category_key));
            const deleteTarget = db.prepare(`DELETE FROM category_attributes WHERE category_key=?
              AND attribute_key IN (SELECT attribute_key FROM attribute_options WHERE group_key=?)`);
            const insertTarget = db.prepare("INSERT INTO category_attributes(category_key,attribute_key) VALUES (?,?)");
            sourceCategories.forEach((categoryKey) => {
              deleteTarget.run(categoryKey, target.group_key);
              insertTarget.run(categoryKey, target.attribute_key);
            });
          } else if (removal.action !== "clear") {
            throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
          }
          db.prepare(`DELETE FROM category_attributes WHERE attribute_key IN
            (SELECT attribute_key FROM attribute_options WHERE group_key=?)`).run(removal.key);
        }
      });
      // An omitted, referenced definition requires an explicit historical rewrite.
      rows(db.prepare("SELECT tag_key FROM tags").all()).forEach((row) => {
        const key = text(row.tag_key);
        if (submittedTagKeys.has(key)) return;
        const used = Number((db.prepare(
          "SELECT COUNT(*) AS count FROM transaction_tags WHERE tag_key=?"
        ).get(key) as Row).count ?? 0);
        if (used > 0) throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
        db.prepare("DELETE FROM tags WHERE tag_key=?").run(key);
      });
      rows(db.prepare("SELECT attribute_key FROM attribute_options").all()).forEach((row) => {
        const key = text(row.attribute_key);
        if (submittedOptionKeys.has(key)) return;
        const used = Number((db.prepare(
          "SELECT COUNT(*) AS count FROM category_attributes WHERE attribute_key=?"
        ).get(key) as Row).count ?? 0);
        if (used > 0) throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
        db.prepare("DELETE FROM attribute_options WHERE attribute_key=?").run(key);
      });
      rows(db.prepare("SELECT group_key FROM attribute_groups").all()).forEach((row) => {
        const key = text(row.group_key);
        if (submittedGroupKeys.has(key)) return;
        const optionCount = Number((db.prepare(
          "SELECT COUNT(*) AS count FROM attribute_options WHERE group_key=?"
        ).get(key) as Row).count ?? 0);
        const usage = Number((db.prepare(`
          SELECT COUNT(DISTINCT ca.category_key) AS count
          FROM attribute_options o
          JOIN category_attributes ca ON ca.attribute_key=o.attribute_key
          WHERE o.group_key=?
        `).get(key) as Row).count ?? 0);
        if (usage > 0 || optionCount > 0) throw new RepositoryValidationError({ code: "taxonomy.removal_invalid" });
        db.prepare("DELETE FROM attribute_groups WHERE group_key=?").run(key);
      });
      const duplicateCategoryGroups = rows(db.prepare(`
        SELECT ca.category_key,o.group_key,COUNT(*) AS count
        FROM category_attributes ca
        JOIN attribute_options o ON o.attribute_key=ca.attribute_key
        GROUP BY ca.category_key,o.group_key
        HAVING COUNT(*)>1
        LIMIT 1
      `).all());
      if (duplicateCategoryGroups.length) {
        throw new RepositoryValidationError({
          code: "category.attribute_group_duplicate",
          params: {
            category_key: text(duplicateCategoryGroups[0].category_key),
            group_key: text(duplicateCategoryGroups[0].group_key)
          }
        });
      }
      const saved = this.taxonomy(db);
      if (changedAttributeKeys.size) {
        const keys = [...changedAttributeKeys];
        const placeholders = keys.map(() => "?").join(",");
        rows(db.prepare(`
          SELECT DISTINCT t.month
          FROM category_attributes ca
          JOIN transactions t ON t.category_key=ca.category_key
          WHERE ca.attribute_key IN (${placeholders})
        `).all(...keys)).forEach((row) => affectedMonths.add(text(row.month)));
      }
      if (changedTagKeys.size) {
        const keys = [...changedTagKeys];
        const placeholders = keys.map(() => "?").join(",");
        rows(db.prepare(`
          SELECT DISTINCT t.month
          FROM transaction_tags tt
          JOIN transactions t ON t.id=tt.transaction_id
          WHERE tt.tag_key IN (${placeholders})
        `).all(...keys)).forEach((row) => affectedMonths.add(text(row.month)));
      }
      affectedMonths.forEach((month) => this.bumpMonthRevision(db, month));
      if (removals.length) {
        this.operations.write(db, {
          operation_id: randomUUID(),
          actor: "local-user",
          operation_type: "remove-taxonomy",
          source_page: "配置/分类属性",
          total_count: removals.length,
          change_count: removals.length,
          skipped_count: 0,
          failure_count: 0,
          changes: removals.map((removal) => ({
            transaction_id: null,
            transaction_key: `${removal.kind}:${removal.key}`,
            month: "",
            before: { kind: removal.kind, key: removal.key, usage_count: removal.expected_count },
            after: { action: removal.action, target_key: removal.target_key ?? null },
            status: "change" as const
          })),
          metadata: { affected_months: [...affectedMonths].sort() }
        }, removals.map((removal) => `${removal.kind}:${removal.key}`));
      }
      return saved;
    });
  }

  private accountRows(db = this.db()): AccountDefinition[] {
    return rows(db.prepare(`
      SELECT d.*,
        CASE WHEN d.account_type='cash'
          THEN (SELECT COUNT(DISTINCT month) FROM (
            SELECT month FROM cash_account_balances b WHERE b.account_key=d.account_key
            UNION ALL SELECT month FROM transactions t WHERE t.account_key=d.account_key
          ))
          ELSE (SELECT COUNT(DISTINCT month) FROM (
            SELECT month FROM investment_account_balances b WHERE b.account_key=d.account_key
            UNION ALL SELECT month FROM transactions t WHERE t.account_key=d.account_key
          ))
        END AS usage_count,
        CASE WHEN d.account_type='cash'
          THEN (SELECT GROUP_CONCAT(DISTINCT month) FROM (
            SELECT month FROM cash_account_balances b WHERE b.account_key=d.account_key
            UNION ALL SELECT month FROM transactions t WHERE t.account_key=d.account_key
          ))
          ELSE (SELECT GROUP_CONCAT(DISTINCT month) FROM (
            SELECT month FROM investment_account_balances b WHERE b.account_key=d.account_key
            UNION ALL SELECT month FROM transactions t WHERE t.account_key=d.account_key
          ))
        END AS impact_months
      FROM account_definitions d
      ORDER BY d.account_type,d.sort_order,d.name
    `).all()).map((row) => ({
      account_key: text(row.account_key),
      name: text(row.name),
      account_type: text(row.account_type) as "cash" | "investment",
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order),
      usage_count: Number(row.usage_count),
      impact_months: text(row.impact_months).split(",").filter(Boolean).sort()
    }));
  }

  accounts(db = this.db()): { revision: number; rows: AccountDefinition[] } {
    const result = this.accountRows(db);
    return { revision: contentRevision(result), rows: result };
  }

  async saveAccounts(
    expectedRevision: number,
    input: AccountDefinition[]
  ): Promise<{ revision: number; rows: AccountDefinition[] }> {
    return this.manager.write((db) => {
      this.configurationWrites.saveAccounts(db, expectedRevision, input);
      return this.accounts(db);
    });
  }

  private cashAccounts(db: DatabaseSync, month: string): CashAccountBalance[] {
    const raw = rows(db.prepare(`
      SELECT d.account_key,d.name AS account,d.is_active,d.sort_order,
             COALESCE(b.balance,0) AS balance
      FROM account_definitions d
      LEFT JOIN cash_account_balances b
        ON b.account_key=d.account_key AND b.month=?
      WHERE d.account_type='cash' AND (d.is_active=1 OR b.account_key IS NOT NULL)
      ORDER BY d.sort_order,d.name
    `).all(month));
    const total = sum(raw.map((row) => Number(row.balance ?? 0)));
    return raw.map((row) => ({
      account_key: text(row.account_key),
      account: text(row.account),
      balance: roundHalfEven(Number(row.balance ?? 0)),
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order),
      share_percent: total > 0
        ? roundHalfEven(Number(row.balance ?? 0) / total * 100, 1) : 0
    }));
  }

  private investmentAccounts(db: DatabaseSync, month: string): InvestmentAccountBalance[] {
    return rows(db.prepare(`
      SELECT d.account_key,d.name,d.is_active,d.sort_order,
             COALESCE(b.principal,0) AS principal,
             COALESCE(b.market_value,0) AS market_value,
             COALESCE(b.cash_balance,0) AS cash_balance
      FROM account_definitions d
      LEFT JOIN investment_account_balances b
        ON b.account_key=d.account_key AND b.month=?
      WHERE d.account_type='investment' AND (d.is_active=1 OR b.account_key IS NOT NULL)
      ORDER BY d.sort_order,d.name
    `).all(month)).map((row) => ({
      account_key: text(row.account_key),
      name: text(row.name),
      principal: Number(row.principal ?? 0),
      market_value: Number(row.market_value ?? 0),
      cash_balance: Number(row.cash_balance ?? 0),
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order)
    }));
  }

  getRevision(month: string, db = this.db()): number {
    return Number((db.prepare(
      "SELECT revision FROM month_status WHERE month=?"
    ).get(month) as Row | undefined)?.revision ?? 0);
  }

  getMonthStatus(month: string, db = this.db()): "draft" | "saved" {
    const status = text(this.monthStatus(db, month)?.status);
    if (status === "draft") return "draft";
    if (status === "saved" || status === "locked") return "saved";
    for (const table of [
      "transactions",
      "cash_account_balances",
      "investment_account_balances",
      "fixed_assets"
    ]) {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE month=? LIMIT 1`).get(month)) return "saved";
    }
    return "draft";
  }

  async ensureFixedAssetsInherited(month: string): Promise<number> {
    if (!isMonth(month)) return 0;
    const current = this.monthStatus(this.db(), month);
    if (Number(current?.fixed_assets_initialized ?? 0) || current?.status === "locked") return 0;
    const inherited = await this.manager.write((db) =>
      this.monthWrites.ensureFixedAssetsInherited(db, month)
    );
    this.monthsCache = null;
    return inherited;
  }

  validateTransactionRows(month: string, input: Transaction[]): ValidationIssue[] {
    if (!isMonth(month)) {
      throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    }
    return this.monthWrites.validateTransactionRows(this.db(), month, input);
  }

  async saveMonth(
    month: string,
    expectedRevision: number,
    cashAccounts: CashAccountBalance[],
    investmentAccounts: InvestmentAccountBalance[],
    transactions: Transaction[],
    fixedAssets: FixedAsset[],
    debts?: {
      expected_revision: number;
      rows: DebtRecord[];
    },
    operationLogs: Array<{
      preview: OperationPreview;
      selection: string[];
    }> = []
  ): Promise<MonthWorkspace> {
    const result = await this.manager.write((db) => {
      const canonicalOperationLogs = this.monthWrites.validateOperationLogs(
        db,
        month,
        transactions,
        operationLogs
      );
      const nextRevision = this.monthWrites.saveMonth(
        db,
        month,
        expectedRevision,
        cashAccounts,
        investmentAccounts,
        transactions,
        fixedAssets,
        debts
      );
      canonicalOperationLogs.forEach((entry) =>
        this.operations.write(db, entry.preview, entry.selection)
      );
      const workspace = this.getMonthFromDb(month, db);
      workspace.revision = nextRevision;
      return workspace;
    });
    this.monthsCache = null;
    return result;
  }

  async saveMonthSection(
    month: string,
    payload: MonthSectionSaveRequest
  ): Promise<MonthWorkspace> {
    const result = await this.manager.write((db) => {
      const pendingOperationLogs = [
        ...(payload.operation_logs ?? [])
      ];
      if (payload.section !== "transactions" && pendingOperationLogs.length) {
        throw new RepositoryValidationError({ code: "operation.logs_section_required" });
      }
      const canonicalOperationLogs = payload.section === "transactions"
        ? this.monthWrites.validateOperationLogs(db, month, payload.transactions, pendingOperationLogs)
        : [];
      const nextRevision = this.monthWrites.saveMonthSection(db, month, payload);
      canonicalOperationLogs.forEach((entry) =>
        this.operations.write(db, entry.preview, entry.selection)
      );
      const workspace = this.getMonthFromDb(month, db);
      workspace.revision = nextRevision;
      return workspace;
    });
    this.monthsCache = null;
    return result;
  }

  private debtRecordFromRow(row: Row): DebtRecord {
    return debtFromRow(row);
  }

  private debtRows(db = this.db()): DebtRecord[] {
    return rows(db.prepare(
      "SELECT * FROM debt_manager ORDER BY is_paid,start_date DESC,id"
    ).all()).map((row) => this.debtRecordFromRow(row));
  }

  private debtRowsForMonth(
    db: DatabaseSync,
    month: string,
    viewState: boolean
  ): DebtRecord[] {
    if (!isMonth(month)) throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    const start = `${month}-01`;
    const end = monthEnd(month);
    return rows(db.prepare(`
      SELECT * FROM debt_manager
      WHERE start_date<=?
        AND (
          is_paid=0
          OR paid_date>?
          OR (
            paid_date>=?
            AND paid_date<=?
          )
          OR (
            start_date>=?
            AND start_date<=?
          )
        )
      ORDER BY
        CASE
          WHEN is_paid=0 OR paid_date>? THEN 0
          ELSE 1
        END,
        start_date DESC,
        id
    `).all(end, end, start, end, start, end, end)).map((row) => {
      const debt = this.debtRecordFromRow(row);
      return viewState
        ? {
            ...debt,
            is_paid: Boolean(debt.is_paid && debt.paid_date && debt.paid_date <= end)
          }
        : debt;
    });
  }

  private monthDebts(db: DatabaseSync, month: string): {
    revision: number;
    rows: DebtRecord[];
  } {
    const result = this.debtRowsForMonth(db, month, true);
    return {
      revision: contentRevision(result),
      rows: result
    };
  }

  async getMonth(month: string): Promise<MonthWorkspace> {
    if (!isMonth(month)) {
      throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    }
    // Keep the legacy invariant for drafts that predate the explicit create
    // flow: fixed assets are inherited before the workspace is exposed. Save
    // methods use getMonthFromDb inside their write transaction and therefore
    // never perform this side effect while rebuilding a canonical response.
    await this.ensureFixedAssetsInherited(month);
    return this.getMonthFromDb(month, this.db());
  }

  private getMonthFromDb(month: string, db: DatabaseSync): MonthWorkspace {
    const transactions = rows(db.prepare(`
      SELECT id,transaction_date,type,category_key,category,counterparty,product,source,account_key,amount,
             COALESCE((SELECT json_group_array(tag_key) FROM transaction_tags tt WHERE tt.transaction_id=transactions.id),'[]') AS tag_keys
      FROM transactions WHERE month=? ORDER BY id
    `).all(month)).map(transactionFromRow);
    const categories = this.categoryDefinitions(db);
    const debts = this.monthDebts(db, month);
    return {
      month,
      revision: this.getRevision(month, db),
      status: this.getMonthStatus(month, db),
      debt_revision: debts.revision,
      cash_accounts: this.cashAccounts(db, month),
      investment_accounts: this.investmentAccounts(db, month),
      transactions,
      attribute_groups: this.attributeGroups(db),
      attribute_options: this.attributeOptions(db),
      tags: this.tagDefinitions(db),
      debts: debts.rows,
      fixed_assets: rows(db.prepare(
        "SELECT * FROM fixed_assets WHERE month=? ORDER BY id"
      ).all(month)).map(fixedAssetFromRow),
      computed: calculateMonthly(
        transactions,
        categories
      ),
      overview: this.analysis.draftMonthOverview(db, month, transactions, categories)
    };
  }

  monthOverview(month: string): MonthOverview {
    if (!isMonth(month)) {
      throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    }
    const db = this.db();
    const transactions = rows(db.prepare(`
      SELECT id,transaction_date,type,category_key,category,counterparty,product,
             source,account_key,amount,
             COALESCE((SELECT json_group_array(tag_key) FROM transaction_tags tt WHERE tt.transaction_id=transactions.id),'[]') AS tag_keys
      FROM transactions WHERE month=? ORDER BY id
    `).all(month)).map(transactionFromRow);
    const categories = this.categoryDefinitions(db);
    return this.analysis.monthOverview(db, month, transactions, categories);
  }

  rules(db = this.db()): { revision: number; rows: Row[] } {
    return this.ruleHistory.rules(db);
  }

  async saveRules(
    expectedRevision: number,
    input: Array<Row | SavedRule>,
    audit: OperationAuditContext = { source_page: "配置/匹配规则" }
  ): Promise<{ revision: number; rows: SavedRule[] }> {
    return this.manager.write((db) => {
      const before = rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all());
      this.configurationWrites.saveRules(db, expectedRevision, input);
      const after = rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all());
      const operation = this.entityOperation(before, after, "rule", "save-rules", audit);
      this.operations.write(
        db,
        operation,
        audit.selection ?? operation.changes.map((change) => change.transaction_key ?? "")
      );
      return this.ruleHistory.savedRules(db);
    });
  }

  operationLogs(limit = 50): OperationLogSummary[] {
    return this.operations.list(this.db(), limit);
  }

  operationDetails(operationId: string): Record<string, unknown> | null {
    return this.operations.details(this.db(), operationId);
  }

  rulesPreview(month: string, input: Transaction[]): {
    base_revision: number;
    rules_revision: number;
    proposed_rows: Transaction[];
    issues: Array<Record<string, unknown>>;
  } {
    if (!isMonth(month)) {
      throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    }
    return this.ruleHistory.rulesPreview(this.db(), month, input);
  }

  ruleWorkspaceShell(): RuleWorkspaceShell {
    return this.ruleHistory.ruleWorkspaceShell(this.db());
  }

  ruleImpactPreview(rule: import("../domain/rules").RuleRow): RuleImpactPreview {
    return this.ruleHistory.ruleImpactPreview(this.db(), rule);
  }

  ruleWorkspaceAnalytics(minOccurrences = 2): RuleWorkspaceAnalytics {
    return this.ruleHistory.ruleWorkspaceAnalytics(this.db(), minOccurrences);
  }

  productOverview(query: ProductHistoryQuery = {}): ProductHistoryIndexResult {
    return this.ruleHistory.productOverview(this.db(), query);
  }

  productHistoryIndex(query: ProductHistoryQuery): ProductHistoryIndexResult {
    return this.ruleHistory.productHistoryIndex(this.db(), query);
  }

  productHistory(query: ProductHistoryQuery): ProductHistoryResult {
    return this.ruleHistory.productHistory(this.db(), query);
  }

  previewCategoryBackfill(
    request: Omit<CategoryBackfillRequest, "expected_month_revisions">
  ): CategoryBackfillPreview {
    return this.historyWrites.previewCategoryBackfill(this.db(), request);
  }

  async applyCategoryBackfill(
    request: CategoryBackfillRequest
  ): Promise<CategoryBackfillResult> {
    return this.manager.write((db) => {
      const before = this.historicalTransactionRows(db, request.transaction_ids);
      const result = this.historyWrites.applyCategoryBackfill(db, request);
      const after = this.historicalTransactionRows(db, request.transaction_ids);
      const operation = this.historyOperation(
        before,
        after,
        "history-category-backfill",
        { source_page: request.source_page ?? "配置/数据健康", actor: request.actor },
        { target_category_key: result.target_category_key, target_category: result.target_category }
      );
      this.operations.write(db, operation, operation.changes.map((change) => change.transaction_key ?? ""));
      return result;
    });
  }

  previewProductRename(
    request: Omit<ProductRenameRequest, "expected_month_revisions">
  ): ProductRenamePreview {
    return this.historyWrites.previewProductRename(this.db(), request);
  }

  async applyProductRename(request: ProductRenameRequest): Promise<ProductRenameResult> {
    return this.manager.write((db) => {
      const before = this.historicalTransactionRows(db, request.transaction_ids);
      const result = this.historyWrites.applyProductRename(db, request);
      const after = this.historicalTransactionRows(db, request.transaction_ids);
      const operation = this.historyOperation(
        before,
        after,
        "history-product-rename",
        { source_page: request.source_page ?? "配置/商品总览", actor: request.actor },
        { target_product: result.target_product }
      );
      this.operations.write(db, operation, operation.changes.map((change) => change.transaction_key ?? ""));
      return result;
    });
  }

  previewCounterpartyRename(
    request: Omit<CounterpartyRenameRequest, "expected_month_revisions">
  ): CounterpartyRenamePreview {
    return this.historyWrites.previewCounterpartyRename(this.db(), request);
  }

  async applyCounterpartyRename(request: CounterpartyRenameRequest): Promise<CounterpartyRenameResult> {
    return this.manager.write((db) => {
      const before = this.historicalTransactionRows(db, request.transaction_ids);
      const result = this.historyWrites.applyCounterpartyRename(db, request);
      const after = this.historicalTransactionRows(db, request.transaction_ids);
      const operation = this.historyOperation(
        before,
        after,
        "history-counterparty-rename",
        { source_page: request.source_page ?? "配置/商品总览", actor: request.actor },
        { target_counterparty: result.target_counterparty }
      );
      this.operations.write(db, operation, operation.changes.map((change) => change.transaction_key ?? ""));
      return result;
    });
  }

  ruleCandidates(
    month: string,
    draftRows: Transaction[],
    minOccurrences = 2
  ): {
    month: string;
    rules_revision: number;
    min_occurrences: number;
    rows: RuleCandidate[];
  } {
    if (!isMonth(month)) {
      throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    }
    return this.ruleHistory.ruleCandidates(this.db(), month, draftRows, minOccurrences);
  }

  debts(db = this.db()): { revision: number; rows: DebtRecord[] } {
    const result = this.debtRows(db);
    return { revision: contentRevision(result), rows: result };
  }

  async saveDebts(expectedRevision: number, input: Row[]): Promise<{
    revision: number;
    rows: DebtRecord[];
  }> {
    return this.manager.write((db) => {
      this.monthWrites.saveDebts(db, expectedRevision, input);
      return this.debts(db);
    });
  }

  annual(year: string): AnnualOverview {
    return this.analysis.annual(this.db(), year);
  }

  currentAsset(): CurrentAsset {
    return this.analysis.currentAsset(this.db());
  }
}
