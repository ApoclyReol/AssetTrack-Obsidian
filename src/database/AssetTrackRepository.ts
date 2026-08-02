import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  AnnualCostAudit,
  AnnualOverview,
  CashAccountBalance,
  CategoryDefinition,
  CategoryBackfillPreview,
  CategoryBackfillRequest,
  CategoryBackfillResult,
  CurrentAsset,
  FixedAsset,
  HistoricalCategoryCount,
  HistoricalProductStat,
  InvestmentAccountBalance,
  MonthCreationPolicy,
  MonthOverview,
  MonthWorkspace,
  ProductRenamePreview,
  ProductRenameRequest,
  ProductRenameResult,
  ProductHistoryIndexResult,
  ProductHistoryQuery,
  ProductHistoryResult,
  RuleCandidate,
  RuleConflictGroup,
  RuleHealthSummary,
  RuleInsights,
  RuleMatchLevel,
  RuleWorkspaceAnalytics,
  RuleWorkspaceShell,
  RuleWorkspace,
  RecurringExpenseSummary,
  SaveRuleWorkspaceRequest,
  SavedRule,
  Transaction
} from "../types";
import {
  buildAnnualRows,
  calculateMonthly,
  explainReconciliation,
  previousMonths,
  type ExtendedAnnualRow,
  type MonthlyCalculation
} from "../domain/calculator";
import {
  isMonth,
  localMonth,
  localTimestamp,
  monthEnd,
  nextMonth,
  normalizeDate,
  previousMonth,
  shiftMonth
} from "../domain/dates";
import { finiteNumber, roundHalfEven, sum } from "../domain/money";
import {
  applyRulesWithIssues,
  normalizeProductKey,
  RuleMatcher,
  ruleMatchLevel,
  rulesEquivalent,
  rulesOverlap,
  RULE_TYPES,
  type RuleRow
} from "../domain/rules";
import { validateTransactions } from "../domain/validators";
import type { ValidationIssue } from "../domain/validators";
import { scalarText } from "../domain/text";
import { categoryColor } from "./schema";
import { DatabaseManager } from "./DatabaseManager";
import { buildRuleReport } from "./ruleReporting";
import {
  boolean,
  contentRevision,
  exactRuleIndexKey,
  fixedAssetFromRow,
  normalizeAsset,
  RepositoryValidationError,
  RevisionConflictError,
  ruleIndexKey,
  rows,
  text,
  transactionFromRow,
  type Row
} from "./repositoryPrimitives";

export class AssetTrackRepository {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly options: {
      reconciliationTolerance: number;
      largeExpenseThreshold: number;
    } = { reconciliationTolerance: 100, largeExpenseThreshold: 1000 }
  ) {}

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
    if (!isMonth(month)) throw new RepositoryValidationError(`非法月份：${month}`);
    await this.manager.write((db) => {
      if (this.monthStatus(db, month)) return;
      const months = this.getMonths(db);
      const target = months.length ? nextMonth(months.at(-1)!) : localMonth();
      const max = nextMonth(localMonth());
      if (month !== target) {
        throw new RepositoryValidationError(`只能按自然顺序创建下一个月份 ${target}`);
      }
      if (month > max) throw new RepositoryValidationError(`当前最多只能创建到 ${max}`);
      const draft = db.prepare(
        "SELECT month FROM month_status WHERE status='draft' LIMIT 1"
      ).get() as Row | undefined;
      if (draft) {
        throw new RepositoryValidationError(
          `最多只能有一个草稿月份；请先保存或删除 ${text(draft.month)}`
        );
      }
      db.prepare(`
        INSERT INTO month_status
          (month,status,fixed_assets_initialized,updated_at,revision)
        VALUES (?, 'draft', 0, ?, 0)
      `).run(month, localTimestamp());
    });
    const inherited = await this.ensureFixedAssetsInherited(month);
    const result = await this.getMonth(month);
    (result as MonthWorkspace & { inherited_fixed_assets?: number }).inherited_fixed_assets =
      inherited;
    return result;
  }

  async deleteMonth(month: string, expectedRevision: number): Promise<Record<string, unknown>> {
    const deletedRows = await this.manager.write((db) => {
      this.checkMonthRevision(db, month, expectedRevision);
      let exists = Boolean(this.monthStatus(db, month));
      const deleted: Record<string, number> = {};
      for (const table of [
        "transactions",
        "cash_account_balances",
        "investment_account_balances",
        "fixed_assets"
      ]) {
        const present = db.prepare(`SELECT 1 FROM ${table} WHERE month=? LIMIT 1`).get(month);
        exists ||= Boolean(present);
        const result = db.prepare(`DELETE FROM ${table} WHERE month=?`).run(month);
        deleted[table] = Number(result.changes);
      }
      if (!exists) throw new RepositoryValidationError(`${month} 不存在，无需删除`);
      deleted.month_status = Number(
        db.prepare("DELETE FROM month_status WHERE month=?").run(month).changes
      );
      return deleted;
    });
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

  private writeCategories(
    db: DatabaseSync,
    input: CategoryDefinition[],
    allowRuleTypeChanges = false
  ): void {
    const existing = new Map(rows(db.prepare(
      "SELECT * FROM category_definitions"
    ).all()).map((row) => [text(row.category_key), row]));
    const submitted = new Set<string>();
    const names = new Set<string>();
    input.forEach((row, index) => {
      const key = text(row.category_key);
      const name = text(row.name);
      if (!key || !name || submitted.has(key) || names.has(name)) {
        throw new RepositoryValidationError("分类 key 和名称不能为空或重复");
      }
      if (!["支出", "收入"].includes(row.transaction_type)) {
        throw new RepositoryValidationError("分类收支类型只能是收入或支出");
      }
      if (!["必要", "可控", "不适用"].includes(row.necessity)) {
        throw new RepositoryValidationError("分类必要性无效");
      }
      if (!["周期", "日常", "偶尔", "不适用"].includes(row.pattern)) {
        throw new RepositoryValidationError("分类消费频率无效");
      }
      const old = existing.get(key);
      if (old && text(old.transaction_type) !== row.transaction_type) {
        const conflictingTransaction = db.prepare(`
          SELECT 1 FROM transactions
          WHERE category_key=? AND type IN ('支出','收入') AND type<>?
          LIMIT 1
        `).get(key, row.transaction_type);
        const conflictingRule = !allowRuleTypeChanges && db.prepare(`
          SELECT 1 FROM auto_rules
          WHERE category_key=? AND transaction_type<>?
          LIMIT 1
        `).get(key, row.transaction_type);
        if (conflictingTransaction || conflictingRule) {
          throw new RepositoryValidationError(
            `分类“${text(old.name)}”已有不匹配的历史引用，不能改变收支类型`
          );
        }
      }
      submitted.add(key);
      names.add(name);
      db.prepare(`
        INSERT INTO category_definitions
          (category_key,name,transaction_type,necessity,pattern,
           is_big_ticket,color,is_active,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(category_key) DO UPDATE SET
          name=excluded.name,transaction_type=excluded.transaction_type,
          necessity=excluded.necessity,pattern=excluded.pattern,
          is_big_ticket=excluded.is_big_ticket,color=excluded.color,
          is_active=excluded.is_active,sort_order=excluded.sort_order
      `).run(
        key, name, row.transaction_type, row.necessity, row.pattern,
        row.is_big_ticket ? 1 : 0, text(row.color) || categoryColor(index),
        row.is_active ? 1 : 0, Number(row.sort_order ?? index)
      );
      if (old && text(old.name) !== name) {
        db.prepare("UPDATE transactions SET category=? WHERE category_key=?").run(name, key);
        db.prepare("UPDATE auto_rules SET category=? WHERE category_key=?").run(name, key);
      }
    });
    for (const key of existing.keys()) {
      if (submitted.has(key)) continue;
      const usage = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE category_key=?) AS transaction_count,
          (SELECT COUNT(*) FROM auto_rules WHERE category_key=?) AS rule_count
      `).get(key, key) as Row;
      const transactionCount = Number(usage.transaction_count ?? 0);
      const ruleCount = Number(usage.rule_count ?? 0);
      if (transactionCount || ruleCount) {
        throw new RepositoryValidationError(
          `分类“${text(existing.get(key)?.name)}”仍有 ${transactionCount} 条历史流水和 ${ruleCount} 条规则引用，不能删除`
        );
      }
      db.prepare("DELETE FROM category_definitions WHERE category_key=?").run(key);
    }
  }

  async saveCategories(
    expectedRevision: number,
    input: CategoryDefinition[]
  ): Promise<{ revision: number; rows: CategoryDefinition[] }> {
    await this.manager.write((db) => {
      const current = this.categories(db);
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, current.revision);
      }
      this.writeCategories(db, input);
    });
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
    await this.manager.write((db) => {
      const current = this.accounts(db);
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, current.revision);
      }
      const existing = new Map(rows(db.prepare(
        "SELECT * FROM account_definitions"
      ).all()).map((row) => [text(row.account_key), row]));
      const submitted = new Set<string>();
      const names = new Set<string>();
      input.forEach((row, index) => {
        const key = text(row.account_key);
        const name = text(row.name);
        const identity = `${row.account_type}\u0000${name}`;
        if (
          !key || !name || submitted.has(key) || names.has(identity)
          || !["cash", "investment"].includes(row.account_type)
        ) {
          throw new RepositoryValidationError("账户 key、名称或类型无效或重复");
        }
        const old = existing.get(key);
        if (old && text(old.account_type) !== row.account_type) {
          throw new RepositoryValidationError("已有账户不能改变现金/理财类型");
        }
        submitted.add(key);
        names.add(identity);
        db.prepare(`
          INSERT INTO account_definitions
            (account_key,name,account_type,is_active,sort_order)
          VALUES (?,?,?,?,?)
          ON CONFLICT(account_key) DO UPDATE SET
            name=excluded.name,is_active=excluded.is_active,sort_order=excluded.sort_order
        `).run(key, name, row.account_type, row.is_active ? 1 : 0, row.sort_order ?? index);
      });
      for (const [key, definition] of existing) {
        if (submitted.has(key)) continue;
        const table = text(definition.account_type) === "cash"
          ? "cash_account_balances" : "investment_account_balances";
        const used = db.prepare(
          `SELECT 1 FROM ${table} WHERE account_key=? LIMIT 1`
        ).get(key);
        if (used) {
          db.prepare("UPDATE account_definitions SET is_active=0 WHERE account_key=?").run(key);
        } else {
          db.prepare("DELETE FROM account_definitions WHERE account_key=?").run(key);
        }
      }
    });
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
    return this.manager.write((db) => {
      const current = this.monthStatus(db, month);
      if (Number(current?.fixed_assets_initialized ?? 0) || current?.status === "locked") return 0;
      const existing = db.prepare(
        "SELECT 1 FROM fixed_assets WHERE month=? LIMIT 1"
      ).get(month);
      let inherited = 0;
      if (!existing) {
        const previous = previousMonth(month);
        if (previous) {
          const source = rows(db.prepare(`
            SELECT * FROM fixed_assets
            WHERE month=? AND status IN ('在用','闲置') ORDER BY id
          `).all(previous));
          const insert = db.prepare(`
            INSERT OR IGNORE INTO fixed_assets
              (month,asset_key,asset_name,category,purchase_date,
               purchase_price,status,note)
            VALUES (?,?,?,?,?,?,?,?)
          `);
          source.forEach((row) => {
            insert.run(
              month, text(row.asset_key), text(row.asset_name), text(row.category),
              text(row.purchase_date) || null, Number(row.purchase_price ?? 0),
              text(row.status) || "在用", text(row.note)
            );
          });
          inherited = source.length;
        }
      }
      db.prepare(`
        INSERT INTO month_status
          (month,status,fixed_assets_initialized,updated_at,revision)
        VALUES (?,?,1,?,0)
        ON CONFLICT(month) DO UPDATE SET
          fixed_assets_initialized=1,updated_at=excluded.updated_at
      `).run(month, text(current?.status) || "draft", localTimestamp());
      return inherited;
    });
  }

  private normalizedTransactions(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): { rows: Transaction[]; issues: ValidationIssue[] } {
    const categories = this.categoryRows(db);
    const byKey = new Map(categories.map((row) => [row.category_key, row]));
    const byName = new Map(categories.map((row) => [row.name, row]));
    const issues = validateTransactions(input, month, categories);
    const normalized = input.map((row) => {
      const type = text(row.type);
      let definition = byKey.get(text(row.category_key)) ?? byName.get(text(row.category));
      if (["代付", "加仓", "提现"].includes(type)) definition = undefined;
      let transactionDate: string;
      try {
        transactionDate = normalizeDate(row.transaction_date, month);
      } catch {
        transactionDate = `${month}-01`;
      }
      let amount: number;
      try {
        amount = finiteNumber(row.amount);
      } catch {
        amount = 0;
      }
      return {
        ...row,
        transaction_date: transactionDate,
        type,
        counterparty: text(row.counterparty),
        product: text(row.product),
        amount,
        category_key: definition?.category_key ?? null,
        category: definition?.name ?? ""
      };
    });
    return {
      rows: normalized,
      issues
    };
  }

  validateTransactionRows(month: string, input: Transaction[]): ValidationIssue[] {
    return this.normalizedTransactions(this.db(), month, input).issues;
  }

  private saveTransactionRows(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): Transaction[] {
    const normalized = this.normalizedTransactions(db, month, input);
    if (normalized.issues.some((issue) => issue.blocking)) {
      throw new RepositoryValidationError("流水质检未通过", normalized.issues);
    }
    const existing = new Set(rows(db.prepare(
      "SELECT id FROM transactions WHERE month=?"
    ).all(month)).map((row) => Number(row.id)));
    const submitted = new Set<number>();
    const insert = db.prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category_key,category,counterparty,product,amount)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE transactions SET
        transaction_date=?,type=?,category_key=?,category=?,counterparty=?,product=?,amount=?
      WHERE id=? AND month=?
    `);
    for (const row of normalized.rows) {
      const values = [
        row.transaction_date, row.type, row.category_key ?? null,
        row.category, row.counterparty ?? "", row.product, row.amount
      ] as const;
      if (row.id === undefined) {
        row.id = Number(insert.run(month, ...values).lastInsertRowid);
      } else {
        const id = Number(row.id);
        if (!existing.has(id) || submitted.has(id)) {
          throw new RepositoryValidationError("流水 id 不属于当前月份或重复");
        }
        submitted.add(id);
        update.run(...values, id, month);
      }
    }
    const remove = db.prepare("DELETE FROM transactions WHERE id=?");
    for (const id of existing) if (!submitted.has(id)) remove.run(id);
    return rows(db.prepare(`
      SELECT id,transaction_date,type,category_key,category,counterparty,product,amount
      FROM transactions WHERE month=? ORDER BY id
    `).all(month)).map(transactionFromRow);
  }

  async saveMonth(
    month: string,
    expectedRevision: number,
    cashAccounts: CashAccountBalance[],
    investmentAccounts: InvestmentAccountBalance[],
    transactions: Transaction[],
    fixedAssets: FixedAsset[]
  ): Promise<MonthWorkspace> {
    const revision = await this.manager.write((db) => {
      const current = this.checkMonthRevision(db, month, expectedRevision);
      const definitions = new Map(rows(db.prepare(
        "SELECT account_key,account_type FROM account_definitions"
      ).all()).map((row) => [text(row.account_key), text(row.account_type)]));
      db.prepare("DELETE FROM cash_account_balances WHERE month=?").run(month);
      const seenCash = new Set<string>();
      const cashInsert = db.prepare(
        "INSERT INTO cash_account_balances(month,account_key,balance) VALUES (?,?,?)"
      );
      cashAccounts.forEach((row) => {
        const key = text(row.account_key);
        if (definitions.get(key) !== "cash" || seenCash.has(key)) {
          throw new RepositoryValidationError("现金账户无效或重复");
        }
        seenCash.add(key);
        cashInsert.run(month, key, finiteNumber(row.balance, { nonNegative: true }));
      });
      db.prepare("DELETE FROM investment_account_balances WHERE month=?").run(month);
      const seenInvestment = new Set<string>();
      const investmentInsert = db.prepare(`
        INSERT INTO investment_account_balances
          (month,account_key,principal,market_value,cash_balance)
        VALUES (?,?,?,?,?)
      `);
      investmentAccounts.forEach((row) => {
        const key = text(row.account_key);
        if (definitions.get(key) !== "investment" || seenInvestment.has(key)) {
          throw new RepositoryValidationError("理财账户无效或重复");
        }
        seenInvestment.add(key);
        investmentInsert.run(
          month, key,
          finiteNumber(row.principal, { nonNegative: true }),
          finiteNumber(row.market_value, { nonNegative: true }),
          finiteNumber(row.cash_balance, { nonNegative: true })
        );
      });
      this.saveTransactionRows(db, month, transactions);
      const existingAssets = new Map(rows(db.prepare(
        "SELECT id,asset_key FROM fixed_assets WHERE month=?"
      ).all(month)).map((row) => [text(row.asset_key), Number(row.id)]));
      const submittedAssets = new Set<string>();
      const insertAsset = db.prepare(`
        INSERT INTO fixed_assets
          (month,asset_key,asset_name,category,purchase_date,purchase_price,status,note)
        VALUES (?,?,?,?,?,?,?,?)
      `);
      const updateAsset = db.prepare(`
        UPDATE fixed_assets SET
          asset_name=?,category=?,purchase_date=?,purchase_price=?,status=?,note=?
        WHERE id=? AND month=?
      `);
      fixedAssets.forEach((source, index) => {
        const row = normalizeAsset(source, index);
        if (submittedAssets.has(row.asset_key)) {
          throw new RepositoryValidationError("固定资产 asset_key 重复");
        }
        submittedAssets.add(row.asset_key);
        const id = existingAssets.get(row.asset_key);
        const values = [
          row.asset_name, row.category, row.purchase_date ?? null,
          row.purchase_price, row.status, row.note
        ] as const;
        if (id) updateAsset.run(...values, id, month);
        else insertAsset.run(month, row.asset_key, ...values);
      });
      for (const [key, id] of existingAssets) {
        if (!submittedAssets.has(key)) {
          db.prepare("DELETE FROM fixed_assets WHERE id=?").run(id);
        }
      }
      return this.touchMonth(db, month, current, 1);
    });
    const result = await this.getMonth(month);
    result.revision = revision;
    return result;
  }

  private monthlyByMonth(
    db: DatabaseSync,
    categories: CategoryDefinition[]
  ): Map<string, MonthlyCalculation> {
    const grouped = new Map<string, Transaction[]>();
    for (const row of rows(db.prepare(
      "SELECT * FROM transactions ORDER BY month,id"
    ).all())) {
      const month = text(row.month);
      const group = grouped.get(month) ?? [];
      group.push(transactionFromRow(row));
      grouped.set(month, group);
    }
    return new Map([...grouped].map(([month, values]) => [
      month,
      calculateMonthly(values, categories, this.options.largeExpenseThreshold)
    ]));
  }

  private activeDebt(db: DatabaseSync, month: string): number {
    const end = monthEnd(month);
    return sum(rows(db.prepare(`
      SELECT amount FROM debt_manager
      WHERE REPLACE(start_date,'/','-')<=?
        AND (is_paid=0 OR REPLACE(paid_date,'/','-')>?)
    `).all(end, end)).map((row) => Number(row.amount ?? 0)));
  }

  private annualRows(db = this.db()): ExtendedAnnualRow[] {
    const categories = this.categoryRows(db);
    const monthly = this.monthlyByMonth(db, categories);
    const cash = new Map(rows(db.prepare(`
      SELECT month,SUM(balance) AS total
      FROM cash_account_balances GROUP BY month
    `).all()).map((row) => [text(row.month), Number(row.total ?? 0)]));
    const investments = new Map(rows(db.prepare(`
      SELECT month,SUM(principal) AS principal,SUM(market_value) AS market_value,
             SUM(cash_balance) AS cash_balance
      FROM investment_account_balances GROUP BY month
    `).all()).map((row) => [text(row.month), row]));
    return buildAnnualRows(this.getMonths(db).map((month) => {
      const investment = investments.get(month);
      return {
        month,
        cash: cash.get(month) ?? 0,
        debt: this.activeDebt(db, month),
        principal: Number(investment?.principal ?? 0),
        market_value: Number(investment?.market_value ?? 0),
        investment_cash: Number(investment?.cash_balance ?? 0),
        monthly: monthly.get(month)
          ?? calculateMonthly([], categories, this.options.largeExpenseThreshold)
      };
    }));
  }

  private anomalyRows(
    db: DatabaseSync,
    month: string,
    current: Transaction[],
    categories: CategoryDefinition[]
  ): MonthOverview["anomalies"] {
    const history = rows(db.prepare(`
      SELECT month,type,category,counterparty,product,amount FROM transactions
      WHERE month>=? AND month<? ORDER BY month,id
    `).all(shiftMonth(month, -12), month));
    const currentExpense = current.filter((row) => row.type === "支出");
    const currentByCategory = new Map<string, number>();
    currentExpense.forEach((row) => {
      currentByCategory.set(
        row.category,
        (currentByCategory.get(row.category) ?? 0) + row.amount
      );
    });
    const periodic = new Set(categories.filter(
      (row) => row.transaction_type === "支出" && row.pattern === "周期"
    ).map((row) => row.name));
    const bigTicketCategories = new Set(categories.filter(
      (row) => row.transaction_type === "支出" && row.is_big_ticket
    ).map((row) => row.name));
    const categoryChanges: Array<Record<string, string | number>> = [];
    const missingPeriodic: Array<Record<string, string | number>> = [];
    for (const window of [1, 3]) {
      const months = previousMonths(month, window);
      const selected = history.filter(
        (row) => row.type === "支出" && months.includes(text(row.month))
      );
      if (!selected.length) continue;
      const monthCategory = new Map<string, Map<string, number>>();
      months.forEach((value) => monthCategory.set(value, new Map()));
      selected.forEach((row) => {
        const values = monthCategory.get(text(row.month))!;
        const category = text(row.category);
        values.set(category, (values.get(category) ?? 0) + Number(row.amount ?? 0));
      });
      const allCategories = new Set(currentByCategory.keys());
      monthCategory.forEach((values) => values.forEach((_amount, category) => allCategories.add(category)));
      const label = window === 1 ? "较上月" : `较近${window}月均值`;
      for (const category of [...allCategories].sort()) {
        const currentAmount = currentByCategory.get(category) ?? 0;
        const average = sum(months.map(
          (value) => monthCategory.get(value)?.get(category) ?? 0
        )) / window;
        const delta = currentAmount - average;
        const appeared = months.filter(
          (value) => (monthCategory.get(value)?.get(category) ?? 0) > 0
        ).length;
        if (
          periodic.has(category) && currentAmount <= 0
          && appeared >= (window === 1 ? 1 : 2) && average > 0
        ) {
          missingPeriodic.push({
            "对比口径": label,
            "分类": category,
            "历史出现月数": appeared,
            "历史基准": roundHalfEven(average),
            "判断": "周期项本月未出现，建议确认是否漏记或已取消"
          });
        }
        const threshold = Math.max(100, average * 0.3);
        if (
          bigTicketCategories.has(category)
          || Math.abs(delta) < threshold
        ) {
          continue;
        }
        categoryChanges.push({
          "对比口径": label,
          "分类": category,
          "本月金额": roundHalfEven(currentAmount),
          "历史基准": roundHalfEven(average),
          "触发阈值": roundHalfEven(threshold),
          "增减方向": delta > 0 ? "增加" : delta < 0 ? "减少" : "持平",
          "增减金额": roundHalfEven(delta),
          "增减比例": average <= 0 && currentAmount > 0
            ? "新增"
            : average > 0 ? `${roundHalfEven(delta / average * 100, 1).toFixed(1)}%` : "0.0%"
        });
      }
    }
    categoryChanges.sort((left, right) =>
      String(left["对比口径"]).localeCompare(String(right["对比口径"]))
      || Math.abs(Number(right["增减金额"])) - Math.abs(Number(left["增减金额"]))
    );
    const historyProducts = new Set(history.map((row) => text(row.product)));
    const products = new Map<string, { category: string; amount: number }>();
    currentExpense.forEach((row) => {
      const existing = products.get(row.product) ?? { category: row.category, amount: 0 };
      existing.amount += row.amount;
      products.set(row.product, existing);
    });
    const newBig = [...products]
      .filter(([product, value]) =>
        product
        && value.amount >= this.options.largeExpenseThreshold
        && !historyProducts.has(product)
      )
      .map(([product, value]) => ({
        "商品": product,
        "分类": value.category,
        "金额": roundHalfEven(value.amount),
        "判断": "过去 12 个月未出现的大额商品"
      }))
      .sort((left, right) => right["金额"] - left["金额"]);
    return {
      category_changes: categoryChanges,
      new_big_items: newBig,
      missing_periodic: missingPeriodic
    };
  }

  private monthOverview(
    db: DatabaseSync,
    month: string,
    transactions: Transaction[],
    categories: CategoryDefinition[]
  ): MonthOverview {
    const allRows = this.annualRows(db);
    const rowIndex = allRows.findIndex((row) => row.month === month);
    if (rowIndex < 0) return { available: false };
    const row = allRows[rowIndex];
    const monthly = calculateMonthly(
      transactions,
      categories,
      this.options.largeExpenseThreshold
    );
    const cashAccounts = this.cashAccounts(db, month);
    const cashTotal = sum(cashAccounts.map((account) => account.balance));
    const investments = this.investmentAccounts(db, month);
    const principal = sum(investments.map((account) => account.principal));
    const marketValue = sum(investments.map((account) => account.market_value));
    const investmentCash = sum(investments.map((account) => account.cash_balance));
    const position = marketValue + investmentCash;
    const previous = rowIndex > 0 ? allRows[rowIndex - 1] : null;
    const previousValue = previousMonth(month);
    const previousTransactions = previousValue
      ? rows(db.prepare(
        "SELECT * FROM transactions WHERE month=? ORDER BY id"
      ).all(previousValue)).map(transactionFromRow)
      : [];
    const previousMonthly = calculateMonthly(
      previousTransactions,
      categories,
      this.options.largeExpenseThreshold
    );
    const previousInvestment = previousValue
      ? db.prepare(`
          SELECT COUNT(*) AS count,
                 COALESCE(SUM(market_value),0) + COALESCE(SUM(cash_balance),0)
                   AS position
          FROM investment_account_balances WHERE month=?
        `).get(previousValue) as Row
      : null;
    const previousPosition = previousInvestment
      && Number(previousInvestment.count) > 0
      ? Number(previousInvestment.position ?? 0)
      : null;
    const comparison = [...new Set([
      ...Object.keys(monthly.category_summary),
      ...Object.keys(previousMonthly.category_summary)
    ])].filter((category) =>
      !categories.find((definition) => definition.name === category)?.is_big_ticket
    ).sort().map((category) => ({
      category,
      current: monthly.category_summary[category] ?? 0,
      previous: previousMonthly.category_summary[category] ?? 0,
      delta: roundHalfEven(
        (monthly.category_summary[category] ?? 0)
        - (previousMonthly.category_summary[category] ?? 0)
      )
    }));
    const necessary = monthly.structure.necessary;
    const controlled = monthly.structure.controlled;
    const structureTotal = necessary + controlled;
    const surplus = row.total_income - row.total_expense;
    return {
      available: true,
      metrics: {
        asset_delta: row.asset_delta,
        total_income: row.total_income,
        total_expense: row.total_expense,
        surplus: roundHalfEven(surplus),
        savings_rate: row.total_income > 0
          ? roundHalfEven(surplus / row.total_income * 100) : null,
        cost_assets: row.cost_assets,
        market_net_assets: row.market_net_assets,
        total_assets: row.total_assets
      },
      cash_accounts: cashAccounts.map((account) => ({
        account: account.account ?? account.name ?? "",
        balance: account.balance,
        share_percent: (account as CashAccountBalance & { share_percent: number }).share_percent
      })),
      cash_total: cashTotal,
      investment: {
        principal,
        market_value: marketValue,
        cash_balance: investmentCash,
        position: roundHalfEven(position),
        profit: roundHalfEven(position - principal),
        roi_percent: principal > 0
          ? roundHalfEven((position - principal) / principal * 100, 1) : 0,
        comparison: {
          available: previousPosition !== null,
          previous_position: previousPosition,
          amount_delta: previousPosition === null
            ? null
            : roundHalfEven(position - previousPosition),
          percent_delta: previousPosition === null || previousPosition === 0
            ? null
            : roundHalfEven(
              (position - previousPosition) / previousPosition * 100,
              1
            )
        }
      },
      reconciliation: {
        available: row.theoretical_expense !== null,
        actual: {
          all_out: monthly.all_out,
          daifu: monthly.total_daifu,
          net_expense: monthly.total_expense
        },
        theoretical: {
          previous_cash: previous?.cash ?? null,
          income: row.total_income,
          debt_change: row.debt_change,
          cash: row.cash,
          deposit: row.total_deposit,
          withdraw: row.total_withdraw,
          net_expense: row.theoretical_expense
        },
        discrepancy: row.discrepancy,
        explanation: explainReconciliation(
          row.discrepancy,
          this.options.reconciliationTolerance
        )
      },
      anomalies: this.anomalyRows(db, month, transactions, categories),
      structure: {
        necessary,
        controlled,
        controlled_percent: structureTotal > 0
          ? roundHalfEven(controlled / structureTotal * 100, 1) : 0,
        leverage: necessary > 0 ? roundHalfEven(controlled / necessary) : 0,
        periodic: monthly.structure.periodic,
        daily: monthly.structure.daily,
        occasional: monthly.structure.occasional,
        necessary_categories: categories.filter(
          (category) =>
            category.transaction_type === "支出" && category.necessity === "必要"
        ).map((category) => category.name),
        controlled_categories: categories.filter(
          (category) =>
            category.transaction_type === "支出" && category.necessity === "可控"
        ).map((category) => category.name)
      },
      category_summary: Object.entries(monthly.category_summary)
        .filter(([, amount]) => amount > 0)
        .sort((left, right) => right[1] - left[1])
        .map(([category, amount]) => ({ category, amount })),
      category_comparison: {
        available: previousTransactions.length > 0,
        previous_month: previousValue,
        rows: comparison
      },
      big_tickets: monthly.big_tickets
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
    return {
      month,
      revision: this.getRevision(month, db),
      status: this.getMonthStatus(month, db),
      cash_accounts: this.cashAccounts(db, month),
      investment_accounts: this.investmentAccounts(db, month),
      transactions,
      fixed_assets: rows(db.prepare(
        "SELECT * FROM fixed_assets WHERE month=? ORDER BY id"
      ).all(month)).map(fixedAssetFromRow),
      computed: calculateMonthly(
        transactions,
        categories,
        this.options.largeExpenseThreshold
      ) as unknown as Record<string, unknown>,
      overview: this.monthOverview(db, month, transactions, categories)
    };
  }

  rules(db = this.db()): { revision: number; rows: Row[] } {
    const raw = rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all());
    const transactions = rows(db.prepare(`
      SELECT month,type,counterparty,product FROM transactions
      WHERE type IN ('支出','收入')
    `).all());
    return buildRuleReport(raw, transactions);
  }
  private writeRules(db: DatabaseSync, input: Row[]): void {
    const categories = this.categoryRows(db);
    const byKey = new Map(categories.map((row) => [row.category_key, row]));
    const byName = new Map(categories.map((row) => [row.name, row]));
    const existing = new Set(rows(db.prepare(
      "SELECT id FROM auto_rules"
    ).all()).map((row) => Number(row.id)));
    const submitted = new Set<number>();
    const keys = new Set<string>();
    const insert = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE auto_rules SET
        transaction_type=?,counterparty=?,product=?,category_key=?,category=?
      WHERE id=?
    `);
    for (const source of input) {
      const counterparty = text(source.counterparty);
      const product = text(source.product);
      const category = byKey.get(text(source.category_key))
        ?? byName.get(text(source.category));
      const type = text(source.transaction_type) || category?.transaction_type || "";
      if ((!counterparty && !product) || !category) {
        throw new RepositoryValidationError(
          "自动规则必须填写交易对方或商品，并选择分类"
        );
      }
      if (!category.is_active && (source.id === undefined || source.id === null)) {
        throw new RepositoryValidationError("新自动规则不能使用停用分类");
      }
      if (!RULE_TYPES.has(type)) {
        throw new RepositoryValidationError("自动规则的收支类型只能是支出或收入");
      }
      if (category.transaction_type !== type) {
        throw new RepositoryValidationError(`${type}规则不能使用分类“${category.name}”`);
      }
      const key = [
        type,
        normalizeProductKey(counterparty),
        normalizeProductKey(product)
      ].join("\u0000");
      if (keys.has(key)) {
        throw new RepositoryValidationError(
          "同一收支类型下不能存在重复或等价交易规则"
        );
      }
      keys.add(key);
      if (source.id === undefined || source.id === null) {
        insert.run(
          type,
          counterparty,
          product,
          category.category_key,
          category.name
        );
      } else {
        const id = Number(source.id);
        if (!existing.has(id) || submitted.has(id)) {
          throw new RepositoryValidationError("自动规则 id 无效或重复");
        }
        submitted.add(id);
        update.run(
          type,
          counterparty,
          product,
          category.category_key,
          category.name,
          id
        );
      }
    }
    for (const id of existing) if (!submitted.has(id)) {
      db.prepare("DELETE FROM auto_rules WHERE id=?").run(id);
    }
  }

  async saveRules(expectedRevision: number, input: Row[]): Promise<{ revision: number; rows: Row[] }> {
    await this.manager.write((db) => {
      const current = this.rules(db);
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, current.revision);
      }
      this.writeRules(db, input);
    });
    return this.rules();
  }

  rulesPreview(month: string, input: Transaction[]): {
    base_revision: number;
    rules_revision: number;
    proposed_rows: Transaction[];
    issues: Array<Record<string, unknown>>;
  } {
    const rules = this.rules();
    const resolvedRules = rules.rows.map((row) => ({
      id: Number(row.id),
      transaction_type: text(row.transaction_type),
      counterparty: text(row.counterparty),
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category)
    }));
    const result = applyRulesWithIssues(input, resolvedRules);
    return {
      base_revision: this.getRevision(month),
      rules_revision: rules.revision,
      proposed_rows: result.proposed_rows,
      issues: result.issues as unknown as Array<Record<string, unknown>>
    };
  }

  private savedHistoryRows(
    db: DatabaseSync,
    query: ProductHistoryQuery = {}
  ): Row[] {
    const conditions = ["t.type IN ('支出','收入')"];
    const parameters: string[] = [];
    if (query.transaction_type) {
      conditions.push("t.type=?");
      parameters.push(query.transaction_type);
    }
    if (query.category_key !== undefined) {
      if (query.category_key === null) {
        conditions.push("COALESCE(t.category_key,'')=''");
      } else {
        conditions.push("t.category_key=?");
        parameters.push(query.category_key);
      }
    }
    if (query.from_month) {
      conditions.push("t.month>=?");
      parameters.push(query.from_month);
    }
    if (query.to_month) {
      conditions.push("t.month<=?");
      parameters.push(query.to_month);
    }
    const productSearch = scalarText(query.product_search).trim();
    if (productSearch) {
      conditions.push("LOWER(COALESCE(t.product,'')) LIKE LOWER(?)");
      parameters.push(`%${productSearch}%`);
    }
    const history = rows(db.prepare(`
      SELECT t.id,t.month,t.transaction_date,t.type,t.category_key,t.category,
             t.counterparty,t.product,t.amount,d.is_active AS category_active
      FROM transactions t
      JOIN month_status m ON m.month=t.month AND m.status='saved'
      LEFT JOIN category_definitions d ON d.category_key=t.category_key
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.type,t.product,t.month,t.transaction_date,t.id
    `).all(...parameters));
    const normalizedSearch = normalizeProductKey(productSearch);
    return history.filter((row) => {
      if (query.transaction_type && text(row.type) !== query.transaction_type) return false;
      if (query.product_key !== undefined
        && normalizeProductKey(row.product) !== normalizeProductKey(query.product_key)) return false;
      if (query.category_key !== undefined) {
        const key = text(row.category_key);
        if (query.category_key === null ? key : key !== query.category_key) return false;
      }
      if (query.from_month && text(row.month) < query.from_month) return false;
      if (query.to_month && text(row.month) > query.to_month) return false;
      if (normalizedSearch && !normalizeProductKey(row.product).includes(normalizedSearch)) return false;
      return true;
    });
  }

  private historicalCategoryCounts(
    group: Row[],
    categories: CategoryDefinition[]
  ): HistoricalCategoryCount[] {
    const byKey = new Map(categories.map((category) => [category.category_key, category]));
    const counts = new Map<string, HistoricalCategoryCount>();
    for (const row of group) {
      const categoryKey = text(row.category_key) || null;
      const definition = categoryKey ? byKey.get(categoryKey) : undefined;
      const key = categoryKey ?? "__uncategorized__";
      const current = counts.get(key) ?? {
        category_key: categoryKey,
        category: definition?.name ?? (text(row.category) || "未分类"),
        occurrences: 0,
        is_active: categoryKey ? definition?.is_active ?? false : undefined
      };
      current.occurrences += 1;
      counts.set(key, current);
    }
    return [...counts.values()].sort((left, right) =>
      right.occurrences - left.occurrences
      || left.category.localeCompare(right.category)
    );
  }

  private productCategoryStatus(
    counts: HistoricalCategoryCount[]
  ): HistoricalProductStat["category_status"] {
    const assigned = counts.filter((row) => row.category_key);
    const hasUncategorized = counts.some((row) => !row.category_key);
    const hasInactive = assigned.some((row) => row.is_active === false);
    if (!assigned.length) return "未分类";
    if (assigned.length > 1 || hasUncategorized) return "混合";
    if (hasInactive) return "停用";
    return "正常";
  }

  private productStat(
    group: Row[],
    ruleMatcher: RuleMatcher,
    ruleStatusById: Map<number, string>,
    categories: CategoryDefinition[]
  ): HistoricalProductStat {
    const ordered = [...group].sort((left, right) =>
      text(left.month).localeCompare(text(right.month))
      || text(left.transaction_date).localeCompare(text(right.transaction_date))
      || Number(left.id ?? 0) - Number(right.id ?? 0)
    );
    const representative = ordered[0];
    const variants = this.frequency(group.map((row) => text(row.product)))
      .map(([value]) => value)
      .filter(Boolean);
    const counterparties = this.frequency(
      group.map((row) => text(row.counterparty)).filter(Boolean)
    ).map(([value]) => value);
    const categoryCounts = this.historicalCategoryCounts(group, categories);
    const assigned = categoryCounts.filter((row) => row.category_key);
    const recommended = assigned[0];
    const transactions = ordered.map((row) => ({
      id: Number(row.id),
      transaction_date: text(row.transaction_date),
      type: text(row.type),
      category_key: text(row.category_key) || null,
      category: text(row.category),
      counterparty: text(row.counterparty),
      product: text(row.product),
      amount: Number(row.amount ?? 0)
    } satisfies Transaction));
    const matchingRuleIds = new Set<number>();
    const matchingRuleLevels = new Set<RuleMatchLevel>();
    const resolutions = transactions.map((transaction) => {
      for (const rule of ruleMatcher.matchingRules(transaction)) {
        const id = Number(rule.id);
        if (Number.isFinite(id) && id > 0) matchingRuleIds.add(id);
        const level = ruleMatchLevel(rule);
        if (level) matchingRuleLevels.add(level);
      }
      return ruleMatcher.resolve(transaction);
    });
    const orderedMatchingRuleIds = ruleMatcher.orderedRuleIds(matchingRuleIds);
    const ruleIds = [...new Set([
      ...resolutions.flatMap((resolution) => resolution.rule_ids),
      ...orderedMatchingRuleIds
    ])];
    const matchedOccurrences = resolutions.filter(
      (resolution) => resolution.status === "matched"
    ).length;
    const unmatchedRows = ordered.filter(
      (_row, index) => resolutions[index].status === "none"
    );
    const unmatchedOccurrences = unmatchedRows.length;
    const conflictedOccurrences = resolutions.filter(
      (resolution) => resolution.status === "conflict"
    ).length;
    const ruleCoverage: HistoricalProductStat["rule_coverage"] =
      matchedOccurrences === ordered.length
        ? "full"
        : matchedOccurrences > 0
          ? "partial"
          : "none";
    const hasRuleConflict = resolutions.some((resolution) => resolution.status === "conflict")
      || ruleIds.some((id) => ruleStatusById.get(id) === "冲突");
    const hasRuleDuplicate = ruleIds.some((id) => ruleStatusById.get(id) === "重复");
    const historyRuleMismatch = ordered.some((row, index) => {
      const resolution = resolutions[index];
      return resolution.status === "matched"
        && (resolution.category_key ?? "") !== text(row.category_key);
    });
    const ruleStatus: HistoricalProductStat["rule_status"] = hasRuleConflict
      ? "冲突"
      : hasRuleDuplicate
        ? "重复"
        : ruleIds.length
          ? "已覆盖"
          : "未创建";
    const totalAmount = group.reduce((total, row) => total + Number(row.amount ?? 0), 0);
    const last = ordered.at(-1) ?? representative;
    const unmatchedCategoryCounts = this.historicalCategoryCounts(
      unmatchedRows,
      categories
    );
    const unmatchedAssigned = unmatchedCategoryCounts.filter(
      (row) => row.category_key
    );
    const unmatchedRecommended = unmatchedAssigned[0];
    const stableUnmatchedCategory = unmatchedAssigned.length === 1
      && unmatchedAssigned[0].occurrences === unmatchedRows.length
      && Boolean(unmatchedRecommended?.category_key);
    const unmatchedCounterparties = this.frequency(
      unmatchedRows.map((row) => text(row.counterparty)).filter(Boolean)
    ).map(([value]) => value);
    const suggestedCounterparty = unmatchedCounterparties.length === 1
      ? unmatchedCounterparties[0]
      : "";
    const unmatchedVariants = this.frequency(
      unmatchedRows.map((row) => text(row.product))
    ).map(([value]) => value).filter(Boolean);
    const suggestedProduct = unmatchedVariants[0] ?? "";
    const ruleSuggestion = !hasRuleConflict
      && unmatchedOccurrences > 0
      && stableUnmatchedCategory
      && (suggestedCounterparty || suggestedProduct)
      ? {
          transaction_type: text(representative.type) as "支出" | "收入",
          counterparty: suggestedCounterparty,
          product: suggestedProduct,
          category_key: unmatchedRecommended?.category_key ?? "",
          category: unmatchedRecommended?.category ?? "",
          variants: unmatchedVariants,
          category_counts: unmatchedCategoryCounts,
          category_confidence: roundHalfEven(
            (unmatchedRecommended?.occurrences ?? 0) / unmatchedRows.length,
            4
          ),
          occurrences: unmatchedOccurrences,
          months_count: new Set(
            unmatchedRows.map((row) => text(row.month))
          ).size,
          last_month: text(unmatchedRows.at(-1)?.month)
        }
      : undefined;
    return {
      transaction_type: text(representative.type) as "支出" | "收入",
      product_key: normalizeProductKey(representative.product),
      product: variants[0] ?? "",
      counterparty: counterparties[0] ?? "",
      variants,
      counterparties,
      counterparty_count: counterparties.length,
      category_counts: categoryCounts,
      recommended_category: recommended?.category ?? "",
      recommended_category_key: recommended?.category_key ?? null,
      category_confidence: recommended
        ? roundHalfEven(recommended.occurrences / group.length, 4)
        : 0,
      has_category_conflict: assigned.length > 1,
      category_status: this.productCategoryStatus(categoryCounts),
      occurrences: group.length,
      months_count: new Set(group.map((row) => text(row.month))).size,
      total_amount: roundHalfEven(totalAmount),
      average_amount: roundHalfEven(totalAmount / group.length),
      latest_amount: roundHalfEven(Number(last.amount ?? 0)),
      last_date: text(last.transaction_date),
      first_month: text(ordered[0]?.month),
      last_month: text(last.month),
      matching_rule_count: ruleIds.length,
      matching_rule_ids: ruleIds,
      matching_rule_levels: [...matchingRuleLevels],
      rule_coverage: ruleCoverage,
      matched_occurrences: matchedOccurrences,
      unmatched_occurrences: unmatchedOccurrences,
      conflicted_occurrences: conflictedOccurrences,
      rule_suggestion: ruleSuggestion,
      rule_status: ruleStatus,
      history_rule_mismatch: historyRuleMismatch
    };
  }

  private normalizedRuleRows(db: DatabaseSync): {
    data: ReturnType<AssetTrackRepository["rules"]>;
    rows: RuleRow[];
    matcher: RuleMatcher;
    statusById: Map<number, string>;
  } {
    const data = this.rules(db);
    const rows = data.rows.map((row) => ({
      id: Number(row.id),
      transaction_type: text(row.transaction_type),
      counterparty: text(row.counterparty),
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category)
    } satisfies RuleRow));
    return {
      data,
      rows,
      matcher: new RuleMatcher(rows),
      statusById: new Map(data.rows.map((row) => [Number(row.id), text(row.rule_status)]))
    };
  }

  private buildRuleConflictGroups(
    ruleData: ReturnType<AssetTrackRepository["normalizedRuleRows"]>,
    history: Row[]
  ): RuleConflictGroup[] {
    type Edge = { kind: RuleConflictGroup["kind"]; left: number; right: number };
    const edges: Edge[] = [];
    for (let leftIndex = 0; leftIndex < ruleData.rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ruleData.rows.length; rightIndex += 1) {
        const left = ruleData.rows[leftIndex];
        const right = ruleData.rows[rightIndex];
        const leftCategory = normalizeProductKey(left.category_key) || normalizeProductKey(left.category);
        const rightCategory = normalizeProductKey(right.category_key) || normalizeProductKey(right.category);
        if (rulesEquivalent(left, right)) {
          edges.push({
            kind: leftCategory === rightCategory ? "duplicate" : "same-condition",
            left: Number(left.id),
            right: Number(right.id)
          });
          continue;
        }
        const leftLevel = ruleMatchLevel(left);
        const rightLevel = ruleMatchLevel(right);
        const samePrecision = leftLevel !== null && leftLevel === rightLevel;
        const exactOverBroad =
          (leftLevel === "exact" && rightLevel !== null && rightLevel !== "exact")
          || (rightLevel === "exact" && leftLevel !== null && leftLevel !== "exact");
        if (
          rulesOverlap(left, right)
          && (samePrecision || exactOverBroad)
          && leftCategory !== rightCategory
        ) {
          edges.push({ kind: "overlap", left: Number(left.id), right: Number(right.id) });
        }
      }
    }
    const savedRules = ruleData.data.rows as unknown as SavedRule[];
    const savedById = new Map(savedRules.map((rule) => [Number(rule.id), rule]));
    const groups: RuleConflictGroup[] = [];
    for (const kind of ["duplicate", "same-condition", "overlap"] as const) {
      const kindEdges = edges.filter((edge) => edge.kind === kind);
      const adjacency = new Map<number, Set<number>>();
      for (const edge of kindEdges) {
        const left = adjacency.get(edge.left) ?? new Set<number>();
        const right = adjacency.get(edge.right) ?? new Set<number>();
        left.add(edge.right);
        right.add(edge.left);
        adjacency.set(edge.left, left);
        adjacency.set(edge.right, right);
      }
      const visited = new Set<number>();
      for (const start of adjacency.keys()) {
        if (visited.has(start)) continue;
        const component: number[] = [];
        const queue = [start];
        visited.add(start);
        while (queue.length) {
          const current = queue.shift()!;
          component.push(current);
          for (const neighbor of adjacency.get(current) ?? []) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
        component.sort((left, right) => left - right);
        const componentRules = component
          .map((id) => savedById.get(id))
          .filter((rule): rule is SavedRule => Boolean(rule));
        const componentRuleIds = new Set(componentRules.map((rule) => Number(rule.id)));
        const affected = history.filter((row) => ruleData.matcher.matchingRules(
          transactionFromRow(row)
        ).some((rule) => componentRuleIds.has(Number(rule.id))));
        groups.push({
          conflict_key: `${kind}:${component.join(",")}`,
          kind,
          rule_ids: component,
          rules: componentRules,
          affected_transaction_count: affected.length,
          affected_months: [...new Set(affected.map((row) => text(row.month)))].sort(),
          description: kind === "duplicate"
            ? "规则条件和分类完全相同"
            : kind === "same-condition"
              ? "规则条件相同但分类不同"
              : "规则条件重叠且分类不同"
        });
      }
    }
    return groups.sort((left, right) =>
      left.kind.localeCompare(right.kind)
      || right.affected_transaction_count - left.affected_transaction_count
      || left.conflict_key.localeCompare(right.conflict_key)
    );
  }

  private buildRuleInsights(
    db: DatabaseSync,
    minOccurrences: number
  ): {
    threshold: number;
    rules: ReturnType<AssetTrackRepository["rules"]>;
    categories: CategoryDefinition[];
    historicalProducts: HistoricalProductStat[];
    recommendations: RuleCandidate[];
    ruleConflicts: RuleConflictGroup[];
    summary: RuleHealthSummary;
  } {
    const requestedThreshold = Number(minOccurrences);
    const threshold = Number.isFinite(requestedThreshold)
      ? Math.max(1, Math.min(10_000, Math.trunc(requestedThreshold)))
      : 2;
    const ruleData = this.normalizedRuleRows(db);
    const categories = this.categoryRows(db);
    const history = this.savedHistoryRows(db);
    const ruleConflicts = this.buildRuleConflictGroups(ruleData, history);
    const productGroups = new Map<string, Row[]>();
    const exactGroups = new Map<string, Row[]>();
    for (const row of history) {
      const productKey = normalizeProductKey(row.product);
      const productGroupKey = [text(row.type), productKey].join("\u0000");
      const exactGroupKey = [
        text(row.type),
        normalizeProductKey(row.counterparty),
        productKey
      ].join("\u0000");
      const productGroup = productGroups.get(productGroupKey) ?? [];
      productGroup.push(row);
      productGroups.set(productGroupKey, productGroup);
      const exactGroup = exactGroups.get(exactGroupKey) ?? [];
      exactGroup.push(row);
      exactGroups.set(exactGroupKey, exactGroup);
    }
    const historicalProducts = [...productGroups.values()]
      .map((group) => this.productStat(
        group,
        ruleData.matcher,
        ruleData.statusById,
        categories
      ))
      .sort((left, right) =>
        right.occurrences - left.occurrences
        || left.transaction_type.localeCompare(right.transaction_type)
        || left.product.localeCompare(right.product)
      );
    const productRuleKeys = new Set<string>();
    const exactRuleKeys = new Set<string>();
    for (const rule of ruleData.rows) {
      const level = ruleMatchLevel(rule);
      const counterpartyKey = normalizeProductKey(rule.counterparty);
      const productKey = normalizeProductKey(rule.product);
      if (level === "product") {
        productRuleKeys.add(ruleIndexKey(rule.transaction_type, productKey));
      }
      if (level === "exact" || level === "counterparty") {
        exactRuleKeys.add(exactRuleIndexKey(rule.transaction_type, counterpartyKey, productKey));
      }
    }
    const productRuleExists = (type: string, productKey: string): boolean =>
      productRuleKeys.has(ruleIndexKey(type, productKey));
    const exactRuleExists = (type: string, counterpartyKey: string, productKey: string): boolean =>
      exactRuleKeys.has(exactRuleIndexKey(type, counterpartyKey, productKey));
    const recommendations: RuleCandidate[] = [];
    for (const group of exactGroups.values()) {
      if (group.length < threshold) continue;
      const representative = group[0];
      const type = text(representative.type);
      const productKey = normalizeProductKey(representative.product);
      const counterpartyKey = normalizeProductKey(representative.counterparty);
      const level = productKey ? (counterpartyKey ? "exact" : "product") : (counterpartyKey ? "counterparty" : null);
      if (!level || exactRuleExists(type, counterpartyKey, productKey)) continue;
      const stat = this.productStat(group, ruleData.matcher, ruleData.statusById, categories);
      if (
        stat.has_category_conflict
        || stat.rule_coverage !== "none"
        || stat.conflicted_occurrences > 0
        || stat.history_rule_mismatch
      ) continue;
      recommendations.push({
        transaction_type: stat.transaction_type,
        product: stat.product,
        product_key: stat.product_key,
        counterparty: stat.counterparty,
        variants: stat.variants,
        category: stat.recommended_category,
        category_key: stat.recommended_category_key,
        category_counts: stat.category_counts,
        category_confidence: stat.category_confidence,
        has_category_conflict: stat.has_category_conflict,
        occurrences: stat.occurrences,
        months_count: stat.months_count,
        last_month: stat.last_month,
        match_level: level
      });
    }
    for (const stat of historicalProducts) {
      const productKey = stat.product_key;
      const suggestion = stat.rule_suggestion;
      if (
        !productKey
        || !suggestion
        || suggestion.counterparty
        || suggestion.occurrences < threshold
        || stat.conflicted_occurrences > 0
        || productRuleExists(stat.transaction_type, productKey)
      ) continue;
      recommendations.push({
        transaction_type: suggestion.transaction_type,
        product: suggestion.product,
        product_key: normalizeProductKey(suggestion.product),
        counterparty: "",
        variants: suggestion.variants,
        category: suggestion.category,
        category_key: suggestion.category_key,
        category_counts: suggestion.category_counts,
        category_confidence: suggestion.category_confidence,
        has_category_conflict: false,
        occurrences: suggestion.occurrences,
        months_count: suggestion.months_count,
        last_month: suggestion.last_month,
        match_level: "product"
      });
    }
    recommendations.sort((left, right) =>
      right.occurrences - left.occurrences
      || left.transaction_type.localeCompare(right.transaction_type)
      || left.product.localeCompare(right.product)
      || left.counterparty.localeCompare(right.counterparty)
    );
    const conflictProducts = new Map<string, number>();
    for (const stat of historicalProducts) {
      if (!stat.has_category_conflict) continue;
      for (const category of stat.category_counts) {
        if (category.category_key) {
          conflictProducts.set(
            category.category_key,
            (conflictProducts.get(category.category_key) ?? 0) + 1
          );
        }
      }
    }
    const historicalCategoryStats = new Map<string, { count: number; months: Set<string> }>();
    for (const row of history) {
      const key = text(row.category_key);
      if (!key) continue;
      const stat = historicalCategoryStats.get(key) ?? { count: 0, months: new Set<string>() };
      stat.count += 1;
      stat.months.add(text(row.month));
      historicalCategoryStats.set(key, stat);
    }
    const ruleCounts = new Map<string, number>();
    for (const row of ruleData.data.rows) {
      const key = text(row.category_key);
      if (key) ruleCounts.set(key, (ruleCounts.get(key) ?? 0) + 1);
    }
    const enrichedCategories = categories.map((category) => {
      const historical = historicalCategoryStats.get(category.category_key);
      return {
        ...category,
        transaction_count: historical?.count ?? 0,
        impact_months: historical ? [...historical.months].sort() : [],
        rule_count: ruleCounts.get(category.category_key) ?? 0,
        conflict_product_count: conflictProducts.get(category.category_key) ?? 0
      };
    });
    const summary: RuleHealthSummary = {
      product_conflicts: historicalProducts.filter((row) => row.has_category_conflict).length,
      rule_conflicts: ruleData.data.rows.filter((row) => row.rule_status === "冲突").length,
      duplicate_rules: ruleData.data.rows.filter((row) => row.rule_status === "重复").length,
      rule_conflict_groups: ruleConflicts.filter((group) => group.kind !== "duplicate").length,
      duplicate_rule_groups: ruleConflicts.filter((group) => group.kind === "duplicate").length,
      inactive_category_transactions: history.filter((row) =>
        Boolean(text(row.category_key)) && row.category_active !== 1 && row.category_active !== true
      ).length,
      uncategorized_transactions: history.filter((row) => !text(row.category_key)).length,
      stable_products_without_rule: historicalProducts.filter((row) =>
        Boolean(row.rule_suggestion)
      ).length
    };
    return {
      threshold,
      rules: ruleData.data,
      categories: enrichedCategories,
      historicalProducts,
      recommendations,
      ruleConflicts,
      summary
    };
  }

  ruleInsights(minOccurrences = 2): RuleInsights {
    const db = this.db();
    const data = this.buildRuleInsights(db, minOccurrences);
    return {
      rules_revision: data.rules.revision,
      categories_revision: contentRevision(this.categoryRows(db) as unknown as Row[]),
      min_occurrences: data.threshold,
      recommendations: data.recommendations,
      historical_products: data.historicalProducts,
      rule_conflicts: data.ruleConflicts,
      summary: data.summary
    };
  }

  ruleWorkspace(minOccurrences = 2): RuleWorkspace {
    const db = this.db();
    const data = this.buildRuleInsights(db, minOccurrences);
    return {
      categories_revision: contentRevision(this.categoryRows(db) as unknown as Row[]),
      rules_revision: data.rules.revision,
      categories: data.categories,
      rules: data.rules.rows as unknown as SavedRule[],
      recommendations: data.recommendations,
      historical_products: data.historicalProducts,
      rule_conflicts: data.ruleConflicts,
      summary: data.summary
    };
  }

  private rawRuleDefinitions(db: DatabaseSync): SavedRule[] {
    return rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all()).map((row) => ({
      id: Number(row.id),
      transaction_type: text(row.transaction_type) as "支出" | "收入",
      counterparty: text(row.counterparty),
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category)
    }));
  }

  ruleWorkspaceShell(): RuleWorkspaceShell {
    const db = this.db();
    const categoryData = this.categories(db);
    const rawRules = rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all());
    return {
      categories_revision: categoryData.revision,
      rules_revision: contentRevision(rawRules),
      categories: categoryData.rows,
      rules: this.rawRuleDefinitions(db)
    };
  }

  ruleWorkspaceAnalytics(minOccurrences = 2): RuleWorkspaceAnalytics {
    const db = this.db();
    const data = this.buildRuleInsights(db, minOccurrences);
    return {
      categories_revision: contentRevision(this.categoryRows(db) as unknown as Row[]),
      rules_revision: data.rules.revision,
      categories: data.categories,
      rules: data.rules.rows as unknown as SavedRule[],
      recommendations: data.recommendations,
      rule_conflicts: data.ruleConflicts,
      summary: data.summary
    };
  }

  private hasProductHistoryFilter(query: ProductHistoryQuery): boolean {
    return Boolean(
      query.transaction_type
      || query.product_key !== undefined
      || query.category_key !== undefined
      || scalarText(query.product_search).trim()
      || query.issue_filter
      || query.from_month
      || query.to_month
      || query.min_occurrences !== undefined
    );
  }

  private historyStatMatchesFilter(
    stat: HistoricalProductStat,
    filter: ProductHistoryQuery["issue_filter"]
  ): boolean {
    if (!filter) return true;
    const hasInactive = stat.category_counts.some(
      (category) => Boolean(category.category_key) && category.is_active === false
    );
    const hasUncategorized = stat.category_counts.some((category) => !category.category_key);
    switch (filter) {
      case "conflict": return stat.has_category_conflict;
      case "rule-conflict": return stat.rule_status === "冲突";
      case "duplicate": return stat.rule_status === "重复";
      case "inactive": return hasInactive;
      case "uncategorized": return hasUncategorized;
      case "no-rule": return stat.unmatched_occurrences > 0;
      case "mismatch": return stat.history_rule_mismatch;
    }
  }

  private productHistoryGroups(
    db: DatabaseSync,
    query: ProductHistoryQuery
  ): {
    ruleData: ReturnType<AssetTrackRepository["normalizedRuleRows"]>;
    categories: CategoryDefinition[];
    history: Row[];
    stats: HistoricalProductStat[];
  } {
    const ruleData = this.normalizedRuleRows(db);
    const categories = this.categoryRows(db);
    const history = this.savedHistoryRows(db, {
      ...query,
      product_key: query.product_key === undefined
        ? undefined
        : normalizeProductKey(query.product_key)
    });
    const groups = new Map<string, Row[]>();
    for (const row of history) {
      const key = [text(row.type), normalizeProductKey(row.product)].join("\u0000");
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const stats = [...groups.values()]
      .map((group) => this.productStat(
        group,
        ruleData.matcher,
        ruleData.statusById,
        categories
      ))
      .filter((stat) =>
        (query.min_occurrences === undefined || stat.occurrences >= query.min_occurrences)
        && this.historyStatMatchesFilter(stat, query.issue_filter)
      );
    return { ruleData, categories, history, stats };
  }

  productHistoryIndex(query: ProductHistoryQuery): ProductHistoryIndexResult {
    if (!this.hasProductHistoryFilter(query)) {
      throw new RepositoryValidationError("商品回溯至少选择一个筛选条件后再加载");
    }
    const db = this.db();
    const data = this.productHistoryGroups(db, query);
    return {
      categories_revision: contentRevision(data.categories as unknown as Row[]),
      rules_revision: data.ruleData.data.revision,
      groups: data.stats
    };
  }

  productOverview(): ProductHistoryIndexResult {
    const db = this.db();
    const data = this.productHistoryGroups(db, {});
    return {
      categories_revision: contentRevision(data.categories as unknown as Row[]),
      rules_revision: data.ruleData.data.revision,
      groups: data.stats
    };
  }

  productHistory(query: ProductHistoryQuery): ProductHistoryResult {
    if (!this.hasProductHistoryFilter(query)) {
      throw new RepositoryValidationError("商品回溯至少选择一个筛选条件后再加载");
    }
    const db = this.db();
    const data = this.productHistoryGroups(db, query);
    const { ruleData, history, stats } = data;
    const allowedGroups = new Set(stats.map((stat) =>
      `${stat.transaction_type}\u0000${stat.product_key}`
    ));
    const rows = history
      .filter((row) => allowedGroups.has(`${text(row.type)}\u0000${normalizeProductKey(row.product)}`))
      .map((row) => {
      const transaction: Transaction = {
        id: Number(row.id),
        transaction_date: text(row.transaction_date),
        type: text(row.type),
        category_key: text(row.category_key) || null,
        category: text(row.category),
        counterparty: text(row.counterparty),
        product: text(row.product),
        amount: Number(row.amount ?? 0)
      };
      const ruleMatch = ruleData.matcher.resolve(transaction);
      const categoryActive = row.category_active === null || row.category_active === undefined
        ? null
        : boolean(row.category_active);
      return {
        id: transaction.id ?? 0,
        month: text(row.month),
        transaction_date: transaction.transaction_date,
        type: transaction.type as "支出" | "收入",
        category_key: transaction.category_key ?? null,
        category: transaction.category,
        category_active: categoryActive,
        counterparty: transaction.counterparty ?? "",
        product: transaction.product,
        amount: transaction.amount,
        rule_match: ruleMatch
      };
      });
    return { groups: stats, rows };
  }

  private backfillRows(db: DatabaseSync, transactionIds: number[]): Row[] {
    const ids = transactionIds.map((id) => Number(id));
    if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new RepositoryValidationError("请选择至少一条有效历史流水");
    }
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) {
      throw new RepositoryValidationError("回溯流水不能重复选择");
    }
    const placeholders = uniqueIds.map(() => "?").join(",");
    const selected = rows(db.prepare(`
      SELECT t.id,t.month,t.transaction_date,t.type,t.category_key,t.category,
             t.counterparty,t.product,t.amount
      FROM transactions t
      JOIN month_status m ON m.month=t.month AND m.status='saved'
      WHERE t.id IN (${placeholders})
      ORDER BY t.month,t.transaction_date,t.id
    `).all(...uniqueIds));
    if (selected.length !== uniqueIds.length) {
      throw new RepositoryValidationError("部分流水不属于已保存月份，回溯未执行");
    }
    return selected;
  }

  private backfillPreview(
    db: DatabaseSync,
    selected: Row[],
    targetCategoryKey: string
  ): CategoryBackfillPreview {
    const target = this.categoryRows(db).find(
      (category) => category.category_key === text(targetCategoryKey)
    );
    if (!target || !target.is_active) {
      throw new RepositoryValidationError("目标分类不存在或已停用");
    }
    const types = new Set(selected.map((row) => text(row.type)));
    if (types.size !== 1 || !types.has(target.transaction_type)) {
      throw new RepositoryValidationError("目标分类的收支类型与选中流水不一致");
    }
    const ruleData = this.normalizedRuleRows(db);
    const conflicts = selected
      .map((row) => ruleData.matcher.resolve(transactionFromRow(row)))
      .filter((resolution) => resolution.status === "conflict");
    if (conflicts.length) {
      const ruleIds = [...new Set(conflicts.flatMap((resolution) => resolution.rule_ids))];
      throw new RepositoryValidationError(
        ruleIds.length
          ? `选中流水存在未解决的规则冲突（规则 ${ruleIds.join("、")}），请先处理规则`
          : "选中流水存在未解决的规则冲突，请先处理规则"
      );
    }
    const monthCounts = new Map<string, number>();
    for (const row of selected) {
      const month = text(row.month);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    }
    const months = [...monthCounts].sort(([left], [right]) => left.localeCompare(right))
      .map(([month, count]) => ({
        month,
        revision: this.getRevision(month, db),
        count
      }));
    return {
      transaction_ids: selected.map((row) => Number(row.id)),
      target_category_key: target.category_key,
      target_category: target.name,
      target_transaction_type: target.transaction_type,
      transaction_count: selected.length,
      month_count: months.length,
      months,
      old_categories: this.historicalCategoryCounts(selected, this.categoryRows(db))
    };
  }

  previewCategoryBackfill(
    request: Omit<CategoryBackfillRequest, "expected_month_revisions">
  ): CategoryBackfillPreview {
    const db = this.db();
    const selected = this.backfillRows(db, request.transaction_ids);
    return this.backfillPreview(db, selected, request.target_category_key);
  }

  async applyCategoryBackfill(
    request: CategoryBackfillRequest
  ): Promise<CategoryBackfillResult> {
    const result = await this.manager.write((db) => {
      const selected = this.backfillRows(db, request.transaction_ids);
      const preview = this.backfillPreview(db, selected, request.target_category_key);
      const revisions: Record<string, number> = {};
      for (const month of preview.months) {
        const expected = Number(request.expected_month_revisions[month.month]);
        if (!Number.isFinite(expected)) {
          throw new RepositoryValidationError(`缺少 ${month.month} 的 revision`);
        }
        const actual = this.getRevision(month.month, db);
        if (actual !== expected) {
          throw new RevisionConflictError(expected, actual);
        }
      }
      const update = db.prepare(
        "UPDATE transactions SET category_key=?,category=? WHERE id=?"
      );
      let updated = 0;
      for (const row of selected) {
        updated += Number(update.run(
          preview.target_category_key,
          preview.target_category,
          Number(row.id)
        ).changes);
      }
      if (updated !== selected.length) {
        throw new RepositoryValidationError("回溯更新行数与预览不一致，已回滚");
      }
      for (const month of preview.months) {
        revisions[month.month] = this.touchMonth(db, month.month, month.revision);
      }
      return {
        ...preview,
        updated_count: updated,
        revisions
      };
    });
    return result;
  }

  private productRenamePreview(
    db: DatabaseSync,
    selected: Row[],
    targetProduct: string
  ): ProductRenamePreview {
    const target = text(targetProduct);
    if (!target) throw new RepositoryValidationError("目标商品名称不能为空");
    const monthCounts = new Map<string, number>();
    const variantCounts = new Map<string, { occurrences: number; months: Set<string> }>();
    for (const row of selected) {
      const month = text(row.month);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
      const product = text(row.product);
      const variant = variantCounts.get(product) ?? { occurrences: 0, months: new Set<string>() };
      variant.occurrences += 1;
      variant.months.add(month);
      variantCounts.set(product, variant);
    }
    const months = [...monthCounts].sort(([left], [right]) => left.localeCompare(right))
      .map(([month, count]) => ({
        month,
        revision: this.getRevision(month, db),
        count
      }));
    return {
      transaction_ids: selected.map((row) => Number(row.id)),
      target_product: target,
      transaction_count: selected.length,
      month_count: months.length,
      months,
      variants: [...variantCounts].map(([product, value]) => ({
        product,
        occurrences: value.occurrences,
        months_count: value.months.size
      })).sort((left, right) =>
        right.occurrences - left.occurrences || left.product.localeCompare(right.product)
      )
    };
  }

  previewProductRename(
    request: Omit<ProductRenameRequest, "expected_month_revisions">
  ): ProductRenamePreview {
    const db = this.db();
    const selected = this.backfillRows(db, request.transaction_ids);
    return this.productRenamePreview(db, selected, request.target_product);
  }

  async applyProductRename(request: ProductRenameRequest): Promise<ProductRenameResult> {
    return this.manager.write((db) => {
      const selected = this.backfillRows(db, request.transaction_ids);
      const preview = this.productRenamePreview(db, selected, request.target_product);
      const revisions: Record<string, number> = {};
      for (const month of preview.months) {
        const expected = Number(request.expected_month_revisions[month.month]);
        if (!Number.isFinite(expected)) {
          throw new RepositoryValidationError(`缺少 ${month.month} 的 revision`);
        }
        const actual = this.getRevision(month.month, db);
        if (actual !== expected) throw new RevisionConflictError(expected, actual);
      }
      const update = db.prepare("UPDATE transactions SET product=? WHERE id=?");
      let updated = 0;
      for (const row of selected) {
        updated += Number(update.run(
          preview.target_product,
          Number(row.id)
        ).changes);
      }
      if (updated !== selected.length) {
        throw new RepositoryValidationError("商品名称更新行数与预览不一致，已回滚");
      }
      for (const month of preview.months) {
        revisions[month.month] = this.touchMonth(db, month.month, month.revision);
      }
      return {
        ...preview,
        updated_count: updated,
        revisions
      };
    });
  }

  async saveRuleWorkspace(request: SaveRuleWorkspaceRequest): Promise<RuleWorkspace> {
    await this.manager.write((db) => {
      const currentCategories = this.categories(db);
      const currentRules = this.rules(db);
      if (currentCategories.revision !== request.categories_revision) {
        throw new RevisionConflictError(request.categories_revision, currentCategories.revision);
      }
      if (currentRules.revision !== request.rules_revision) {
        throw new RevisionConflictError(request.rules_revision, currentRules.revision);
      }
      this.writeCategories(db, request.categories, true);
      this.writeRules(db, request.rules as unknown as Row[]);
    });
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
    const db = this.db();
    const requestedThreshold = Number(minOccurrences);
    const threshold = Number.isFinite(requestedThreshold)
      ? Math.max(1, Math.min(10_000, Math.trunc(requestedThreshold)))
      : 2;
    const ruleData = this.rules(db);
    const combined = [
      ...rows(db.prepare(`
        SELECT month,type,category,counterparty,product FROM transactions
        WHERE month<>? AND type IN ('支出','收入')
          AND (
            TRIM(COALESCE(counterparty,''))<>''
            OR TRIM(COALESCE(product,''))<>''
          )
      `).all(month)),
      ...draftRows.filter(
        (row) =>
          RULE_TYPES.has(row.type)
          && (text(row.counterparty) || text(row.product))
      ).map((row) => ({ month, ...row }))
    ];
    const grouped = new Map<string, Row[]>();
    combined.forEach((row) => {
      const key = [
        text(row.type),
        normalizeProductKey(row.counterparty),
        normalizeProductKey(row.product)
      ].join("\u0000");
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    });
    const metadata = new Map(this.categoryRows(db).map((row) => [row.name, row]));
    const result: RuleCandidate[] = [];
    for (const [key, group] of grouped) {
      if (group.length < threshold) continue;
      const type = key.split("\u0000", 1)[0] as "支出" | "收入";
      const representative = group[0];
      if (ruleData.rows.some((rule) =>
        text(rule.transaction_type) === type
        && (
          !text(rule.counterparty)
          || normalizeProductKey(rule.counterparty)
            === normalizeProductKey(representative.counterparty)
        )
        && (
          !text(rule.product)
          || normalizeProductKey(rule.product)
            === normalizeProductKey(representative.product)
        )
      )) {
        continue;
      }
      const counterparties = this.frequency(
        group.map((row) => text(row.counterparty)).filter(Boolean)
      );
      const variants = this.frequency(group.map((row) => text(row.product)));
      const categoryValues = group.map((row) => text(row.category)).filter(
        (category) => metadata.get(category)?.transaction_type === type
      );
      const categories = this.frequency(categoryValues);
      const category = categories[0]?.[0] ?? "";
      result.push({
        transaction_type: type,
        product: variants[0]?.[0] ?? "",
        counterparty: counterparties[0]?.[0] ?? "",
        variants: variants.map(([value]) => value).filter(Boolean),
        category,
        category_confidence: category ? roundHalfEven(
          (categories[0]?.[1] ?? 0) / group.length,
          4
        ) : 0,
        has_category_conflict: categories.length > 1,
        occurrences: group.length,
        months_count: new Set(group.map((row) => text(row.month) || month)).size,
        last_month: group.map((row) => text(row.month) || month).sort().at(-1)!
      });
    }
    result.sort((left, right) =>
      right.occurrences - left.occurrences
      || left.transaction_type.localeCompare(right.transaction_type)
      || left.product.localeCompare(right.product)
    );
    return {
      month,
      rules_revision: ruleData.revision,
      min_occurrences: threshold,
      rows: result
    };
  }

  private frequency(values: string[]): Array<[string, number]> {
    const counts = new Map<string, { count: number; first: number }>();
    values.forEach((value, index) => {
      const existing = counts.get(value) ?? { count: 0, first: index };
      existing.count += 1;
      counts.set(value, existing);
    });
    return [...counts].sort((left, right) =>
      right[1].count - left[1].count || left[1].first - right[1].first
    ).map(([value, stats]) => [value, stats.count]);
  }

  debts(db = this.db()): { revision: number; rows: Row[] } {
    const result = rows(db.prepare(
      "SELECT * FROM debt_manager ORDER BY is_paid,start_date DESC"
    ).all()).map((row) => ({
      ...row,
      start_date: (() => {
        try { return normalizeDate(row.start_date); } catch { return row.start_date; }
      })(),
      paid_date: text(row.paid_date)
        ? (() => {
          try { return normalizeDate(row.paid_date); } catch { return row.paid_date; }
        })()
        : null
    }));
    return { revision: contentRevision(result), rows: result };
  }

  async saveDebts(expectedRevision: number, input: Row[]): Promise<{ revision: number; rows: Row[] }> {
    await this.manager.write((db) => {
      const current = this.debts(db);
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, current.revision);
      }
      const existing = new Set(rows(db.prepare(
        "SELECT id FROM debt_manager"
      ).all()).map((row) => Number(row.id)));
      const submitted = new Set<number>();
      const insert = db.prepare(`
        INSERT INTO debt_manager
          (description,counterparty,amount,start_date,is_paid,paid_date)
        VALUES (?,?,?,?,?,?)
      `);
      const update = db.prepare(`
        UPDATE debt_manager SET
          description=?,counterparty=?,amount=?,start_date=?,is_paid=?,paid_date=?
        WHERE id=?
      `);
      for (const row of input) {
        let startDate: string;
        let paidDate: string | null = null;
        try {
          startDate = normalizeDate(row.start_date);
        } catch {
          throw new RepositoryValidationError(
            "借款发生日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM"
          );
        }
        if (text(row.paid_date)) {
          try { paidDate = normalizeDate(row.paid_date); } catch {
            throw new RepositoryValidationError(
              "借款还清日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM"
            );
          }
        }
        const isPaid = boolean(row.is_paid);
        if (isPaid && !paidDate) throw new RepositoryValidationError("已还借款必须填写还清日期");
        if (paidDate && paidDate < startDate) {
          throw new RepositoryValidationError("借款还清日期不能早于发生日期");
        }
        const values = [
          text(row.description), text(row.counterparty), finiteNumber(row.amount),
          startDate, isPaid ? 1 : 0, paidDate
        ] as const;
        if (row.id === undefined || row.id === null) {
          insert.run(...values);
        } else {
          const id = Number(row.id);
          if (!existing.has(id) || submitted.has(id)) {
            throw new RepositoryValidationError("借款 id 无效或重复");
          }
          submitted.add(id);
          update.run(...values, id);
        }
      }
      for (const id of existing) if (!submitted.has(id)) {
        db.prepare("DELETE FROM debt_manager WHERE id=?").run(id);
      }
    });
    return this.debts();
  }

  private annualCostAudit(
    db: DatabaseSync,
    year: string,
    annualRows: ExtendedAnnualRow[],
    categories: CategoryDefinition[]
  ): AnnualCostAudit {
    const metadata = new Map(categories.map((row) => [row.name, row]));
    const expenses = rows(db.prepare(`
      SELECT month,category,product,amount FROM transactions
      WHERE month LIKE ? AND type='支出' ORDER BY month,id
    `).all(`${year}-%`));
    const monthsCount = Math.max(1, new Set(annualRows.map((row) => row.month)).size);
    const total = sum(expenses.map((row) => Number(row.amount ?? 0)));
    const byCategory = new Map<string, number>();
    const byPattern = new Map<string, number>();
    expenses.forEach((row) => {
      const category = text(row.category);
      const amount = Number(row.amount ?? 0);
      byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
      const pattern = metadata.get(category)?.pattern ?? "偶尔";
      byPattern.set(pattern, (byPattern.get(pattern) ?? 0) + amount);
    });
    const necessaryTotal = sum(expenses.filter(
      (row) => metadata.get(text(row.category))?.necessity === "必要"
    ).map((row) => Number(row.amount ?? 0)));
    const controlledTotal = sum(expenses.filter(
      (row) => metadata.get(text(row.category))?.necessity === "可控"
    ).map((row) => Number(row.amount ?? 0)));
    const productSummary = (category: string, divisor: number) => {
      const grouped = new Map<string, number>();
      expenses.filter((row) => text(row.category) === category).forEach((row) => {
        const product = text(row.product);
        grouped.set(product, (grouped.get(product) ?? 0) + Number(row.amount ?? 0));
      });
      return [...grouped].sort((left, right) => right[1] - left[1]).slice(0, 10)
        .map(([product, amount]) => ({
          product,
          total: roundHalfEven(amount),
          monthly_average: roundHalfEven(amount / divisor)
        }));
    };
    const latestAssets = annualRows.at(-1)?.total_assets ?? 0;
    const average = total / monthsCount;
    return {
      months_count: monthsCount,
      total_expense: total,
      necessary_total: necessaryTotal,
      controlled_total: controlledTotal,
      controlled_percent: total > 0
        ? roundHalfEven(controlledTotal / total * 100, 1) : 0,
      asset_support_months: average > 0
        ? roundHalfEven(latestAssets / average, 1) : null,
      categories: [...byCategory].sort((left, right) => right[1] - left[1])
        .map(([category, amount]) => ({
          category,
          necessity: metadata.get(category)?.necessity ?? "必要",
          pattern: metadata.get(category)?.pattern ?? "偶尔",
          total: roundHalfEven(amount),
          monthly_average: roundHalfEven(amount / monthsCount),
          share_percent: total > 0 ? roundHalfEven(amount / total * 100, 1) : 0
        })),
      patterns: ["周期", "日常", "偶尔"].filter((pattern) => byPattern.has(pattern))
        .map((pattern) => {
          const amount = byPattern.get(pattern) ?? 0;
          return {
            pattern,
            total: roundHalfEven(amount),
            monthly_average: roundHalfEven(amount / monthsCount),
            share_percent: total > 0 ? roundHalfEven(amount / total * 100, 1) : 0
          };
        }),
      big_tickets: expenses.filter((row) => {
        const category = text(row.category);
        return metadata.get(category)?.is_big_ticket
          || Number(row.amount ?? 0) >= this.options.largeExpenseThreshold;
      }).map((row) => ({
        month: text(row.month),
        product: text(row.product),
        category: text(row.category),
        amount: roundHalfEven(Number(row.amount ?? 0))
      })).sort((left, right) => right.amount - left.amount),
      subscriptions: productSummary("订阅服务", 12),
      daily_essentials: productSummary("日常必需", monthsCount)
    };
  }

  annual(year: string): AnnualOverview {
    if (!/^\d{4}$/.test(year)) throw new RepositoryValidationError("年份必须是 YYYY");
    const db = this.db();
    const full = this.annualRows(db);
    const annual = full.filter((row) => row.month.startsWith(year));
    if (!annual.length) {
      return {
        year,
        months: [],
        rows: [],
        metrics: {
          total_income: 0,
          total_expense: 0,
          savings: 0,
          savings_rate: 0
        },
        latest: null,
        rolling_rows: [],
        recurring_expenses: [],
        all_trend_rows: [],
        cost_audit: {
          months_count: 1,
          total_expense: 0,
          necessary_total: 0,
          controlled_total: 0,
          controlled_percent: 0,
          asset_support_months: null,
          categories: [],
          patterns: [],
          big_tickets: [],
          subscriptions: [],
          daily_essentials: []
        }
      };
    }
    const totalIncome = sum(annual.map((row) => row.total_income));
    const totalExpense = sum(annual.map((row) => row.total_expense));
    const savings = roundHalfEven(totalIncome - totalExpense);
    const latest = annual.at(-1)!;
    const rollingStart = shiftMonth(latest.month, -11);
    return {
      year,
      months: annual.map((row) => row.month),
      rows: annual,
      metrics: {
        total_income: totalIncome,
        total_expense: totalExpense,
        savings,
        savings_rate: totalIncome > 0
          ? roundHalfEven(savings / totalIncome * 100, 1) : 0
      },
      latest,
      rolling_rows: full.filter(
        (row) => row.month >= rollingStart && row.month <= latest.month
      ),
      recurring_expenses: this.recurringExpenses(db, latest.month),
      all_trend_rows: full,
      cost_audit: this.annualCostAudit(db, year, annual, this.categoryRows(db))
    };
  }

  currentAsset(): CurrentAsset {
    const db = this.db();
    const latest = this.getMonths(db).at(-1);
    if (!latest) {
      return {
        month: null,
        cost_assets: 0,
        market_net_assets: 0,
        total_assets: 0,
        fixed_assets: []
      };
    }
    const cash = Number((db.prepare(`
      SELECT COALESCE(SUM(balance),0) AS total
      FROM cash_account_balances WHERE month=?
    `).get(latest) as Row).total ?? 0);
    const principal = Number((db.prepare(`
      SELECT COALESCE(SUM(principal),0) AS total
      FROM investment_account_balances WHERE month=?
    `).get(latest) as Row).total ?? 0);
    const investment = db.prepare(`
      SELECT COALESCE(SUM(market_value),0) AS market_value,
             COALESCE(SUM(cash_balance),0) AS cash_balance
      FROM investment_account_balances WHERE month=?
    `).get(latest) as Row;
    const marketValue = Number(investment.market_value ?? 0);
    const investmentCash = Number(investment.cash_balance ?? 0);
    const debt = this.activeDebt(db, latest);
    const costAssets = roundHalfEven(cash - debt + principal);
    const marketNetAssets = roundHalfEven(cash - debt + marketValue + investmentCash);
    return {
      month: latest,
      cash: roundHalfEven(cash),
      debt,
      principal: roundHalfEven(principal),
      market_value: roundHalfEven(marketValue),
      investment_cash: roundHalfEven(investmentCash),
      cost_assets: costAssets,
      market_net_assets: marketNetAssets,
      total_assets: costAssets,
      fixed_assets: rows(db.prepare(`
        SELECT * FROM fixed_assets
        WHERE month=? AND status IN ('在用','闲置') ORDER BY id
      `).all(latest)).map(fixedAssetFromRow),
      fixed_assets_note: "固定资产记录不计入总资产"
    };
  }

  private recurringExpenses(
    db: DatabaseSync,
    latestMonth: string
  ): RecurringExpenseSummary[] {
    const selectedMonths = new Set(
      this.getMonths(db).filter((month) => month <= latestMonth).slice(-12)
    );
    const result = new Map<string, {
      category: string;
      months: Set<string>;
      count: number;
      total: number;
      latestAmount: number;
      lastDate: string;
    }>();
    rows(db.prepare(`
      SELECT t.month,t.transaction_date,t.category,t.product,t.amount
      FROM transactions t
      JOIN category_definitions c ON c.category_key=t.category_key
      WHERE t.type='支出' AND c.pattern='周期'
      ORDER BY t.transaction_date,t.id
    `).all()).filter((row) => selectedMonths.has(text(row.month))).forEach((row) => {
      const product = text(row.product);
      const current = result.get(product) ?? {
        category: text(row.category),
        months: new Set<string>(),
        count: 0,
        total: 0,
        latestAmount: 0,
        lastDate: ""
      };
      current.months.add(text(row.month));
      current.count += 1;
      current.total += Number(row.amount ?? 0);
      const date = text(row.transaction_date) || `${text(row.month)}-01`;
      if (date >= current.lastDate) {
        current.lastDate = date;
        current.latestAmount = Number(row.amount ?? 0);
        current.category = text(row.category);
      }
      result.set(product, current);
    });
    return [...result].map(([product, row]) => ({
      product,
      category: row.category,
      months_count: row.months.size,
      transaction_count: row.count,
      total: roundHalfEven(row.total),
      average_amount: roundHalfEven(row.total / row.count),
      latest_amount: roundHalfEven(row.latestAmount),
      last_date: row.lastDate
    })).sort((left, right) => right.total - left.total);
  }
}
