import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

describe("database read windows", () => {
  it("defaults product overview to one year and system checks to five years", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string, product: string) => repository.saveMonth(
      month,
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: `${month}-01`,
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "测试商户",
        product,
        amount: 20
      }],
      []
    );

    await save("2019-01", "远期商品");
    await save("2026-01", "近期商品");

    const overview = repository.productOverview();
    expect(overview.scope).toMatchObject({
      kind: "analysis",
      from_date: "2025-02-01",
      to_date: "2026-01-31",
      month_count: 12
    });
    expect(overview.groups.map((row) => row.product)).toEqual(["近期商品"]);

    const selected = repository.productOverview({
      from_date: "2019-01-01",
      to_date: "2019-01-31"
    });
    expect(selected.scope).toMatchObject({
      from_date: "2019-01-01",
      to_date: "2019-01-31",
      month_count: 1
    });
    expect(selected.groups.map((row) => row.product)).toEqual(["远期商品"]);

    const health = repository.productHistoryIndex({ issue_filter: "conflict" });
    expect(health.scope).toMatchObject({
      kind: "system-check",
      from_date: "2021-02-01",
      to_date: "2026-01-31",
      month_count: 60
    });
    expect(health.groups).toEqual([]);

    const analytics = repository.ruleWorkspaceAnalytics();
    expect(analytics.scope).toMatchObject({
      kind: "system-check",
      from_date: "2021-02-01",
      to_date: "2026-01-31",
      month_count: 60
    });
    expect(analytics.historical_products.map((row) => row.product)).toEqual(["近期商品"]);
  });

  it("rejects incomplete or reversed product overview date ranges", () => {
    const { repository } = fixture();
    expect(() => repository.productOverview({ from_date: "2026-01-01" }))
      .toThrowError("history.date_range_incomplete");
    expect(() => repository.productOverview({
      from_date: "2026-02-01",
      to_date: "2026-01-31"
    })).toThrowError("history.date_range_invalid");
  });

  it("applies the same system window to rule reports, candidates, and impact previews", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string, product: string) => repository.saveMonth(
      month,
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: `${month}-01`,
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "测试商户",
        product,
        amount: 20
      }],
      []
    );

    await save("2019-01", "旧窗口商品");
    await save("2026-01", "当前窗口商品");

    const impact = repository.ruleImpactPreview({
      transaction_type: "支出",
      match_scope: "merchant_product",
      counterparty: "测试商户",
      product: "当前窗口商品",
      category_key: food,
      category: "餐饮基础"
    });
    expect(impact.transaction_count).toBe(1);

    const candidates = repository.ruleCandidates("2026-02", [], 1);
    expect(candidates.rows.map((row) => row.product)).toEqual(["当前窗口商品"]);

    const saved = await repository.saveRules(repository.rules().revision, [{
      transaction_type: "支出",
      counterparty: "测试商户",
      product: "当前窗口商品",
      category_key: food,
      category: "餐饮基础"
    }]);
    expect(saved.rows[0]).toMatchObject({
      occurrences: 1,
      last_month: "2026-01",
      last_used_date: "2026-01-01"
    });
  });
});
