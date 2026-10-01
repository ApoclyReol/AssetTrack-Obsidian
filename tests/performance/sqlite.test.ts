import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssetTrackRepository } from "../../src/database/AssetTrackRepository";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { categoryKey } from "../../src/database/schema";

describe("node:sqlite technical spike", () => {
  it("handles 50k synthetic transactions across 10 years with bounded reads", async () => {
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
      const monthIndex = index % 120;
      const month = `${2017 + Math.floor(monthIndex / 12)}-${String(monthIndex % 12 + 1).padStart(2, "0")}`;
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
    const saveMonth = db.prepare(
      "INSERT INTO month_status (month,status,updated_at) VALUES (?,?,?)"
    );
    for (let index = 0; index < 120; index += 1) {
      const month = `${2017 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
      saveMonth.run(month, "saved", "2026-12-31T00:00:00.000Z");
    }
    const started = performance.now();
    const annual = repository.annual("2026");
    const elapsed = performance.now() - started;
    expect(annual.rows).toHaveLength(12);
    expect(annual.metrics.total_expense).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);

    const monthlyStarted = performance.now();
    const monthly = await repository.getMonth("2026-12");
    const monthlyElapsed = performance.now() - monthlyStarted;
    expect(monthly.transactions.length).toBeGreaterThan(0);
    expect(monthlyElapsed).toBeLessThan(2_000);
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
    // The default overview is intentionally limited to the latest 12 months;
    // the bounded fixture therefore contains fewer groups than the full history.
    expect(productOverview.groups).toHaveLength(60);
    expect(productOverview.scope).toMatchObject({
      kind: "analysis",
      from_date: "2026-01-01",
      to_date: "2026-12-31",
      month_count: 12
    });
    // Matching-rule usage is intentionally limited to the latest 12 months.
    expect(ruleInsights.historical_products).toHaveLength(60);
    expect(ruleInsights.scope).toMatchObject({
      kind: "analysis",
      from_date: "2026-01-01",
      to_date: "2026-12-31",
      month_count: 12
    });
    expect(analyticsElapsed).toBeLessThan(8_000);
    db.exec("INSERT INTO transaction_tags(transaction_id,tag_key) SELECT id,'tag-travel' FROM transactions");
    const taxonomyStarted = performance.now();
    const taxonomy = repository.taxonomy();
    const taxonomyElapsed = performance.now() - taxonomyStarted;
    expect(taxonomy.tags.find((tag) => tag.tag_key === "tag-travel")?.transaction_count).toBe(50_000);
    expect(taxonomyElapsed).toBeLessThan(4_000);
    manager.close();

    const reopened = new DatabaseManager(path);
    expect(reopened.validate(true).valid).toBe(true);
    reopened.close();
  }, 20_000);
});
