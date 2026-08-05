import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  AnnualOverview,
  CashAccountBalance,
  CategoryBackfillPreview,
  CategoryBackfillRequest,
  CategoryBackfillResult,
  CategoryDefinition,
  CurrentAsset,
  DebtRecord,
  FixedAsset,
  InvestmentAccountBalance,
  MonthCreationPolicy,
  MonthSectionSaveRequest,
  MonthWorkspace,
  ProductHistoryIndexResult,
  ProductHistoryQuery,
  ProductHistoryResult,
  ProductRenamePreview,
  ProductRenameRequest,
  ProductRenameResult,
  RuleCandidate,
  RuleInsights,
  RuleWorkspaceAnalytics,
  RuleWorkspaceShell,
  RuleWorkspace,
  SaveRuleWorkspaceRequest,
  Transaction
} from "../types";
import { calculateMonthly } from "../domain/calculator";
import {
  isMonth,
  localMonth,
  localTimestamp,
  monthEnd,
  nextMonth,
  normalizeDate
} from "../domain/dates";
import { roundHalfEven, sum } from "../domain/money";
import { DatabaseManager } from "./DatabaseManager";
import { AnalysisReadModel } from "./analysisReadModel";
import { ConfigurationWriteRepository } from "./configurationWriteRepository";
import { HistoryWriteRepository } from "./historyWriteRepository";
import { MonthWriteRepository } from "./monthWriteRepository";
import { RuleHistoryReadModel } from "./ruleHistoryReadModel";
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
import type { RepositoryWriteContext } from "./repositoryWriteContext";

export class AssetTrackRepository {
  private readonly analysis: AnalysisReadModel;
  private readonly ruleHistory: RuleHistoryReadModel;
  private readonly monthWrites: MonthWriteRepository;
  private readonly configurationWrites: ConfigurationWriteRepository;
  private readonly historyWrites: HistoryWriteRepository;

  constructor(
    private readonly manager: DatabaseManager,
    private readonly options: {
      reconciliationTolerance: number;
      largeExpenseThreshold: number;
    } = { reconciliationTolerance: 100, largeExpenseThreshold: 1000 }
  ) {
    this.analysis = new AnalysisReadModel({
      largeExpenseThreshold: this.options.largeExpenseThreshold,
      reconciliationTolerance: this.options.reconciliationTolerance,
      getMonths: (db) => this.getMonths(db),
      categoryRows: (db) => this.categoryRows(db),
      cashAccounts: (db, month) => this.cashAccounts(db, month),
      investmentAccounts: (db, month) => this.investmentAccounts(db, month)
    });
    this.ruleHistory = new RuleHistoryReadModel({
      categoryRows: (db) => this.categoryRows(db),
      categories: (db) => this.categories(db),
      getRevision: (month, db) => this.getRevision(month, db)
    });
    const writeContext: RepositoryWriteContext = {
      monthStatus: (db, month) => this.monthStatus(db, month),
      checkMonthRevision: (db, month, revision) =>
        this.checkMonthRevision(db, month, revision),
      touchMonth: (db, month, revision, fixedInitialized) =>
        this.touchMonth(db, month, revision, fixedInitialized),
      getMonths: (db) => this.getMonths(db),
      getRevision: (month, db) => this.getRevision(month, db),
      categoryRows: (db) => this.categoryRows(db),
      categories: (db) => this.categories(db),
      accounts: (db) => this.accounts(db),
      debts: (db) => this.debts(db),
      monthDebts: (db, month) => this.monthDebts(db, month),
      rules: (db) => this.rules(db),
      ruleHistory: this.ruleHistory
    };
    this.monthWrites = new MonthWriteRepository(writeContext);
    this.configurationWrites = new ConfigurationWriteRepository(writeContext);
    this.historyWrites = new HistoryWriteRepository(writeContext);
  }

  initialize(): void {
    this.manager.open();
  }

  private db(): DatabaseSync {
    return this.manager.connection();
  }

  private monthStatus(db: DatabaseSync, month: string): Row | null {
    return (db.prepare("SELECT * FROM month_status WHERE month=?").get(month) as Row | undefined)
      ?? null;
  }

  private checkMonthRevision(
    db: DatabaseSync,
    month: string,
    expectedRevision: number
  ): number {
    if (!isMonth(month)) throw new RepositoryValidationError(`非法月份：${month}`);
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

  getMonths(db = this.db()): string[] {
    const result = new Set<string>();
    for (const table of [
      "cash_account_balances",
      "investment_account_balances",
      "transactions",
      "fixed_assets",
      "month_status"
    ]) {
      for (const row of rows(db.prepare(`SELECT DISTINCT month FROM ${table}`).all())) {
        const month = text(row.month);
        if (isMonth(month)) result.add(month);
      }
    }
    return [...result].sort();
  }

  monthCreationPolicy(): MonthCreationPolicy {
    const db = this.db();
    const months = this.getMonths(db);
    const drafts = rows(db.prepare(
      "SELECT month FROM month_status WHERE status='draft' ORDER BY month"
    ).all()).map((row) => text(row.month)).filter(isMonth);
    const current = localMonth();
    const max = nextMonth(current);
    const target = months.length ? nextMonth(months.at(-1)!) : current;
    let reason: string | null = null;
    if (drafts.length) reason = `请先保存或删除草稿月份 ${drafts[0]}`;
    else if (target > max) reason = `最多只能预建到 ${max}`;
    return {
      months,
      draft_month: drafts[0] ?? null,
      next_target: target,
      max_creatable_month: max,
      can_create: reason === null,
      reason
    };
  }

  async createMonth(month: string): Promise<MonthWorkspace> {
    const inherited = await this.manager.write((db) => {
      this.monthWrites.createMonth(db, month);
      return this.monthWrites.ensureFixedAssetsInherited(db, month);
    });
    const result = await this.getMonth(month);
    (result as MonthWorkspace & { inherited_fixed_assets?: number }).inherited_fixed_assets = inherited;
    return result;
  }

  async deleteMonth(month: string, expectedRevision: number): Promise<Record<string, unknown>> {
    const deletedRows = await this.manager.write((db) =>
      this.monthWrites.deleteMonth(db, month, expectedRevision)
    );
    return { deleted: true, month, deleted_rows: deletedRows, months: this.getMonths() };
  }

  private categoryRows(db = this.db()): CategoryDefinition[] {
    const result = rows(db.prepare(`
      SELECT d.*,
        COUNT(DISTINCT t.id) AS transaction_count,
        COUNT(DISTINCT r.id) AS rule_count,
        GROUP_CONCAT(DISTINCT t.month) AS impact_months
      FROM category_definitions d
      LEFT JOIN transactions t ON t.category_key=d.category_key
      LEFT JOIN auto_rules r ON r.category_key=d.category_key
      GROUP BY d.category_key
      ORDER BY d.sort_order,d.name
    `).all());
    return result.map((row) => ({
      category_key: text(row.category_key),
      name: text(row.name),
      transaction_type: text(row.transaction_type) as "支出" | "收入",
      necessity: text(row.necessity) as CategoryDefinition["necessity"],
      pattern: text(row.pattern) as CategoryDefinition["pattern"],
      is_big_ticket: boolean(row.is_big_ticket),
      color: text(row.color),
      is_active: boolean(row.is_active),
      sort_order: Number(row.sort_order),
      transaction_count: Number(row.transaction_count),
      rule_count: Number(row.rule_count),
      impact_months: text(row.impact_months).split(",").filter(Boolean).sort()
    }));
  }

  categories(db = this.db()): { revision: number; rows: CategoryDefinition[] } {
    const result = this.categoryRows(db);
    return { revision: contentRevision(result as unknown as Row[]), rows: result };
  }

  async saveCategories(
    expectedRevision: number,
    input: CategoryDefinition[]
  ): Promise<{ revision: number; rows: CategoryDefinition[] }> {
    await this.manager.write((db) =>
      this.configurationWrites.saveCategories(db, expectedRevision, input)
    );
    return this.categories();
  }

  private accountRows(db = this.db()): AccountDefinition[] {
    return rows(db.prepare(`
      SELECT d.*,
        CASE WHEN d.account_type='cash'
          THEN (SELECT COUNT(*) FROM cash_account_balances b WHERE b.account_key=d.account_key)
          ELSE (SELECT COUNT(*) FROM investment_account_balances b WHERE b.account_key=d.account_key)
        END AS usage_count,
        CASE WHEN d.account_type='cash'
          THEN (SELECT GROUP_CONCAT(DISTINCT month) FROM cash_account_balances b
                WHERE b.account_key=d.account_key)
          ELSE (SELECT GROUP_CONCAT(DISTINCT month) FROM investment_account_balances b
                WHERE b.account_key=d.account_key)
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
    return { revision: contentRevision(result as unknown as Row[]), rows: result };
  }

  async saveAccounts(
    expectedRevision: number,
    input: AccountDefinition[]
  ): Promise<{ revision: number; rows: AccountDefinition[] }> {
    await this.manager.write((db) =>
      this.configurationWrites.saveAccounts(db, expectedRevision, input)
    );
    return this.accounts();
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
    const status = text((db.prepare(
      "SELECT status FROM month_status WHERE month=?"
    ).get(month) as Row | undefined)?.status);
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
    return this.manager.write((db) =>
      this.monthWrites.ensureFixedAssetsInherited(db, month)
    );
  }

  validateTransactionRows(month: string, input: Transaction[]): ValidationIssue[] {
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
    }
  ): Promise<MonthWorkspace> {
    const revision = await this.manager.write((db) => this.monthWrites.saveMonth(
      db,
      month,
      expectedRevision,
      cashAccounts,
      investmentAccounts,
      transactions,
      fixedAssets,
      debts
    ));
    const result = await this.getMonth(month);
    result.revision = revision;
    return result;
  }

  async saveMonthSection(
    month: string,
    payload: MonthSectionSaveRequest
  ): Promise<MonthWorkspace> {
    const revision = await this.manager.write((db) =>
      this.monthWrites.saveMonthSection(db, month, payload)
    );
    const result = await this.getMonth(month);
    result.revision = revision;
    return result;
  }

  private debtRecordFromRow(row: Row): DebtRecord {
    const debt = debtFromRow(row);
    return {
      ...debt,
      start_date: (() => {
        try { return normalizeDate(debt.start_date); } catch { return debt.start_date; }
      })(),
      paid_date: debt.paid_date
        ? (() => {
          try { return normalizeDate(debt.paid_date); } catch { return debt.paid_date; }
        })()
        : null
    };
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
    if (!isMonth(month)) throw new RepositoryValidationError(`非法月份：${month}`);
    const start = `${month}-01`;
    const end = monthEnd(month);
    return rows(db.prepare(`
      SELECT * FROM debt_manager
      WHERE REPLACE(start_date,'/','-')<=?
        AND (
          is_paid=0
          OR REPLACE(paid_date,'/','-')>?
          OR (
            REPLACE(paid_date,'/','-')>=?
            AND REPLACE(paid_date,'/','-')<=?
          )
          OR (
            REPLACE(start_date,'/','-')>=?
            AND REPLACE(start_date,'/','-')<=?
          )
        )
      ORDER BY
        CASE
          WHEN is_paid=0 OR REPLACE(paid_date,'/','-')>? THEN 0
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
      revision: contentRevision(result as unknown as Row[]),
      rows: result
    };
  }

  async getMonth(month: string): Promise<MonthWorkspace> {
    await this.ensureFixedAssetsInherited(month);
    const db = this.db();
    const transactions = rows(db.prepare(`
      SELECT id,transaction_date,type,category_key,category,counterparty,product,amount
      FROM transactions WHERE month=? ORDER BY id
    `).all(month)).map(transactionFromRow);
    const categories = this.categoryRows(db);
    const debts = this.monthDebts(db, month);
    return {
      month,
      revision: this.getRevision(month, db),
      status: this.getMonthStatus(month, db),
      debt_revision: debts.revision,
      cash_accounts: this.cashAccounts(db, month),
      investment_accounts: this.investmentAccounts(db, month),
      transactions,
      debts: debts.rows,
      fixed_assets: rows(db.prepare(
        "SELECT * FROM fixed_assets WHERE month=? ORDER BY id"
      ).all(month)).map(fixedAssetFromRow),
      computed: calculateMonthly(
        transactions,
        categories,
        this.options.largeExpenseThreshold
      ) as unknown as Record<string, unknown>,
      overview: this.analysis.monthOverview(db, month, transactions, categories)
    };
  }

  rules(db = this.db()): { revision: number; rows: Row[] } {
    return this.ruleHistory.rules(db);
  }

  async saveRules(expectedRevision: number, input: Row[]): Promise<{ revision: number; rows: Row[] }> {
    await this.manager.write((db) =>
      this.configurationWrites.saveRules(db, expectedRevision, input)
    );
    return this.rules();
  }

  rulesPreview(month: string, input: Transaction[]): {
    base_revision: number;
    rules_revision: number;
    proposed_rows: Transaction[];
    issues: Array<Record<string, unknown>>;
  } {
    return this.ruleHistory.rulesPreview(this.db(), month, input);
  }

  ruleInsights(minOccurrences = 2): RuleInsights {
    return this.ruleHistory.ruleInsights(this.db(), minOccurrences);
  }

  ruleWorkspace(minOccurrences = 2): RuleWorkspace {
    return this.ruleHistory.ruleWorkspace(this.db(), minOccurrences);
  }

  ruleWorkspaceShell(): RuleWorkspaceShell {
    return this.ruleHistory.ruleWorkspaceShell(this.db());
  }

  ruleWorkspaceAnalytics(minOccurrences = 2): RuleWorkspaceAnalytics {
    return this.ruleHistory.ruleWorkspaceAnalytics(this.db(), minOccurrences);
  }

  productOverview(): ProductHistoryIndexResult {
    return this.ruleHistory.productOverview(this.db());
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
    return this.manager.write((db) => this.historyWrites.applyCategoryBackfill(db, request));
  }

  previewProductRename(
    request: Omit<ProductRenameRequest, "expected_month_revisions">
  ): ProductRenamePreview {
    return this.historyWrites.previewProductRename(this.db(), request);
  }

  async applyProductRename(request: ProductRenameRequest): Promise<ProductRenameResult> {
    return this.manager.write((db) => this.historyWrites.applyProductRename(db, request));
  }

  async saveRuleWorkspace(request: SaveRuleWorkspaceRequest): Promise<RuleWorkspace> {
    await this.manager.write((db) => this.configurationWrites.saveRuleWorkspace(db, request));
    return this.ruleWorkspace();
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
    return this.ruleHistory.ruleCandidates(this.db(), month, draftRows, minOccurrences);
  }

  debts(db = this.db()): { revision: number; rows: DebtRecord[] } {
    const result = this.debtRows(db);
    return { revision: contentRevision(result as unknown as Row[]), rows: result };
  }

  async saveDebts(expectedRevision: number, input: Row[]): Promise<{
    revision: number;
    rows: DebtRecord[];
  }> {
    await this.manager.write((db) => this.monthWrites.saveDebts(db, expectedRevision, input));
    return this.debts();
  }

  annual(year: string): AnnualOverview {
    return this.analysis.annual(this.db(), year);
  }

  currentAsset(): CurrentAsset {
    return this.analysis.currentAsset(this.db());
  }
}
