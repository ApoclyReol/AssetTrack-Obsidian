import { describe, expect, it } from "vitest";
import {
  applyRules,
  applyRulesWithIssues,
  RuleMatcher,
  resolveRule,
  rulesEquivalent,
  rulesOverlap
} from "../../src/domain/rules";
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

  it("keeps a row unchanged when the highest matching level conflicts", () => {
    const row: Transaction = {
      id: 17,
      transaction_date: "2026-01-01",
      type: "支出",
      category: "原分类",
      category_key: "cat-old",
      counterparty: "商户甲",
      product: "咖啡",
      amount: 20
    };
    const rules = [
      {
        id: 1,
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "咖啡",
        category_key: "cat-food",
        category: "餐饮基础"
      },
      {
        id: 2,
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "咖啡",
        category_key: "cat-quality",
        category: "餐饮改善"
      }
    ];
    expect(resolveRule(row, rules)).toMatchObject({
      status: "conflict",
      level: "exact",
      rule_ids: [1, 2]
    });
    const result = applyRulesWithIssues([row], rules);
    expect(result.proposed_rows[0]).toEqual(row);
    expect(result.issues).toEqual([
      expect.objectContaining({ row_index: 0, row_id: 17, rule_ids: [1, 2] })
    ]);
    expect(applyRules([row], rules)[0]).toEqual(row);
  });

  it("prefers a product rule over a counterparty rule", () => {
    const row: Transaction = {
      transaction_date: "2026-01-01",
      type: "支出",
      category: "原分类",
      category_key: null,
      counterparty: "商户甲",
      product: "咖啡",
      amount: 20
    };
    expect(resolveRule(row, [
      {
        id: 3,
        transaction_type: "支出",
        counterparty: "",
        product: "咖啡",
        category_key: "cat-food",
        category: "餐饮基础"
      },
      {
        id: 4,
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "",
        category_key: "cat-quality",
        category: "餐饮改善"
      }
    ])).toMatchObject({
      status: "matched",
      level: "product",
      category_key: "cat-food",
      rule_ids: [3]
    });
  });

  it("indexes candidates without changing source order or wildcard behavior", () => {
    const rules = [
      {
        id: 30,
        transaction_type: "支出",
        counterparty: "",
        product: "咖啡",
        category_key: "cat-food",
        category: "餐饮基础"
      },
      {
        id: 10,
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "咖啡",
        category_key: "cat-quality",
        category: "餐饮改善"
      },
      {
        id: 11,
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "咖啡",
        category_key: "cat-quality",
        category: "餐饮改善"
      },
      {
        id: 20,
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "",
        category_key: "cat-other",
        category: "其他支出"
      },
      {
        id: 99,
        transaction_type: "支出",
        counterparty: "",
        product: "",
        category_key: "cat-all",
        category: "兜底"
      }
    ];
    const matcher = new RuleMatcher(rules);
    const row: Transaction = {
      transaction_date: "2026-01-01",
      type: "支出",
      category: "原分类",
      category_key: null,
      counterparty: "商户甲",
      product: "咖啡",
      amount: 20
    };
    expect(matcher.matchingRules(row).map((rule) => rule.id)).toEqual([30, 10, 11, 20, 99]);
    expect(matcher.resolve(row)).toMatchObject({
      status: "matched",
      level: "exact",
      rule_ids: [10, 11],
      category_key: "cat-quality"
    });
    expect(matcher.resolve({ ...row, counterparty: "", product: "" })).toMatchObject({
      status: "none",
      rule_ids: []
    });
  });
});
