import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssetTrackRepository } from "../../src/database/AssetTrackRepository";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { categoryKey } from "../../src/database/schema";

describe("node:sqlite technical spike", () => {
  it("handles 50k synthetic transactions and releases the database lock", () => {
    const root = mkdtempSync(join(tmpdir(), "asset-track-spike-"));
    const path = join(root, "中文 path", "accounting_system.db");
    const manager = new DatabaseManager(path);
    const repository = new AssetTrackRepository(manager);
    repository.initialize();
    const db = manager.connection();
    const category = categoryKey("餐饮基础");
    db.exec("BEGIN IMMEDIATE");
    const insert = db.prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category_key,category,product,amount)
      VALUES (?,?,?,?,?,?,?)
    `);
    for (let index = 0; index < 50_000; index += 1) {
      const month = `2026-${String(index % 12 + 1).padStart(2, "0")}`;
      insert.run(
        month,
        `${month}-${String(index % 28 + 1).padStart(2, "0")}`,
        "支出",
        category,
        "餐饮基础",
        `商品-${index % 200}`,
        index % 100 + 0.5
      );
    }
    db.exec("COMMIT");
    const started = performance.now();
    const annual = repository.annual("2026");
    const elapsed = performance.now() - started;
    expect(annual.rows).toHaveLength(12);
    expect(annual.metrics.total_expense).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);
    manager.close();

    const reopened = new DatabaseManager(path);
    expect(reopened.validate(true).valid).toBe(true);
    reopened.close();
  }, 10_000);
});
