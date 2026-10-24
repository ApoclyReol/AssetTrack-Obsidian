import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { BackupManifest } from "../../src/types/backup";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AssetTrackRepository } from "../../src/database/AssetTrackRepository";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { categoryKey } from "../../src/database/schema";
import { createSchema } from "../../src/database/schema";
import { BackupService } from "../../src/services/BackupService";

const managers: DatabaseManager[] = [];

function setup(): {
  manager: DatabaseManager;
  repository: AssetTrackRepository;
  backup: BackupService;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), "asset-track-backup-ts-"));
  const manager = new DatabaseManager(join(root, "data", "accounting_system.db"));
  managers.push(manager);
  const repository = new AssetTrackRepository(manager);
  repository.initialize();
  return {
    manager,
    repository,
    backup: new BackupService(manager, "1.0.0"),
    root
  };
}

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.close());
});

describe("current backup service", () => {
  it("validates and restores a schema 11 SQLite backup through protected migration", async () => {
    const { repository, backup, root } = setup();
    const legacyPath = join(root, "legacy.db");
    const legacy = new DatabaseSync(legacyPath);
    createSchema(legacy);
    legacy.exec(`

    DROP INDEX idx_auto_rules_match;
    ALTER TABLE auto_rules DROP COLUMN rewrite_empty_mode;
    ALTER TABLE auto_rules DROP COLUMN match_amount_min_key;
    ALTER TABLE auto_rules DROP COLUMN match_amount_max_key;
    ALTER TABLE auto_rules DROP COLUMN match_amount_max_exclusive;
    ALTER TABLE auto_rules DROP COLUMN match_amount_min_exclusive;
    ALTER TABLE auto_rules DROP COLUMN match_amount_max_minor;
    ALTER TABLE auto_rules DROP COLUMN match_amount_min_minor;
    ALTER TABLE auto_rules DROP COLUMN match_amount_key;
    ALTER TABLE auto_rules DROP COLUMN match_amount_minor;
    CREATE UNIQUE INDEX idx_auto_rules_match ON auto_rules(transaction_type,match_scope,match_counterparty_key,match_product_key);
    DROP TABLE transaction_tags;
      DROP TABLE category_attributes;
      DROP TABLE tags;
      DROP TABLE attribute_options;
      DROP TABLE attribute_groups;
      PRAGMA user_version=11;
    `);
    legacy.close();
    const validation = await backup.validate(legacyPath);
    expect(validation.valid).toBe(true);
    expect(validation.schema.schema_version).toBe(13);
    await expect(backup.restore(legacyPath)).resolves.toMatchObject({ mode: "sqlite" });
    expect(repository.accounts().rows).toHaveLength(2);
  });

  it("exports, validates and restores one complete zip", async () => {
    const { repository, backup, root } = setup();
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      [{
        account_key: "investment-default",
        principal: 100,
        market_value: 120,
        cash_balance: 10
      }],
      [{
        transaction_date: "2026-01-01",
        type: "收入",
        category_key: categoryKey("工资收入"),
        category: "工资收入",
        product: "工资,含奖金",
        amount: 8000
      },
      {
        transaction_date: "2026-01-15",
        type: "加仓",
        category: "",
        product: "理财转入",
        account_key: "investment-default",
        amount: 100
      }],
      []
    );
    const exported = await backup.exportZip(join(root, "exports"));
    expect(existsSync(exported.path)).toBe(true);
    expect(exported.validation).toMatchObject({
      valid: true,
      mode: "complete",
      row_counts: { transactions: 2 }
    });
    expect(exported.validation.manifest?.tables.transactions.columns).toContain("account_key");

    await repository.saveMonth(
      "2026-01",
      1,
      [{ account_key: "cash-default", balance: 5 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      []
    );
    const restored = await backup.restore(exported.path);
    expect(existsSync(String(restored.safety_snapshot))).toBe(true);
    expect((await repository.getMonth("2026-01")).cash_accounts[0].balance).toBe(1000);
    const restoredTransactions = (await repository.getMonth("2026-01")).transactions;
    expect(restoredTransactions).toHaveLength(2);
    expect(restoredTransactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "加仓", account_key: "investment-default" })
    ]));
  });

  it("serializes concurrent ZIP exports and keeps distinct output files", async () => {
    const { backup, root } = setup();
    const results = await Promise.all([
      backup.exportZip(join(root, "exports")),
      backup.exportZip(join(root, "exports"))
    ]);
    expect(new Set(results.map((result) => result.path)).size).toBe(2);
    expect(results.every((result) => result.validation.valid)).toBe(true);
  });

  it("rejects a damaged zip before replacing the current database", async () => {
    const { repository, backup, root } = setup();
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 321 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      []
    );
    const exported = await backup.exportZip(join(root, "exports"));
    const damaged = join(root, "damaged.zip");
    const bytes = readFileSync(exported.path);
    bytes[Math.floor(bytes.length / 3)] ^= 0xff;
    writeFileSync(damaged, bytes);
    await expect(backup.restore(damaged)).rejects.toBeDefined();
    expect((await repository.getMonth("2026-01")).cash_accounts[0].balance).toBe(321);
    expect((await repository.getMonth("2026-01")).revision).toBe(1);
  });

  it("reopens the current database when the final restore guard rejects", async () => {
    const { repository, backup, root, manager } = setup();
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 456 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      []
    );
    const exported = await backup.exportZip(join(root, "exports"));
    await expect(backup.restore(exported.path, () => {
      throw new Error("restore guard rejected");
    })).rejects.toThrow("restore guard rejected");
    expect(manager.isOpen).toBe(true);
    expect((await repository.getMonth("2026-01")).cash_accounts[0].balance).toBe(456);
  });

  it("serializes concurrent restores through one incoming candidate", async () => {
    const { repository, backup, root } = setup();
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 111 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      []
    );
    const exported = await backup.exportZip(join(root, "exports"));
    await repository.saveMonth(
      "2026-01",
      1,
      [{ account_key: "cash-default", balance: 222 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      []
    );

    const results = await Promise.all([
      backup.restore(exported.path),
      backup.restore(exported.path)
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.safety_snapshot)).toBe(true);
    expect((await repository.getMonth("2026-01")).cash_accounts[0].balance).toBe(111);
  });
});

it.each([{ version: 12, format: 9 }, { version: 13, format: 10 }, { version: 14, format: 11 }, { version: 15, format: 12 }])("restores schema $version with a format $format manifest", async ({ version, format }) => {
  const { backup, root } = setup();
  const exported = await backup.exportZip(root);
  const directory = mkdtempSync(join(tmpdir(), `asset-track-format${format}-`));
  const zip = readFileSync(exported.path);
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameSize = zip.readUInt16LE(offset + 26);
    const extraSize = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameSize).toString("utf8");
    const start = offset + 30 + nameSize + extraSize;
    writeFileSync(join(directory, name), inflateRawSync(zip.subarray(start, start + size)));
    offset = start + size;
  }
  const databasePath = join(directory, "accounting_system.db");
  const db = new DatabaseSync(databasePath);
  const rangeColumns = ["match_amount_min_key", "match_amount_max_key", "match_amount_max_exclusive", "match_amount_min_exclusive", "match_amount_max_minor", "match_amount_min_minor"];
  const excluded = new Set(version === 15 ? [] : ["rewrite_empty_mode", ...(version < 14 ? rangeColumns : []), ...(version === 12 ? ["match_amount_key", "match_amount_minor"] : [])]);
  db.exec(`DROP INDEX idx_auto_rules_match;
    ${[...excluded].map((column) => `ALTER TABLE auto_rules DROP COLUMN ${column};`).join("\n")}
    CREATE UNIQUE INDEX idx_auto_rules_match ON auto_rules(transaction_type,match_scope,match_counterparty_key,match_product_key${version === 13 ? ",match_amount_key" : version >= 14 ? ",match_amount_min_key,match_amount_max_key" : ""});
    PRAGMA user_version=${version};`);
  db.close();
  const csvPath = join(directory, "auto_rules_backup.csv");
  writeFileSync(csvPath, readFileSync(csvPath, "utf8").trim().split(",").filter((column) => !excluded.has(column)).join(",") + "\r\n");
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  manifest.format_version = format; manifest.schema_version = version;
  manifest.tables.auto_rules.columns = manifest.tables.auto_rules.columns.filter((name) => !excluded.has(name));
  for (const name of ["accounting_system.db", "auto_rules_backup.csv"]) {
    const data = readFileSync(join(directory, name));
    manifest.files[name] = { ...manifest.files[name], size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  }
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect((await backup.validate(directory)).schema.schema_version).toBe(13);
  await expect(backup.restore(directory)).resolves.toBeTruthy();
});

it("round trips open and closed range endpoints in the format 12 backup", async () => {
  const { repository, backup, root } = setup();
  const saved = await repository.saveRules(repository.rules().revision, [{
    transaction_type: "支出", match_scope: "merchant", counterparty: "平台", product: "",
    category_key: categoryKey("订阅服务"), category: "订阅服务",
    match_amount_min_minor: 200, match_amount_max_minor: 5000,
    match_amount_min_exclusive: true, match_amount_max_exclusive: false, rewrite_empty_mode: "clear"
  }, {
    transaction_type: "支出", match_scope: "merchant", counterparty: "平台", product: "",
    category_key: categoryKey("订阅服务"), category: "订阅服务", match_amount_minor: 1990
  }]);
  const exported = await backup.exportZip(root);
  expect(exported.validation.manifest).toMatchObject({ format_version: 12, schema_version: 13 });
  await repository.saveRules(saved.revision, []);
  await backup.restore(exported.path);
  expect(repository.ruleWorkspaceShell().rules[0]).toMatchObject({
    match_amount_minor: null, match_amount_min_minor: 200, match_amount_max_minor: 5000,
    match_amount_min_exclusive: true, match_amount_max_exclusive: false, rewrite_empty_mode: "clear"
  });
  expect(repository.ruleWorkspaceShell().rules[1]).toMatchObject({ match_amount_minor: 1990, match_amount_min_minor: null, match_amount_max_minor: null });
});
