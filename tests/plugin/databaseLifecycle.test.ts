import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
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

it("creates and reopens a schema 11 database at a Chinese path", async () => {
    const { manager, repository, path } = fixture();
    expect(manager.validate(true)).toMatchObject({
      valid: true,
      schema_version: 11,
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

it("recovers a valid rollback and removes stale restore sidecars", () => {
    const { manager, path } = fixture();
    manager.close();
    const rollback = `${path}.rollback`;
    renameSync(path, rollback);
    writeFileSync(path, "partial restore", "utf8");
    writeFileSync(`${path}-wal`, "stale wal", "utf8");
    writeFileSync(`${path}-shm`, "stale shm", "utf8");
    expect(DatabaseManager.inspect(path).recovery_available).toBe(true);

    const reopened = new DatabaseManager(path);
    trackManager(reopened);
    expect(reopened.validate(true)).toMatchObject({
      valid: true,
      schema_version: 11,
      integrity_check: "ok"
    });
    expect(existsSync(rollback)).toBe(false);
    if (existsSync(`${path}-wal`)) {
      expect(readFileSync(`${path}-wal`)).not.toEqual(Buffer.from("stale wal", "utf8"));
    }
    if (existsSync(`${path}-shm`)) {
      expect(readFileSync(`${path}-shm`)).not.toEqual(Buffer.from("stale shm", "utf8"));
    }
});

it("keeps the recovered target and discards an uninstalled incoming candidate", () => {
    const { manager, path } = fixture();
    manager.close();
    const incoming = `${path}.incoming`;
    copyFileSync(path, incoming);
    rmSync(path, { force: true });
    expect(DatabaseManager.inspect(path).recovery_available).toBe(true);

    const reopened = new DatabaseManager(path);
    trackManager(reopened);
    expect(reopened.validate(true).valid).toBe(true);
    expect(existsSync(incoming)).toBe(false);
});

it("keeps a valid incoming restore candidate when both target and rollback are damaged", () => {
    const { manager, path } = fixture();
    manager.close();
    const incoming = `${path}.incoming`;
    const rollback = `${path}.rollback`;
    copyFileSync(path, incoming);
    writeFileSync(path, "damaged target", "utf8");
    writeFileSync(rollback, "damaged rollback", "utf8");

    const reopened = new DatabaseManager(path);
    trackManager(reopened);
    expect(reopened.validate(true)).toMatchObject({ valid: true, schema_version: 11 });
    expect(existsSync(incoming)).toBe(false);
    expect(existsSync(rollback)).toBe(false);
    reopened.close();
});
});
