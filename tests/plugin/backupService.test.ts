import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetTrackRepository } from "../../src/database/AssetTrackRepository";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { categoryKey } from "../../src/database/schema";
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
});
