import { describe, expect, it } from "vitest";
import {
  applyRules,
  applyRulesWithIssues,
  detectRewriteChains,
  findRuleConflicts,
  inferRuleScopeFromConditions,
  RuleMatcher,
  resolveRule,
  rulesEquivalent
} from "../../src/domain/rules";
import type {
  Transaction
} from "../../src/types/transactions";

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
      status: "conflict",
      level: "product",
      rule_ids: [30, 10],
      reason: "商品规则存在重复规则"
    });
    expect(matcher.resolve({ ...row, product: "" })).toMatchObject({
      status: "none",
      rule_ids: []
    });
  });
});

describe("current schema rule scopes", () => {
  const rules = [
    {
      id: 1,
      transaction_type: "支出",
      match_scope: "merchant_product" as const,
      counterparty: "咖啡店",
      product: "拿铁",
      category_key: "cat-combo",
      category: "组合分类",
      rewrite_product: "咖啡"
    },
    {
      id: 2,
      transaction_type: "支出",
      match_scope: "product" as const,
      counterparty: "",
      product: "拿铁",
      category_key: "cat-product",
      category: "商品分类"
    },
    {
      id: 3,
      transaction_type: "支出",
      match_scope: "merchant" as const,
      counterparty: "咖啡店",
      product: "",
      category_key: "cat-merchant",
      category: "交易对手分类"
    }
  ];

  it("derives the scope from the visible matching fields", () => {
    expect(inferRuleScopeFromConditions({ counterparty: "", product: "拿铁" })).toBe("product");
    expect(inferRuleScopeFromConditions({ counterparty: "咖啡店", product: "" })).toBe("merchant");
    expect(inferRuleScopeFromConditions({ counterparty: "咖啡店", product: "拿铁" })).toBe("merchant_product");
    expect(inferRuleScopeFromConditions({ counterparty: "", product: "" })).toBeNull();
  });

  it("uses combination, then product, then merchant precedence", () => {
    expect(resolveRule({
      transaction_date: "2026-01-01",
      type: "支出",
      category: "",
      category_key: null,
      counterparty: "咖啡店",
      product: "拿铁",
      amount: 20
    }, rules)).toMatchObject({
      status: "matched",
      level: "merchant_product",
      selected_rule_id: 1,
      category_key: "cat-combo",
      covered_rule_ids: [2, 3]
    });
  });

  it("applies rewrites once and does not match the rewritten value again", () => {
    const result = applyRules([{
      transaction_date: "2026-01-01",
      type: "支出",
      category: "",
      category_key: null,
      counterparty: "咖啡店",
      product: "拿铁",
      amount: 20
    }], [
      ...rules,
      {
        id: 4,
        transaction_type: "支出",
        match_scope: "product" as const,
        product: "咖啡",
        counterparty: "",
        category_key: "cat-second",
        category: "第二轮分类"
      }
    ]);
    expect(result[0]).toMatchObject({
      product: "咖啡",
      category_key: "cat-combo"
    });
  });

  it("does not apply a rule whose category is inactive", () => {
    const row: Transaction = {
      transaction_date: "2026-01-01",
      type: "支出",
      category: "原分类",
      category_key: null,
      counterparty: "咖啡店",
      product: "拿铁",
      amount: 20
    };
    expect(resolveRule(row, [{ ...rules[1], category_active: false }])).toMatchObject({
      status: "none",
      rule_ids: []
    });
  });

  it("reports duplicate conditions and rewrite chains", () => {
    expect(findRuleConflicts([
      rules[1],
      { ...rules[1], id: 5, category_key: "cat-other", category: "其他分类" }
    ])).toMatchObject([{ kind: "same-condition", rule_ids: [2, 5] }]);
    expect(detectRewriteChains([
      rules[0],
      {
        id: 6,
        transaction_type: "支出",
        match_scope: "product" as const,
        product: "咖啡",
        counterparty: "",
        category_key: "cat-second",
        category: "第二轮分类"
      }
    ])).toMatchObject([{
      rule_id: 1,
      target_rule_ids: [6]
    }]);
  });
});
