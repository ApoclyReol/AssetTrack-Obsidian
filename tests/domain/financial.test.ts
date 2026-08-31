import { describe, expect, it } from "vitest";
import { buildAnnualRows, calculateMonthly } from "../../src/domain/calculator";
import { roundHalfEven } from "../../src/domain/money";
import {
  formatMoney,
  isCurrencyCode,
  signedMoneyValue
} from "../../src/domain/moneyFormat";
import {
  createDateReadWindow,
  createMonthReadWindow,
  recentMonthReadWindow,
  sampleMonths
} from "../../src/domain/readWindows";

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

describe("money rounding and formatting", () => {
  it("uses half-even at exact ties", () => {
    expect(roundHalfEven(2.5, 0)).toBe(2);
    expect(roundHalfEven(3.5, 0)).toBe(4);
    expect(roundHalfEven(20.126, 2)).toBe(20.13);
  });

  it("uses Intl currency and semantic transaction signs", () => {
    const options = {
      locale: "en" as const,
      currency: "USD",
      currencyFormat: "standard" as const
    };
    expect(formatMoney(12, options)).toBe("$12.0");
    expect(formatMoney(12.34, options, "收入")).toBe("$12.3");
    expect(formatMoney(12.34, options, "支出")).toBe("-$12.3");
    expect(formatMoney(-0.04, options)).toBe("$0.0");
    expect(signedMoneyValue(12, "提现")).toBe(12);
    expect(signedMoneyValue(12, "加仓")).toBe(-12);
  });

  it("validates ISO-style currency codes through Intl", () => {
    expect(isCurrencyCode("CNY")).toBe(true);
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("yuan")).toBe(false);
  });
});

describe("read windows", () => {
  it("builds inclusive monthly and date windows", () => {
    expect(createMonthReadWindow("analysis", "2025-04", "2026-03")).toEqual({
      kind: "analysis",
      from_month: "2025-04",
      to_month: "2026-03",
      from_date: "2025-04-01",
      to_date: "2026-03-31",
      month_count: 12
    });
    expect(createDateReadWindow("analysis", "2025-04-03", "2026-03-28")).toEqual({
      kind: "analysis",
      from_month: "2025-04",
      to_month: "2026-03",
      from_date: "2025-04-03",
      to_date: "2026-03-28",
      month_count: 12
    });
    expect(recentMonthReadWindow("system-check", "2026-03", 60)).toMatchObject({
      from_month: "2021-04",
      to_month: "2026-03",
      month_count: 60
    });
  });

  it("samples annual trend months while preserving the endpoints", () => {
    const months = Array.from({ length: 120 }, (_, index) =>
      `${2017 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`
    );
    const sampled = sampleMonths(months);
    expect(sampled).toHaveLength(18);
    expect(sampled[0]).toBe("2017-01");
    expect(sampled.at(-1)).toBe("2026-12");
    expect(new Set(sampled).size).toBe(sampled.length);
  });
});
