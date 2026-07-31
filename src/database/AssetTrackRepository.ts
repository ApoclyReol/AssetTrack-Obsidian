import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  AnnualCostAudit,
  AnnualOverview,
  CashAccountBalance,
  CategoryDefinition,
  CurrentAsset,
  FixedAsset,
  InvestmentAccountBalance,
  MonthCreationPolicy,
  MonthOverview,
  MonthWorkspace,
  RuleCandidate,
  RecurringExpenseSummary,
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
import { applyRules, normalizeProductKey, RULE_TYPES } from "../domain/rules";
import { scalarText } from "../domain/text";
import {
  validateTransactions,
  type ValidationIssue
} from "../domain/validators";
import { AssetTrackError } from "../services/AssetTrackService";
import { categoryColor } from "./schema";
import { DatabaseManager } from "./DatabaseManager";

type Row = Record<string, unknown>;

const ASSET_STATUSES = new Set(["在用", "闲置", "已出售", "已报废"]);

export class RevisionConflictError extends AssetTrackError {
  constructor(expected: number, actual: number) {
    super(
      `revision 冲突：草稿基于 ${expected}，当前数据库为 ${actual}`,
      409,
      { expected, actual },
      "revision_conflict"
    );
  }
}

export class RepositoryValidationError extends AssetTrackError {
  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message, 422, issues.length ? { message, issues } : message, "validation_error");
  }
}

function text(value: unknown): string {
  return scalarText(value).trim();
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function rows(statementRows: unknown[]): Row[] {
  return statementRows as Row[];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "boolean") return value ? "true" : "false";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(", ")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(
    (key) => `${JSON.stringify(key)}: ${stableJson(object[key])}`
  ).join(", ")}}`;
}

function contentRevision(value: Row[]): number {
  const digest = createHash("sha256").update(stableJson(value), "utf8").digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16);
}

function normalizeAsset(source: Partial<FixedAsset>, index: number): Required<
  Pick<FixedAsset, "asset_key" | "asset_name" | "category" | "purchase_price" | "status" | "note">
> & Pick<FixedAsset, "purchase_date"> {
  const name = text(source.asset_name);
  if (!name) throw new RepositoryValidationError(`第 ${index + 1} 行的资产名称不能为空`);
  const status = text(source.status) || "在用";
  return {
    asset_key: text(source.asset_key) || randomUUID().replaceAll("-", ""),
    asset_name: name,
    category: text(source.category),
    purchase_date: text(source.purchase_date) || null,
    purchase_price: finiteNumber(source.purchase_price, {
      nonNegative: true,
      label: "固定资产金额"
    }),
    status: ASSET_STATUSES.has(status) ? status : "在用",
    note: text(source.note)
  };
}

function transactionFromRow(row: Row): Transaction {
  return {
    id: Number(row.id),
    transaction_date: text(row.transaction_date),
    type: text(row.type),
    category_key: text(row.category_key) || null,
    category: text(row.category),
    counterparty: text(row.counterparty),
    product: text(row.product),
    amount: Number(row.amount ?? 0)
  };
}

function fixedAssetFromRow(row: Row): FixedAsset {
  return {
    id: Number(row.id),
    asset_key: text(row.asset_key),
    asset_name: text(row.asset_name),
    category: text(row.category),
    purchase_date: text(row.purchase_date) || null,
    purchase_price: Number(row.purchase_price ?? 0),
    status: text(row.status),
    note: text(row.note)
  };
}

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

  async saveCategories(
    expectedRevision: number,
    input: CategoryDefinition[]
  ): Promise<{ revision: number; rows: CategoryDefinition[] }> {
    await this.manager.write((db) => {
      const current = this.categories(db);
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, current.revision);
      }
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
          const conflicting = db.prepare(`
            SELECT 1 FROM transactions
            WHERE category_key=? AND type IN ('支出','收入') AND type<>?
            UNION ALL
            SELECT 1 FROM auto_rules WHERE category_key=? AND transaction_type<>?
            LIMIT 1
          `).get(key, row.transaction_type, key, row.transaction_type);
          if (conflicting) {
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
        const usage = Number((db.prepare(`
          SELECT
            (SELECT COUNT(*) FROM transactions WHERE category_key=?) +
            (SELECT COUNT(*) FROM auto_rules WHERE category_key=?) AS count
        `).get(key, key) as Row).count);
        if (usage) {
          db.prepare(
            "UPDATE category_definitions SET is_active=0 WHERE category_key=?"
          ).run(key);
        } else {
          db.prepare("DELETE FROM category_definitions WHERE category_key=?").run(key);
        }
      }
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
    const normalized = input.map((row) => {
      const type = text(row.type);
      let definition = byKey.get(text(row.category_key)) ?? byName.get(text(row.category));
      if (["代付", "加仓", "提现"].includes(type)) definition = undefined;
      return {
        ...row,
        transaction_date: normalizeDate(row.transaction_date, month),
        type,
        counterparty: text(row.counterparty),
        product: text(row.product),
        amount: finiteNumber(row.amount),
        category_key: definition?.category_key ?? null,
        category: definition?.name ?? ""
      };
    });
    return {
      rows: normalized,
      issues: validateTransactions(normalized, month, categories)
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
    if (normalized.issues.length) {
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
    const revision = contentRevision(raw);
    const transactions = rows(db.prepare(`
      SELECT month,type,counterparty,product FROM transactions
      WHERE type IN ('支出','收入')
        AND (TRIM(COALESCE(counterparty,''))<>'' OR TRIM(COALESCE(product,''))<>'')
    `).all());
    return {
      revision,
      rows: raw.map((row) => {
        const counterparty = normalizeProductKey(row.counterparty);
        const product = normalizeProductKey(row.product);
        const matched = transactions.filter(
          (transaction) =>
            text(transaction.type) === text(row.transaction_type)
            && (
              !counterparty
              || normalizeProductKey(transaction.counterparty) === counterparty
            )
            && (!product || normalizeProductKey(transaction.product) === product)
        );
        const months = new Set(matched.map((transaction) => text(transaction.month)));
        return {
          ...row,
          occurrences: matched.length,
          months_count: months.size,
          last_month: [...months].sort().at(-1) ?? ""
        };
      })
    };
  }

  async saveRules(expectedRevision: number, input: Row[]): Promise<{ revision: number; rows: Row[] }> {
    await this.manager.write((db) => {
      const current = this.rules(db);
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, current.revision);
      }
      const categories = this.categoryRows(db).filter((row) => row.is_active);
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
    });
    return this.rules();
  }

  rulesPreview(month: string, input: Transaction[]): {
    base_revision: number;
    proposed_rows: Transaction[];
  } {
    const rules = this.rules();
    return {
      base_revision: this.getRevision(month),
      proposed_rows: applyRules(input, rules.rows.map((row) => ({
        transaction_type: text(row.transaction_type),
        counterparty: text(row.counterparty),
        product: text(row.product),
        category_key: text(row.category_key),
        category: text(row.category)
      })))
    };
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
    const threshold = Math.max(1, Math.min(10_000, Math.trunc(minOccurrences)));
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
