import { describe, expect, it } from "vitest";
import { applyRules, rulesEquivalent, rulesOverlap } from "../../src/domain/rules";
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

  it("recognizes normalized duplicates and broad-vs-specific conflicts", () => {
    const exact = {
      transaction_type: "支出",
      counterparty: " 商户甲 ",
      product: "咖啡",
      category_key: "cat-food",
      category: "餐饮基础"
    };
    const same = {
      ...exact,
      counterparty: "商户甲",
      product: " 咖啡 "
    };
    const broad = {
      ...exact,
      product: "",
      category_key: "cat-quality",
      category: "餐饮改善"
    };
    expect(rulesEquivalent(exact, same)).toBe(true);
    expect(rulesOverlap(exact, broad)).toBe(true);
    expect(rulesOverlap(exact, {
      ...exact,
      transaction_type: "收入"
    })).toBe(false);
  });
});
