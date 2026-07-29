import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { createSchema } from "../../src/database/schema";

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

describe("schema validation", () => {
  it("accepts a complete schema 9 database", () => {
    const path = databasePath();
    createDatabase(path).close();
    expect(DatabaseManager.inspect(path)).toMatchObject({
      exists: true,
      valid: true,
      validation: {
        missing_tables: [],
        missing_columns: {},
        missing_indexes: [],
        missing_foreign_keys: [],
        foreign_key_violations: 0
      }
    });
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
});
