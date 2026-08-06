import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CATEGORY_COLORS } from "../domain/categoryColors";
import { scalarText } from "../domain/text";
import { AssetTrackError } from "../application/errors";

export const SCHEMA9_VERSION = 9;
export const PREVIOUS_SCHEMA_VERSION = SCHEMA9_VERSION;
export const CURRENT_SCHEMA_VERSION = 10;
export const BACKUP_FORMAT_VERSION = 5;

const NORMALIZE_MATCH_KEY_FUNCTION = "asset_track_normalize_match_key";

export type SchemaMigrationIssueCode =
  | "legacy_schema_invalid"
  | "ambiguous_rule_scope"
  | "duplicate_rule"
  | "invalid_category_reference";

export interface SchemaMigrationIssue {
  code: SchemaMigrationIssueCode;
  message: string;
  rule_ids: number[];
  transaction_type?: string;
  match_scope?: string;
  counterparty_key?: string;
  product_key?: string;
}

export interface SchemaMigrationReport {
  from_version: number;
  to_version: number;
  category_count: number;
  rule_count: number;
  preserved_row_counts: Record<string, number>;
  issues: SchemaMigrationIssue[];
  protection_backup_path?: string;
}

const MIGRATION_PRESERVED_TABLES = [
  "category_definitions",
  "account_definitions",
  "transactions",
  "cash_account_balances",
  "investment_account_balances",
  "fixed_assets",
  "debt_manager",
  "month_status"
] as const;

function migrationRowCounts(db: DatabaseSync): Record<string, number> {
  return Object.fromEntries(MIGRATION_PRESERVED_TABLES.map((table) => [
    table,
    Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
  ]));
}

export class SchemaMigrationError extends AssetTrackError {
  constructor(public readonly report: SchemaMigrationReport) {
    const details = report.issues.map((issue) => issue.message).join("；");
    super({
      code: "database.migration_blocked",
      status: 422,
      message: `schema ${report.from_version}→${report.to_version} 迁移已阻止：${details}`,
      params: {
        fromVersion: report.from_version,
        toVersion: report.to_version,
        issueCodes: report.issues.map((issue) => issue.code)
      }
    });
    this.name = "SchemaMigrationError";
  }
}

/**
 * Keep this boundary identical to the rule matcher normalization without
 * making the database depend on the rule domain implementation.
 */
export function normalizeMatchKey(value: unknown): string {
  return scalarText(value)
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, " ")
    .replace(/[|｜]+/g, "|");
}

export function registerSchemaFunctions(db: DatabaseSync): void {
  db.function(
    NORMALIZE_MATCH_KEY_FUNCTION,
    { deterministic: true },
    (value) => normalizeMatchKey(value)
  );
}

export const CATEGORY_METADATA = {
  "居住固定": { type: "支出", necessity: "必要", pattern: "周期" },
  "订阅服务": { type: "支出", necessity: "必要", pattern: "周期" },
  "餐饮基础": { type: "支出", necessity: "必要", pattern: "日常" },
  "餐饮改善": { type: "支出", necessity: "可控", pattern: "日常" },
  "交通通勤": { type: "支出", necessity: "必要", pattern: "日常" },
  "日常必需": { type: "支出", necessity: "必要", pattern: "日常" },
  "生活品质": { type: "支出", necessity: "可控", pattern: "偶尔" },
  "大件大额": { type: "支出", necessity: "可控", pattern: "偶尔", is_big_ticket: true },
  "社交娱乐": { type: "支出", necessity: "可控", pattern: "偶尔" },
  "学习发展": { type: "支出", necessity: "必要", pattern: "偶尔" },
  "其他支出": { type: "支出", necessity: "可控", pattern: "偶尔" },
  "工资收入": { type: "收入", necessity: "-", pattern: "-" },
  "奖金利息": { type: "收入", necessity: "-", pattern: "-" },
  "临时收入": { type: "收入", necessity: "-", pattern: "-" },
  "异常/未分类": { type: "支出", necessity: "-", pattern: "-" }
} as const;

export const REQUIRED_TABLES = [
  "transactions",
  "category_definitions",
  "account_definitions",
  "cash_account_balances",
  "investment_account_balances",
  "fixed_assets",
  "debt_manager",
  "auto_rules",
  "month_status",
  "operation_logs"
] as const;

export const REQUIRED_COLUMNS: Record<
  typeof REQUIRED_TABLES[number],
  readonly string[]
> = {
  category_definitions: [
    "category_key",
    "name",
    "description",
    "transaction_type",
    "necessity",
    "pattern",
    "is_big_ticket",
    "color",
    "is_active",
    "sort_order"
  ],
  account_definitions: [
    "account_key",
    "name",
    "account_type",
    "is_active",
    "sort_order"
  ],
  transactions: [
    "id",
    "month",
    "transaction_date",
    "type",
    "category_key",
    "category",
    "counterparty",
    "product",
    "source",
    "account_key",
    "amount"
  ],
  cash_account_balances: ["month", "account_key", "balance"],
  investment_account_balances: [
    "month",
    "account_key",
    "principal",
    "market_value",
    "cash_balance"
  ],
  fixed_assets: [
    "id",
    "month",
    "asset_key",
    "asset_name",
    "category",
    "purchase_date",
    "purchase_price",
    "status",
    "note"
  ],
  debt_manager: [
    "id",
    "description",
    "counterparty",
    "amount",
    "start_date",
    "is_paid",
    "paid_date"
  ],
  auto_rules: [
    "id",
    "transaction_type",
    "match_scope",
    "counterparty",
    "product",
    "match_counterparty_key",
    "match_product_key",
    "rewrite_merchant",
    "rewrite_product",
    "category_key",
    "category"
  ],
  month_status: [
    "month",
    "status",
    "locked_at",
    "updated_at",
    "fixed_assets_initialized",
    "revision"
  ],
  operation_logs: [
    "id",
    "operation_id",
    "created_at",
    "actor",
    "operation_type",
    "source_page",
    "business_tab",
    "selection_json",
    "total_count",
    "success_count",
    "skipped_count",
    "failure_count",
    "details_json"
  ]
};

export const REQUIRED_INDEXES = [
  "idx_transactions_month",
  "idx_transactions_type",
  "idx_transactions_category_key",
  "idx_transactions_account",
  "idx_transactions_month_date",
  "idx_cash_balances_month",
  "idx_investment_balances_month",
  "idx_fixed_assets_month",
  "idx_debt_start",
  "idx_debt_paid",
  "idx_auto_rules_match",
  "idx_operation_logs_created"
] as const;

export interface RequiredIndexDefinition {
  name: string;
  table: typeof REQUIRED_TABLES[number];
  columns: readonly string[];
  unique: boolean;
}

export const REQUIRED_INDEX_DEFINITIONS: readonly RequiredIndexDefinition[] = [
  { name: "idx_transactions_month", table: "transactions", columns: ["month"], unique: false },
  { name: "idx_transactions_type", table: "transactions", columns: ["type"], unique: false },
  { name: "idx_transactions_category_key", table: "transactions", columns: ["category_key"], unique: false },
  {
    name: "idx_transactions_account",
    table: "transactions",
    columns: ["account_key", "type", "month"],
    unique: false
  },
  {
    name: "idx_transactions_month_date",
    table: "transactions",
    columns: ["month", "transaction_date", "id"],
    unique: false
  },
  { name: "idx_cash_balances_month", table: "cash_account_balances", columns: ["month"], unique: false },
  {
    name: "idx_investment_balances_month",
    table: "investment_account_balances",
    columns: ["month"],
    unique: false
  },
  { name: "idx_fixed_assets_month", table: "fixed_assets", columns: ["month"], unique: false },
  { name: "idx_debt_start", table: "debt_manager", columns: ["start_date"], unique: false },
  { name: "idx_debt_paid", table: "debt_manager", columns: ["is_paid"], unique: false },
  {
    name: "idx_auto_rules_match",
    table: "auto_rules",
    columns: [
      "transaction_type",
      "match_scope",
      "match_counterparty_key",
      "match_product_key"
    ],
    unique: true
  },
  {
    name: "idx_operation_logs_created",
    table: "operation_logs",
    columns: ["created_at", "id"],
    unique: false
  }
] as const;

export const REQUIRED_GENERATED_COLUMNS: Record<string, readonly string[]> = {
  auto_rules: ["match_counterparty_key", "match_product_key"]
};

export interface RequiredForeignKey {
  table: typeof REQUIRED_TABLES[number];
  from: string;
  targetTable: typeof REQUIRED_TABLES[number];
  targetColumn: string;
}

export const REQUIRED_FOREIGN_KEYS: readonly RequiredForeignKey[] = [
  {
    table: "transactions",
    from: "category_key",
    targetTable: "category_definitions",
    targetColumn: "category_key"
  },
  {
    table: "transactions",
    from: "account_key",
    targetTable: "account_definitions",
    targetColumn: "account_key"
  },
  {
    table: "cash_account_balances",
    from: "account_key",
    targetTable: "account_definitions",
    targetColumn: "account_key"
  },
  {
    table: "investment_account_balances",
    from: "account_key",
    targetTable: "account_definitions",
    targetColumn: "account_key"
  },
  {
    table: "auto_rules",
    from: "category_key",
    targetTable: "category_definitions",
    targetColumn: "category_key"
  }
];

export function categoryKey(name: string): string {
  return `cat-${createHash("sha256").update(name, "utf8").digest("hex").slice(0, 16)}`;
}

export function categoryColor(order: number): string {
  return CATEGORY_COLORS[Math.max(0, Math.trunc(order)) % CATEGORY_COLORS.length];
}

function tableNames(db: DatabaseSync): string[] {
  return (db.prepare(
    "SELECT name FROM sqlite_master "
    + "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_xinfo("${table}")`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function legacySchemaIssues(db: DatabaseSync): SchemaMigrationIssue[] {
  const legacyColumns: Record<string, readonly string[]> = {
    category_definitions: REQUIRED_COLUMNS.category_definitions.filter(
      (column) => column !== "description"
    ),
    account_definitions: REQUIRED_COLUMNS.account_definitions,
    transactions: REQUIRED_COLUMNS.transactions.filter(
      (column) => column !== "source" && column !== "account_key"
    ),
    cash_account_balances: REQUIRED_COLUMNS.cash_account_balances,
    investment_account_balances: REQUIRED_COLUMNS.investment_account_balances,
    fixed_assets: REQUIRED_COLUMNS.fixed_assets,
    debt_manager: REQUIRED_COLUMNS.debt_manager,
    auto_rules: [
      "id",
      "transaction_type",
      "counterparty",
      "product",
      "category_key",
      "category"
    ],
    month_status: REQUIRED_COLUMNS.month_status
  };
  const tables = tableNames(db);
  const issues: SchemaMigrationIssue[] = [];
  const missingTables = REQUIRED_TABLES.filter(
    (table) => table !== "operation_logs" && !tables.includes(table)
  );
  const missingColumns = Object.entries(legacyColumns).flatMap(([table, columns]) => {
    if (!tables.includes(table)) return [];
    const actual = tableColumns(db, table);
    const missing = columns.filter((column) => !actual.includes(column));
    return missing.length ? [`${table}(${missing.join(",")})`] : [];
  });
  if (missingTables.length || missingColumns.length) {
    issues.push({
      code: "legacy_schema_invalid",
      message: `schema ${PREVIOUS_SCHEMA_VERSION} 结构不完整：缺少表=${missingTables.join(",") || "无"}，缺少字段=${missingColumns.join(";") || "无"}`,
      rule_ids: []
    });
  }
  return issues;
}

/**
 * Read-only gates used by the settings and startup loaders. A schema 9 file
 * must pass the legacy table/column check before the writable migration is
 * attempted; rule-level issues are deliberately left for the migration
 * transaction so the user receives the complete migration report.
 */
export function canMigrateSchema9(db: DatabaseSync): boolean {
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
  );
  return version === PREVIOUS_SCHEMA_VERSION && legacySchemaIssues(db).length === 0;
}

interface LegacyRuleRow {
  id: number;
  transaction_type: string;
  counterparty: string;
  product: string;
  category_key: string;
  category: string;
}

interface MigratedRuleFields {
  id: number;
  transaction_type: string;
  match_scope: "product" | "merchant" | "merchant_product" | null;
  counterparty: string;
  product: string;
  counterparty_key: string;
  product_key: string;
  category_key: string;
  category: string;
}

function inferRuleFields(row: LegacyRuleRow): MigratedRuleFields {
  const counterparty = String(row.counterparty ?? "");
  const product = String(row.product ?? "");
  const counterpartyKey = normalizeMatchKey(counterparty);
  const productKey = normalizeMatchKey(product);
  const match_scope = counterpartyKey && productKey
    ? "merchant_product"
    : counterpartyKey
      ? "merchant"
      : productKey
        ? "product"
        : null;
  return {
    id: Number(row.id),
    transaction_type: String(row.transaction_type ?? ""),
    match_scope,
    counterparty,
    product,
    counterparty_key: counterpartyKey,
    product_key: productKey,
    category_key: String(row.category_key ?? ""),
    category: String(row.category ?? "")
  };
}

function migrationRuleIssues(
  db: DatabaseSync,
  rows: LegacyRuleRow[]
): SchemaMigrationIssue[] {
  const issues: SchemaMigrationIssue[] = [];
  const categories = new Map(
    (db.prepare(
      "SELECT category_key, transaction_type, is_active FROM category_definitions"
    ).all() as Array<{ category_key: string; transaction_type: string; is_active: number }>)
      .map((row) => [String(row.category_key), {
        transaction_type: String(row.transaction_type),
        is_active: Number(row.is_active) === 1
      }] as const)
  );
  const byCondition = new Map<string, MigratedRuleFields[]>();
  for (const row of rows) {
    const fields = inferRuleFields(row);
    if (!fields.match_scope) {
      issues.push({
        code: "ambiguous_rule_scope",
        message: `规则 ${fields.id} 无法判定匹配范围：商品和交易对手均为空或仅含空白`,
        rule_ids: [fields.id]
      });
      continue;
    }
    const category = categories.get(fields.category_key);
    if (!category || category.transaction_type !== fields.transaction_type || !category.is_active) {
      issues.push({
        code: "invalid_category_reference",
        message: `规则 ${fields.id} 的分类引用无效或已停用：category_key=${fields.category_key || "空"}`,
        rule_ids: [fields.id]
      });
    }
    const conditionKey = [
      fields.transaction_type,
      fields.match_scope,
      fields.counterparty_key,
      fields.product_key
    ].join("\u0000");
    const group = byCondition.get(conditionKey) ?? [];
    group.push(fields);
    byCondition.set(conditionKey, group);
  }
  for (const group of byCondition.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    issues.push({
      code: "duplicate_rule",
      message: `规则 ${group.map((row) => row.id).join("、")} 在同一收支类型、匹配范围和规范化条件下重复`,
      rule_ids: group.map((row) => row.id),
      transaction_type: first.transaction_type,
      match_scope: first.match_scope ?? undefined,
      counterparty_key: first.counterparty_key,
      product_key: first.product_key
    });
  }
  return issues;
}

function migrateSchema9To10InTransaction(db: DatabaseSync): SchemaMigrationReport {
  const report: SchemaMigrationReport = {
    from_version: SCHEMA9_VERSION,
    to_version: CURRENT_SCHEMA_VERSION,
    category_count: 0,
    rule_count: 0,
    preserved_row_counts: migrationRowCounts(db),
    issues: []
  };
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
  );
  if (version !== SCHEMA9_VERSION) {
    report.issues.push({
      code: "legacy_schema_invalid",
      message: `只支持从 schema ${SCHEMA9_VERSION} 迁移到 schema ${CURRENT_SCHEMA_VERSION}，当前版本为 ${version}`,
      rule_ids: []
    });
    throw new SchemaMigrationError(report);
  }
  const shapeIssues = legacySchemaIssues(db);
  if (shapeIssues.length) {
    report.issues = shapeIssues;
    throw new SchemaMigrationError(report);
  }
  if (!tableColumns(db, "transactions").includes("source")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT ''");
  }
  const categories = db.prepare(
    "SELECT category_key FROM category_definitions"
  ).all() as Array<{ category_key: string }>;
  const rows = db.prepare(`
    SELECT id,transaction_type,counterparty,product,category_key,category
    FROM auto_rules ORDER BY id
  `).all() as unknown as LegacyRuleRow[];
  report.category_count = categories.length;
  report.rule_count = rows.length;
  report.issues = migrationRuleIssues(db, rows);
  if (report.issues.length) throw new SchemaMigrationError(report);

  db.exec(`
    ALTER TABLE category_definitions
      ADD COLUMN description TEXT NOT NULL DEFAULT '';
    DROP INDEX IF EXISTS idx_auto_rules_match;
    ALTER TABLE auto_rules RENAME TO auto_rules_schema9;
    CREATE TABLE auto_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('支出','收入')),
      match_scope TEXT NOT NULL DEFAULT 'product'
        CHECK(match_scope IN ('product','merchant','merchant_product')),
      counterparty TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      match_counterparty_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN match_scope IN ('merchant','merchant_product')
            THEN ${NORMALIZE_MATCH_KEY_FUNCTION}(counterparty)
          ELSE ''
        END
      ) STORED,
      match_product_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN match_scope IN ('product','merchant_product')
            THEN ${NORMALIZE_MATCH_KEY_FUNCTION}(product)
          ELSE ''
        END
      ) STORED,
      rewrite_merchant TEXT NOT NULL DEFAULT '',
      rewrite_product TEXT NOT NULL DEFAULT '',
      category_key TEXT NOT NULL,
      category TEXT NOT NULL,
      CHECK(
        (match_scope='product' AND match_counterparty_key='' AND match_product_key<>'')
        OR (match_scope='merchant' AND match_counterparty_key<>'' AND match_product_key='')
        OR (match_scope='merchant_product' AND match_counterparty_key<>'' AND match_product_key<>'')
      ),
      FOREIGN KEY(category_key) REFERENCES category_definitions(category_key)
    );
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'local-user',
      operation_type TEXT NOT NULL,
      source_page TEXT NOT NULL,
      business_tab TEXT,
      selection_json TEXT NOT NULL DEFAULT '[]',
      total_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  const insert = db.prepare(`
    INSERT INTO auto_rules
      (id,transaction_type,match_scope,counterparty,product,
       rewrite_merchant,rewrite_product,category_key,category)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  for (const row of rows) {
    const fields = inferRuleFields(row);
    insert.run(
      fields.id,
      fields.transaction_type,
      fields.match_scope,
      fields.counterparty,
      fields.product,
      "",
      "",
      fields.category_key,
      fields.category
    );
  }
  db.exec(`
    DROP TABLE auto_rules_schema9;
    CREATE UNIQUE INDEX idx_auto_rules_match
      ON auto_rules(transaction_type, match_scope, match_counterparty_key, match_product_key);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at, id);
  `);
  if (!tableColumns(db, "transactions").includes("account_key")) {
    db.exec(
      "ALTER TABLE transactions ADD COLUMN account_key TEXT "
      + "REFERENCES account_definitions(account_key)"
    );
  }
  let investmentAccount = db.prepare(`
    SELECT account_key FROM account_definitions
    WHERE account_type='investment'
    ORDER BY is_active DESC, sort_order, account_key
    LIMIT 1
  `).get() as { account_key?: string } | undefined;
  if (!investmentAccount?.account_key) {
    db.prepare(`
      INSERT INTO account_definitions
        (account_key,name,account_type,is_active,sort_order)
      VALUES (?,?,?,?,?)
    `).run("investment-default", "默认理财账户", "investment", 1, 1);
    investmentAccount = { account_key: "investment-default" };
  }
  const investmentAccountKey = investmentAccount.account_key ?? "investment-default";
  db.prepare(`
    UPDATE transactions
    SET account_key=?
    WHERE type IN ('加仓','提现') AND (account_key IS NULL OR TRIM(account_key)='')
  `).run(investmentAccountKey);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_account
      ON transactions(account_key,type,month);
    PRAGMA user_version=${CURRENT_SCHEMA_VERSION};
  `);
  const migratedRuleCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM auto_rules").get() as { count: number }).count
  );
  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
  const integrity = String(
    (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check
  );
  const migratedRowCounts = migrationRowCounts(db);
  const rowCountMismatch = Object.entries(report.preserved_row_counts).find(([table, count]) =>
    table === "account_definitions"
      ? migratedRowCounts[table] < count
      : migratedRowCounts[table] !== count
  );
  if (
    migratedRuleCount !== report.rule_count
    || rowCountMismatch
    || foreignKeyViolations !== 0
    || integrity !== "ok"
  ) {
    throw new AssetTrackError({
      code: "database.migration_validation_failed",
      status: 422,
      params: {
        migratedRuleCount,
        expectedRuleCount: report.rule_count,
        rowCountMismatch: rowCountMismatch?.[0] ?? "",
        foreignKeyViolations,
        integrity
      }
    });
  }
  return report;
}

export function migrateSchema9To10(db: DatabaseSync): SchemaMigrationReport {
  registerSchemaFunctions(db);
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
  );
  if (version !== SCHEMA9_VERSION) {
    const report: SchemaMigrationReport = {
      from_version: SCHEMA9_VERSION,
      to_version: CURRENT_SCHEMA_VERSION,
      category_count: 0,
      rule_count: 0,
      preserved_row_counts: {},
      issues: [{
        code: "legacy_schema_invalid",
        message: `只支持从 schema ${SCHEMA9_VERSION} 迁移到 schema ${CURRENT_SCHEMA_VERSION}，当前版本为 ${version}`,
        rule_ids: []
      }]
    };
    throw new SchemaMigrationError(report);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const report = migrateSchema9To10InTransaction(db);
    db.exec("COMMIT");
    return report;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Keep the original migration error authoritative.
    }
    throw error;
  }
}

export function createSchema(db: DatabaseSync): void {
  registerSchemaFunctions(db);
  db.exec(`
    CREATE TABLE category_definitions (
      category_key TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('支出','收入')),
      necessity TEXT NOT NULL CHECK(necessity IN ('必要','可控','不适用')),
      pattern TEXT NOT NULL CHECK(pattern IN ('周期','日常','偶尔','不适用')),
      is_big_ticket INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE account_definitions (
      account_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK(account_type IN ('cash','investment')),
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(account_type, name)
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('支出','收入','代付','加仓','提现')),
      category_key TEXT,
      category TEXT NOT NULL DEFAULT '',
      counterparty TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      account_key TEXT REFERENCES account_definitions(account_key),
      amount REAL NOT NULL,
      FOREIGN KEY(category_key) REFERENCES category_definitions(category_key)
      );
    CREATE TABLE operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'local-user',
      operation_type TEXT NOT NULL,
      source_page TEXT NOT NULL,
      business_tab TEXT,
      selection_json TEXT NOT NULL DEFAULT '[]',
      total_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE cash_account_balances (
      month TEXT NOT NULL,
      account_key TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(month, account_key),
      FOREIGN KEY(account_key) REFERENCES account_definitions(account_key)
    );
    CREATE TABLE investment_account_balances (
      month TEXT NOT NULL,
      account_key TEXT NOT NULL,
      principal REAL NOT NULL DEFAULT 0,
      market_value REAL NOT NULL DEFAULT 0,
      cash_balance REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(month, account_key),
      FOREIGN KEY(account_key) REFERENCES account_definitions(account_key)
    );
    CREATE TABLE fixed_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      asset_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      purchase_date TEXT,
      purchase_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '在用',
      note TEXT NOT NULL DEFAULT '',
      UNIQUE(month, asset_key)
    );
    CREATE TABLE debt_manager (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL DEFAULT '',
      counterparty TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      start_date TEXT NOT NULL,
      is_paid INTEGER NOT NULL DEFAULT 0,
      paid_date TEXT
    );
    CREATE TABLE auto_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('支出','收入')),
      match_scope TEXT NOT NULL DEFAULT 'product'
        CHECK(match_scope IN ('product','merchant','merchant_product')),
      counterparty TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      match_counterparty_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN match_scope IN ('merchant','merchant_product')
            THEN ${NORMALIZE_MATCH_KEY_FUNCTION}(counterparty)
          ELSE ''
        END
      ) STORED,
      match_product_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN match_scope IN ('product','merchant_product')
            THEN ${NORMALIZE_MATCH_KEY_FUNCTION}(product)
          ELSE ''
        END
      ) STORED,
      rewrite_merchant TEXT NOT NULL DEFAULT '',
      rewrite_product TEXT NOT NULL DEFAULT '',
      category_key TEXT NOT NULL,
      category TEXT NOT NULL,
      CHECK(
        (match_scope='product' AND match_counterparty_key='' AND match_product_key<>'')
        OR (match_scope='merchant' AND match_counterparty_key<>'' AND match_product_key='')
        OR (match_scope='merchant_product' AND match_counterparty_key<>'' AND match_product_key<>'')
      ),
      FOREIGN KEY(category_key) REFERENCES category_definitions(category_key)
    );
    CREATE TABLE month_status (
      month TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'draft',
      locked_at TEXT,
      updated_at TEXT,
      fixed_assets_initialized INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_transactions_month ON transactions(month);
    CREATE INDEX idx_transactions_type ON transactions(type);
    CREATE INDEX idx_transactions_category_key ON transactions(category_key);
    CREATE INDEX idx_transactions_account ON transactions(account_key,type,month);
    CREATE INDEX idx_transactions_month_date ON transactions(month, transaction_date, id);
    CREATE INDEX idx_cash_balances_month ON cash_account_balances(month);
    CREATE INDEX idx_investment_balances_month ON investment_account_balances(month);
    CREATE INDEX idx_fixed_assets_month ON fixed_assets(month);
    CREATE INDEX idx_debt_start ON debt_manager(start_date);
    CREATE INDEX idx_debt_paid ON debt_manager(is_paid);
    CREATE UNIQUE INDEX idx_auto_rules_match
      ON auto_rules(transaction_type, match_scope, match_counterparty_key, match_product_key);
    CREATE INDEX idx_operation_logs_created ON operation_logs(created_at, id);
  `);
  const insert = db.prepare(`
    INSERT INTO category_definitions
      (category_key, name, transaction_type, necessity, pattern,
       is_big_ticket, color, is_active, sort_order, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  Object.entries(CATEGORY_METADATA)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([name, metadata], order) => {
      insert.run(
        categoryKey(name),
        name,
        metadata.type,
        metadata.necessity === "必要" || metadata.necessity === "可控"
          ? metadata.necessity : "不适用",
        ["周期", "日常", "偶尔"].includes(metadata.pattern)
          ? metadata.pattern : "不适用",
        "is_big_ticket" in metadata && metadata.is_big_ticket ? 1 : 0,
        categoryColor(order),
        order,
        ""
      );
    });
  const account = db.prepare(`
    INSERT INTO account_definitions
      (account_key, name, account_type, is_active, sort_order)
    VALUES (?, ?, ?, 1, ?)
  `);
  account.run("cash-default", "默认现金账户", "cash", 0);
  account.run("investment-default", "默认理财账户", "investment", 1);
  db.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION}`);
}
