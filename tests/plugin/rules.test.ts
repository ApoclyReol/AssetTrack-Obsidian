import { describe, expect, it } from "vitest";
import {
  applyRules,
  applyRulesWithIssues,
  RuleMatcher,
  resolveRule,
  rulesEquivalent
} from "../../src/domain/rules";
import type { Transaction } from "../../src/types";

describe("product-only matching rules", () => {
  it("matches by product and ignores transaction counterparties", () => {
    const row: Transaction = {
      transaction_date: "2026-01-01",
      type: "支出",
      category: "",
      category_key: null,
      counterparty: "另一家商户",
      product: "拿铁",
      amount: 20
    };
    expect(resolveRule(row, [
      {
        id: 1,
        transaction_type: "支出",
        counterparty: "示例咖啡店",
        product: "拿铁",
        category_key: "cat-food",
        category: "餐饮基础"
      },
      {
        id: 2,
        transaction_type: "支出",
        counterparty: "示例咖啡店",
        product: "",
        category_key: "cat-quality",
        category: "餐饮改善"
      }
    ])).toMatchObject({
      status: "matched",
      level: "product",
      category_key: "cat-food",
      rule_ids: [1]
    });
  });

  it("treats the same type and product as the same rule condition", () => {
    const left = {
      transaction_type: "支出",
      counterparty: "商户甲",
      product: " 咖啡 ",
      category_key: "cat-food",
      category: "餐饮基础"
    };
    const right = {
      ...left,
      counterparty: "商户乙",
      product: "咖啡"
    };
    expect(rulesEquivalent(left, right)).toBe(true);
    expect(rulesEquivalent(left, { ...left, transaction_type: "收入" })).toBe(false);
    expect(rulesEquivalent(left, { ...left, product: "" })).toBe(false);
  });

  it("leaves a transaction unchanged when product rules map to different categories", () => {
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
        counterparty: "商户乙",
        product: "咖啡",
        category_key: "cat-quality",
        category: "餐饮改善"
      }
    ];
    expect(resolveRule(row, rules)).toMatchObject({
      status: "conflict",
      level: "product",
      rule_ids: [1, 2]
    });
    const result = applyRulesWithIssues([row], rules);
    expect(result.proposed_rows[0]).toEqual(row);
    expect(result.issues).toEqual([
      expect.objectContaining({ row_index: 0, row_id: 17, rule_ids: [1, 2] })
    ]);
    expect(applyRules([row], rules)[0]).toEqual(row);
  });

  it("keeps source order for same-product rules and ignores blank-product rules", () => {
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
        category_key: "cat-food",
        category: "餐饮基础"
      },
      {
        id: 20,
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "",
        category_key: "cat-other",
        category: "其他支出"
      }
    ];
    const matcher = new RuleMatcher(rules);
    const row: Transaction = {
      transaction_date: "2026-01-01",
      type: "支出",
      category: "原分类",
      category_key: null,
      counterparty: "不相关商户",
      product: "咖啡",
      amount: 20
    };
    expect(matcher.matchingRules(row).map((rule) => rule.id)).toEqual([30, 10]);
    expect(matcher.resolve(row)).toMatchObject({
      status: "matched",
      level: "product",
      rule_ids: [30, 10],
      category_key: "cat-food"
    });
    expect(matcher.resolve({ ...row, product: "" })).toMatchObject({
      status: "none",
      rule_ids: []
    });
  });
});
