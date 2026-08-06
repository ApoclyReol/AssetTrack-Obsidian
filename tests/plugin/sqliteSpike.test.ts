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

    const saveMonth = db.prepare(
      "INSERT INTO month_status (month,status,updated_at) VALUES (?,?,?)"
    );
    for (let index = 1; index <= 12; index += 1) {
      saveMonth.run(
        `2026-${String(index).padStart(2, "0")}`,
        "saved",
        "2026-12-31T00:00:00.000Z"
      );
    }
    const insertRule = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    for (let index = 0; index < 20; index += 1) {
      insertRule.run("支出", "", `商品-${index}`, category, "餐饮基础");
    }
    const analyticsStarted = performance.now();
    const productOverview = repository.productOverview();
    const ruleInsights = repository.ruleWorkspaceAnalytics(2);
    const analyticsElapsed = performance.now() - analyticsStarted;
    expect(productOverview.groups).toHaveLength(200);
    expect(ruleInsights.historical_products).toHaveLength(200);
    expect(analyticsElapsed).toBeLessThan(8_000);
    manager.close();

    const reopened = new DatabaseManager(path);
    expect(reopened.validate(true).valid).toBe(true);
    reopened.close();
  }, 20_000);
});
