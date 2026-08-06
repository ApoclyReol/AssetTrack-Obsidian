import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

describe("rules repository", () => {

it("uses product-only rule candidates, persistence and application", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [1, 2].map((day) => ({
        transaction_date: `2026-01-0${day}`,
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "示例商户",
        product: "午餐",
        amount: 20
      })),
      []
    );
    const candidates = repository.ruleCandidates(
      "2026-02",
      [],
      2
    );
    expect(candidates.rows[0]).toMatchObject({
      product: "午餐",
      occurrences: 2
    });
    const current = repository.rules();
    const saved = await repository.saveRules(current.revision, [{
      transaction_type: "支出",
      counterparty: "示例商户",
      product: "午餐",
      category_key: food,
      category: "餐饮基础"
    }]);
    expect(saved.rows[0]).toMatchObject({
      counterparty: "",
      occurrences: 2,
      last_month: "2026-01",
      last_used_date: "2026-01-02"
    });
    expect(repository.rulesPreview("2026-02", [{
      transaction_date: "2026-02-01",
      type: "支出",
      category: "",
      counterparty: "示例商户",
      product: "午餐",
      amount: 20
    }]).proposed_rows[0].category).toBe("餐饮基础");
  });

it("aggregates saved history, detects conflicts and exposes recommendations", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string, transactions: Parameters<typeof repository.saveMonth>[4]) =>
      repository.saveMonth(
        month,
        0,
        [{ account_key: "cash-default", balance: 100 }],
        investment,
        transactions,
        []
      );
    await save("2026-01", [
      {
        transaction_date: "2026-01-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "咖啡", amount: 10
      },
      {
        transaction_date: "2026-01-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "咖啡", amount: 20
      },
      {
        transaction_date: "2026-01-03", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "超市", product: "水果", amount: 15
      }
    ]);
    await save("2026-02", [
      {
        transaction_date: "2026-02-01", type: "支出",
        category_key: quality, category: "餐饮改善",
        counterparty: "商户甲", product: "咖啡", amount: 30
      },
      {
        transaction_date: "2026-02-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "超市", product: "水果", amount: 25
      }
    ]);
    const currentRules = repository.rules();
    await repository.saveRules(currentRules.revision, [
      {
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "咖啡",
        category_key: food,
        category: "餐饮基础"
      }
    ]);

    const insights = repository.ruleWorkspaceAnalytics(2);
    const coffee = insights.historical_products.find(
      (row) => row.counterparty === "商户甲" && row.product === "咖啡"
    );
    const fruit = insights.historical_products.find(
      (row) => row.counterparty === "超市" && row.product === "水果"
    );
    expect(insights.rules_revision).toBe(repository.rules().revision);
    expect(coffee).toMatchObject({
      occurrences: 3,
      months_count: 2,
      total_amount: 60,
      average_amount: 20,
      latest_amount: 30,
      last_date: "2026-02-01",
      has_category_conflict: true,
      rule_status: "已覆盖",
      matching_rule_count: 1,
      history_rule_mismatch: true
    });
    expect(fruit).toMatchObject({
      occurrences: 2,
      months_count: 2,
      total_amount: 40,
      rule_status: "未创建"
    });
    expect(insights.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        product: "水果",
        occurrences: 2,
        category: "餐饮基础",
        category_confidence: 1,
        has_category_conflict: false
      })
    ]));
    expect(repository.rules().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_status: "正常", counterparty: "" })
    ]));
    expect(insights.rule_conflicts).toEqual([]);
    const detail = repository.productHistory({
      transaction_type: "支出",
      product_key: " 咖啡 "
    });
    expect(detail.rows[0]?.id).toBeTypeOf("number");
    expect(detail.rows[0]?.rule_match).toMatchObject({ status: "matched", level: "product" });
    expect(repository.ruleWorkspaceAnalytics().categories.find((row) => row.category_key === food)).toMatchObject({
      transaction_count: 4,
      impact_months: ["2026-01", "2026-02"],
      conflict_product_count: 1
    });
  });

it("aggregates products across counterparties and keeps empty products visible", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string, transactions: Parameters<typeof repository.saveMonth>[4]) =>
      repository.saveMonth(
        month,
        0,
        [{ account_key: "cash-default", balance: 100 }],
        investment,
        transactions,
        []
      );
    await save("2026-01", [
      {
        transaction_date: "2026-01-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "拿铁", amount: 20
      },
      {
        transaction_date: "2026-01-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户乙", product: "拿铁", amount: 21
      },
      {
        transaction_date: "2026-01-03", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "水果", amount: 10
      },
      {
        transaction_date: "2026-01-04", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户乙", product: "水果", amount: 11
      },
      {
        transaction_date: "2026-01-05", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户丙", product: "", amount: 5
      }
    ]);
    await save("2026-02", [
      {
        transaction_date: "2026-02-01", type: "支出",
        category_key: quality, category: "餐饮改善",
        counterparty: "商户甲", product: "拿铁", amount: 22
      },
      {
        transaction_date: "2026-02-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "水果", amount: 12
      },
      {
        transaction_date: "2026-02-03", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户乙", product: "水果", amount: 13
      }
    ]);
    await repository.createMonth("2026-03");
    const db = manager.connection();
    db.prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category_key,category,counterparty,product,amount)
      VALUES ('2026-03','2026-03-01','支出',?,?,?, ?,?)
    `).run(food, "餐饮基础", "草稿商户", "草稿商品", 1);

    const insights = repository.ruleWorkspaceAnalytics(2);
    const coffee = insights.historical_products.find((row) => row.product === "拿铁");
    const fruit = insights.historical_products.find((row) => row.product === "水果");
    const empty = insights.historical_products.find((row) => row.product_key === "");
    expect(coffee).toMatchObject({
      occurrences: 3,
      counterparty_count: 2,
      has_category_conflict: true
    });
    expect(fruit).toMatchObject({
      occurrences: 4,
      counterparty_count: 2,
      has_category_conflict: false
    });
    expect(empty).toMatchObject({ occurrences: 1, product: "" });
    expect(insights.historical_products.some((row) => row.product === "草稿商品")).toBe(false);
    expect(insights.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: "水果", match_level: "product" })
    ]));
    expect(insights.recommendations.some((row) => row.product === "拿铁")).toBe(false);
    expect(insights.recommendations.some((row) => row.product === "拿铁" && row.match_level === "product")).toBe(false);
  });

it("covers every transaction for a product regardless of counterparty", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户甲",
        product: "咖啡",
        amount: 20
      }, {
        transaction_date: "2026-01-02",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户乙",
        product: "咖啡",
        amount: 22
      }],
      []
    );
    const currentRules = repository.rules();
    await repository.saveRules(currentRules.revision, [{
      transaction_type: "支出",
      counterparty: "商户甲",
      product: "咖啡",
      category_key: food,
      category: "餐饮基础"
    }]);

    const insights = repository.ruleWorkspaceAnalytics(1);
    const coffee = insights.historical_products.find(
      (row) => row.product === "咖啡"
    );
    expect(coffee).toMatchObject({
      rule_coverage: "full",
      matched_occurrences: 2,
      unmatched_occurrences: 0,
      conflicted_occurrences: 0,
      rule_suggestion: undefined
    });
    expect(insights.summary.stable_products_without_rule).toBe(0);
    expect(repository.productHistoryIndex({
      issue_filter: "no-rule"
    }).groups).toEqual([]);
    expect(insights.recommendations.some((row) => row.product === "咖啡")).toBe(false);
  });

it("derives partial-coverage suggestions only from unmatched transactions", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户甲",
        product: "咖啡",
        amount: 20
      }, {
        transaction_date: "2026-01-02",
        type: "支出",
        category_key: quality,
        category: "餐饮改善",
        counterparty: "商户乙",
        product: "咖啡",
        amount: 22
      }],
      []
    );
    const currentRules = repository.rules();
    await repository.saveRules(currentRules.revision, [{
      transaction_type: "支出",
      counterparty: "商户甲",
      product: "咖啡",
      category_key: food,
      category: "餐饮基础"
    }]);

    const insights = repository.ruleWorkspaceAnalytics(1);
    const coffee = insights.historical_products.find(
      (row) => row.product === "咖啡"
    );
    expect(coffee).toMatchObject({
      has_category_conflict: true,
      rule_coverage: "full",
      matched_occurrences: 2,
      unmatched_occurrences: 0,
      rule_suggestion: undefined
    });
    expect(insights.recommendations.some((row) => row.product === "咖啡")).toBe(false);
  });

it("enforces one rule per normalized condition at the database boundary", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户甲",
        product: "拿铁",
        amount: 20
      }, {
        transaction_date: "2026-01-02",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户乙",
        product: "水果",
        amount: 10
      }],
      []
    );
    const db = manager.connection();
    const insert = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    insert.run("支出", "商户甲", "拿铁", food, "餐饮基础");
    expect(() => insert.run("支出", "商户甲", "拿铁", food, "餐饮基础"))
      .toThrow(/UNIQUE constraint failed/);
    expect(() => insert.run("支出", "商户甲", "拿铁", quality, "餐饮改善"))
      .toThrow(/UNIQUE constraint failed/);
    insert.run("支出", "商户乙", "水果", food, "餐饮基础");
    const insights = repository.ruleWorkspaceAnalytics();
    expect(insights.summary).toMatchObject({
      rule_conflict_groups: 0,
      duplicate_rule_groups: 0
    });
    expect(insights.rule_conflicts).toEqual([]);
  });
});
