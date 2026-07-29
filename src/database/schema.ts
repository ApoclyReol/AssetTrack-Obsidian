import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CATEGORY_COLORS } from "../domain/categoryColors";

export const CURRENT_SCHEMA_VERSION = 9;
export const BACKUP_FORMAT_VERSION = 3;

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
  "month_status"
] as const;

export const REQUIRED_COLUMNS: Record<
  typeof REQUIRED_TABLES[number],
  readonly string[]
> = {
  category_definitions: [
    "category_key",
    "name",
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
    "counterparty",
    "product",
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
  ]
};

export const REQUIRED_INDEXES = [
  "idx_transactions_month",
  "idx_transactions_type",
  "idx_transactions_category_key",
  "idx_transactions_month_date",
  "idx_cash_balances_month",
  "idx_investment_balances_month",
  "idx_fixed_assets_month",
  "idx_debt_start",
  "idx_debt_paid",
  "idx_auto_rules_match"
] as const;

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

export function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE category_definitions (
      category_key TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
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
      amount REAL NOT NULL,
      FOREIGN KEY(category_key) REFERENCES category_definitions(category_key)
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
      counterparty TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      category_key TEXT NOT NULL,
      category TEXT NOT NULL,
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
    CREATE INDEX idx_transactions_month_date ON transactions(month, transaction_date, id);
    CREATE INDEX idx_cash_balances_month ON cash_account_balances(month);
    CREATE INDEX idx_investment_balances_month ON investment_account_balances(month);
    CREATE INDEX idx_fixed_assets_month ON fixed_assets(month);
    CREATE INDEX idx_debt_start ON debt_manager(start_date);
    CREATE INDEX idx_debt_paid ON debt_manager(is_paid);
    CREATE INDEX idx_auto_rules_match
      ON auto_rules(transaction_type, counterparty, product);
  `);
  const insert = db.prepare(`
    INSERT INTO category_definitions
      (category_key, name, transaction_type, necessity, pattern,
       is_big_ticket, color, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
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
        order
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
