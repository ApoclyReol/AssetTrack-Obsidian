import { describe, expect, it } from "vitest";
import { buildAnnualRows, calculateMonthly } from "../../src/domain/calculator";

describe("monthly calculation category ownership", () => {
  it("uses the category key when the display name in a draft is stale", () => {
    const result = calculateMonthly([
      {
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: "cat-food",
        category: "旧分类名称",
        product: "午餐",
        amount: 100
      }
    ], [{
      category_key: "cat-food",
      name: "餐饮基础",
      transaction_type: "支出",
      necessity: "必要",
      pattern: "日常",
      is_big_ticket: false,
      color: "#fff",
      is_active: true,
      sort_order: 0
    }]);

    expect(result.category_summary).toEqual({ "餐饮基础": 100 });
    expect(result.structure).toMatchObject({ necessary: 100, daily: 100 });
  });
});

describe("annual investment performance", () => {
  it("does not count the previous month's deposit as profit delta", () => {
    const monthly = (deposit: number, withdraw: number) => ({
      category_summary: {},
      all_out: 0,
      total_daifu: 0,
      total_expense: 0,
      total_income: 0,
      total_deposit: deposit,
      total_withdraw: withdraw,
      structure: {
        necessary: 0,
        controlled: 0,
        periodic: 0,
        daily: 0,
        occasional: 0
      },
      big_tickets: []
    });
    const rows = buildAnnualRows([
      {
        month: "2026-01",
        cash: 1000,
        debt: 0,
        principal: 150,
        market_value: 170,
        investment_cash: 0,
        monthly: monthly(50, 0)
      },
      {
        month: "2026-02",
        cash: 1000,
        debt: 0,
        principal: 170,
        market_value: 200,
        investment_cash: 0,
        monthly: monthly(0, 0)
      }
    ]);
    expect(rows[0].inv_profit).toBe(20);
    expect(rows[1].inv_profit).toBe(30);
    expect(rows[1].inv_profit_delta).toBe(10);
  });
});
