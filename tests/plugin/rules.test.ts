import { describe, expect, it } from "vitest";
import { applyRules } from "../../src/domain/rules";
import type { Transaction } from "../../src/types";

describe("counterparty and product rules", () => {
  it("prefers a two-field rule over a broader product rule", () => {
    const row: Transaction = {
      transaction_date: "2026-01-01",
      type: "支出",
      category: "",
      category_key: null,
      counterparty: "示例咖啡店",
      product: "拿铁",
      amount: 20
    };
    const [result] = applyRules([row], [
      {
        transaction_type: "支出",
        counterparty: "",
        product: "拿铁",
        category_key: "cat-food",
        category: "餐饮基础"
      },
      {
        transaction_type: "支出",
        counterparty: "示例咖啡店",
        product: "拿铁",
        category_key: "cat-quality",
        category: "餐饮改善"
      }
    ]);
    expect(result.category).toBe("餐饮改善");
  });
});
