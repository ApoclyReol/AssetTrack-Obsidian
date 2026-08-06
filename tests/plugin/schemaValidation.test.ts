import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import {
  categoryKey,
  createSchema,
  SchemaMigrationError
} from "../../src/database/schema";

function databasePath(): string {
  return join(
    mkdtempSync(join(tmpdir(), "asset-track-schema-")),
    "accounting_system.db"
  );
}

function createDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  createSchema(db);
  return db;
}

function downgradeToSchema9(db: DatabaseSync): void {
  db.exec(`
    DROP INDEX idx_auto_rules_match;
    ALTER TABLE category_definitions DROP COLUMN description;
    DROP TABLE auto_rules;
    CREATE TABLE auto_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('支出','收入')),
      counterparty TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      category_key TEXT NOT NULL,
      category TEXT NOT NULL,
      FOREIGN KEY(category_key) REFERENCES category_definitions(category_key)
    );
    CREATE INDEX idx_auto_rules_match
      ON auto_rules(transaction_type, counterparty, product);
    PRAGMA user_version=9;
  `);
}

function createSchema9Database(path: string): DatabaseSync {
  const db = createDatabase(path);
  downgradeToSchema9(db);
  return db;
}

function insertLegacyRule(
  db: DatabaseSync,
  values: {
    transaction_type?: string;
    counterparty?: string;
    product?: string;
    category_key?: string;
    category?: string;
  }
): void {
  db.prepare(`
    INSERT INTO auto_rules
      (transaction_type,counterparty,product,category_key,category)
    VALUES (?,?,?,?,?)
  `).run(
    values.transaction_type ?? "支出",
    values.counterparty ?? "",
    values.product ?? "咖啡",
    values.category_key ?? categoryKey("餐饮基础"),
    values.category ?? "餐饮基础"
  );
}

describe("schema validation", () => {
  it("accepts a complete schema 10 database", () => {
    const path = databasePath();
    createDatabase(path).close();
    expect(DatabaseManager.inspect(path)).toMatchObject({
      exists: true,
      valid: true,
      validation: {
        missing_tables: [],
        missing_columns: {},
        invalid_columns: {},
        missing_indexes: [],
        invalid_indexes: [],
        missing_foreign_keys: [],
        foreign_key_violations: 0
      }
    });
    expect(DatabaseManager.inspect(path).validation?.schema_version).toBe(10);
  });

  it("marks a structurally valid schema 9 database for automatic migration without writing during inspection", () => {
    const path = databasePath();
    const db = createSchema9Database(path);
    db.close();

    expect(DatabaseManager.inspect(path)).toMatchObject({
      exists: true,
      valid: false,
      migration_required: true,
      validation: { schema_version: 9 }
    });
    const unchanged = new DatabaseSync(path, { readOnly: true });
    expect((unchanged.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(9);
    unchanged.close();
  });

  it("rejects a schema with a required column removed", () => {
    const path = databasePath();
    const db = createDatabase(path);
    db.exec("ALTER TABLE transactions DROP COLUMN counterparty");
    db.close();
    const inspection = DatabaseManager.inspect(path);
    expect(inspection.valid).toBe(false);
    expect(inspection.validation?.missing_columns).toEqual({
      transactions: ["counterparty"]
    });
  });

  it("rejects a schema with a required index removed", () => {
    const path = databasePath();
    const db = createDatabase(path);
    db.exec("DROP INDEX idx_transactions_month");
    db.close();
    const inspection = DatabaseManager.inspect(path);
    expect(inspection.valid).toBe(false);
    expect(inspection.validation?.missing_indexes).toContain(
      "idx_transactions_month"
    );
  });

  it("rejects a schema with a required foreign key removed", () => {
    const path = databasePath();
    const db = createDatabase(path);
    db.exec(`
      DROP INDEX idx_auto_rules_match;
      ALTER TABLE auto_rules RENAME TO auto_rules_old;
      CREATE TABLE auto_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_type TEXT NOT NULL,
        counterparty TEXT NOT NULL DEFAULT '',
        product TEXT NOT NULL DEFAULT '',
        category_key TEXT NOT NULL,
        category TEXT NOT NULL
      );
      DROP TABLE auto_rules_old;
      CREATE INDEX idx_auto_rules_match
        ON auto_rules(transaction_type, counterparty, product);
    `);
    db.close();
    const inspection = DatabaseManager.inspect(path);
    expect(inspection.valid).toBe(false);
    expect(inspection.validation?.missing_foreign_keys).toContain(
      "auto_rules.category_key→category_definitions.category_key"
    );
  });

  it("creates normalized generated match keys and enforces scoped uniqueness", () => {
    const path = databasePath();
    const db = createDatabase(path);
    const food = categoryKey("餐饮基础");
    const insert = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    insert.run("支出", "", "  Coffee   Beans ", food, "餐饮基础");
    expect(db.prepare(
      "SELECT match_scope,match_counterparty_key,match_product_key FROM auto_rules"
    ).get()).toMatchObject({
      match_scope: "product",
      match_counterparty_key: "",
      match_product_key: "coffee beans"
    });
    expect(() => insert.run("支出", "", "coffee beans", food, "餐饮基础"))
      .toThrow();
    const merchant = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,match_scope,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?,?)
    `);
    merchant.run("支出", "merchant", "商户甲", "", food, "餐饮基础");
    expect(db.prepare(
      "SELECT match_counterparty_key,match_product_key FROM auto_rules WHERE match_scope='merchant'"
    ).get()).toMatchObject({
      match_counterparty_key: "商户甲",
      match_product_key: ""
    });
    db.close();
  });

  it("migrates schema 9 in one transaction and retains a validated protection backup", () => {
    const path = databasePath();
    const db = createSchema9Database(path);
    insertLegacyRule(db, { product: "  Coffee   Beans " });
    insertLegacyRule(db, { counterparty: "商户甲", product: "" });
    insertLegacyRule(db, { counterparty: "商户甲", product: "咖啡" });
    const food = categoryKey("餐饮基础");
    db.prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category_key,category,counterparty,product,amount)
      VALUES (?,?,?,?,?,?,?,?)
    `).run("2026-01", "2026-01-03", "支出", food, "餐饮基础", "商户甲", "午餐", 25.5);
    db.prepare(
      "INSERT INTO cash_account_balances(month,account_key,balance) VALUES (?,?,?)"
    ).run("2026-01", "cash-default", 1000);
    db.prepare(
      "INSERT INTO investment_account_balances(month,account_key,principal,market_value,cash_balance) VALUES (?,?,?,?,?)"
    ).run("2026-01", "investment-default", 200, 210, 5);
    db.prepare(`
      INSERT INTO fixed_assets
        (month,asset_key,asset_name,category,purchase_date,purchase_price,status,note)
      VALUES (?,?,?,?,?,?,?,?)
    `).run("2026-01", "phone", "手机", "电子设备", "2026-01-02", 3000, "在用", "旧设备");
    db.prepare(`
      INSERT INTO debt_manager
        (description,counterparty,amount,start_date,is_paid,paid_date)
      VALUES (?,?,?,?,?,?)
    `).run("借款", "朋友", 500, "2026-01-01", 0, null);
    db.prepare(`
      INSERT INTO month_status
        (month,status,locked_at,updated_at,fixed_assets_initialized,revision)
      VALUES (?,?,?,?,?,?)
    `).run("2026-01", "saved", null, "2026-01-31T00:00:00.000Z", 1, 4);
    db.close();

    const manager = new DatabaseManager(path);
    const migrated = manager.open();
    expect(manager.validate(true).valid).toBe(true);
    expect((migrated.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(10);
    expect(migrated.prepare(
      "SELECT description FROM category_definitions WHERE category_key=?"
    ).get(categoryKey("餐饮基础"))).toMatchObject({ description: "" });
    expect(migrated.prepare(`
      SELECT id,match_scope,match_counterparty_key,match_product_key,
             rewrite_merchant,rewrite_product
      FROM auto_rules ORDER BY id
    `).all()).toEqual([
      expect.objectContaining({ id: 1, match_scope: "product", match_product_key: "coffee beans" }),
      expect.objectContaining({ id: 2, match_scope: "merchant", match_counterparty_key: "商户甲" }),
      expect.objectContaining({ id: 3, match_scope: "merchant_product", match_counterparty_key: "商户甲", match_product_key: "咖啡" })
    ]);
    expect(migrated.prepare(`
      SELECT month,transaction_date,type,category_key,category,counterparty,product,amount
      FROM transactions
    `).all()).toEqual([{
      month: "2026-01",
      transaction_date: "2026-01-03",
      type: "支出",
      category_key: food,
      category: "餐饮基础",
      counterparty: "商户甲",
      product: "午餐",
      amount: 25.5
    }]);
    expect(migrated.prepare(
      "SELECT month,account_key,balance FROM cash_account_balances"
    ).all()).toEqual([{ month: "2026-01", account_key: "cash-default", balance: 1000 }]);
    expect(migrated.prepare(
      "SELECT month,account_key,principal,market_value,cash_balance FROM investment_account_balances"
    ).all()).toEqual([{
      month: "2026-01",
      account_key: "investment-default",
      principal: 200,
      market_value: 210,
      cash_balance: 5
    }]);
    expect(migrated.prepare(
      "SELECT month,asset_key,asset_name,category,purchase_date,purchase_price,status,note FROM fixed_assets"
    ).all()).toEqual([{
      month: "2026-01",
      asset_key: "phone",
      asset_name: "手机",
      category: "电子设备",
      purchase_date: "2026-01-02",
      purchase_price: 3000,
      status: "在用",
      note: "旧设备"
    }]);
    expect(migrated.prepare(
      "SELECT description,counterparty,amount,start_date,is_paid,paid_date FROM debt_manager"
    ).all()).toEqual([{
      description: "借款",
      counterparty: "朋友",
      amount: 500,
      start_date: "2026-01-01",
      is_paid: 0,
      paid_date: null
    }]);
    expect(migrated.prepare(
      "SELECT month,status,locked_at,updated_at,fixed_assets_initialized,revision FROM month_status"
    ).all()).toEqual([{
      month: "2026-01",
      status: "saved",
      locked_at: null,
      updated_at: "2026-01-31T00:00:00.000Z",
      fixed_assets_initialized: 1,
      revision: 4
    }]);
    const backups = readdirSync(join(dirname(path), "backups"))
      .filter((name) => name.startsWith("before-schema10-") && name.endsWith(".db"));
    expect(backups).toHaveLength(1);
    const protection = new DatabaseSync(join(dirname(path), "backups", backups[0]), {
      readOnly: true
    });
    expect((protection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(9);
    expect(protection.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok"
    });
    protection.close();
    manager.close();
  });

  it.each([
    {
      name: "an ambiguous rule",
      rules: [{ product: "   ", counterparty: "\t" }],
      code: "ambiguous_rule_scope" as const
    },
    {
      name: "duplicate normalized rules",
      rules: [{ product: "Coffee" }, { product: "  coffee  " }],
      code: "duplicate_rule" as const
    }
  ])("reports and rolls back when migration contains $name", ({ rules, code }) => {
    const path = databasePath();
    const db = createSchema9Database(path);
    rules.forEach((rule) => insertLegacyRule(db, rule));
    db.close();

    const manager = new DatabaseManager(path);
    let caught: unknown;
    try {
      manager.open();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SchemaMigrationError);
    expect((caught as SchemaMigrationError).report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })])
    );
    const unchanged = new DatabaseSync(path, { readOnly: true });
    expect((unchanged.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(9);
    expect((unchanged.prepare("PRAGMA table_info(category_definitions)").all() as Array<{ name: string }>)
      .some((column) => column.name === "description")).toBe(false);
    expect((unchanged.prepare("PRAGMA table_info(auto_rules)").all() as Array<{ name: string }>)
      .some((column) => column.name === "match_scope")).toBe(false);
    unchanged.close();
  });

  it("blocks migration when a legacy rule targets an inactive category", () => {
    const path = databasePath();
    const db = createSchema9Database(path);
    const food = categoryKey("餐饮基础");
    db.prepare("UPDATE category_definitions SET is_active=0 WHERE category_key=?").run(food);
    insertLegacyRule(db, { category_key: food });
    db.close();

    const manager = new DatabaseManager(path);
    expect(() => manager.open()).toThrow(SchemaMigrationError);
    manager.close();
    const unchanged = new DatabaseSync(path, { readOnly: true });
    expect((unchanged.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(9);
    unchanged.close();
  });
});
