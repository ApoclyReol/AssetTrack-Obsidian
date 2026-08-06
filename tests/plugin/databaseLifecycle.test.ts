import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { fixture, trackManager } from "./databaseTestFixtures";

describe("database lifecycle", () => {

it("inspects missing and damaged database files without creating or replacing them", () => {
    const root = mkdtempSync(join(tmpdir(), "asset-track-inspect-"));
    const missing = join(root, "accounting_system.db");
    expect(DatabaseManager.inspect(missing)).toEqual({
      exists: false,
      valid: false,
      validation: null,
      error: null
    });
    expect(existsSync(missing)).toBe(false);

    writeFileSync(missing, "not a sqlite database", "utf8");
    const before = readFileSync(missing);
    expect(DatabaseManager.inspect(missing)).toMatchObject({
      exists: true,
      valid: false
    });
    expect(readFileSync(missing)).toEqual(before);
  });

it("creates and reopens a schema 10 database at a Chinese path", async () => {
    const { manager, repository, path } = fixture();
    expect(manager.validate(true)).toMatchObject({
      valid: true,
      schema_version: 10,
      integrity_check: "ok"
    });
    expect(repository.accounts().rows.map((row) => row.account_key)).toEqual([
      "cash-default",
      "investment-default"
    ]);
    await manager.reopen();
    expect(readFileSync(path, { encoding: null }).subarray(0, 15).toString()).toBe(
      "SQLite format 3"
    );
  });

it("rejects an unsupported schema without modifying it", () => {
    const root = mkdtempSync(join(tmpdir(), "asset-track-schema-"));
    const path = join(root, "schema-7.db");
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE legacy(value INTEGER); PRAGMA user_version=7");
    legacy.close();
    const manager = new DatabaseManager(path);
    trackManager(manager);
    expect(() => manager.open()).toThrow(/schema 9/);
    const inspected = new DatabaseSync(path, { readOnly: true });
    expect(
      (inspected.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    ).toBe(7);
    inspected.close();
  });
});
