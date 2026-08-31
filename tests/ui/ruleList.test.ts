import { describe, expect, it } from "vitest";
import type { SavedRule } from "../../src/types/rules";
import {
  matchesRule,
  ruleGroupKey,
  ruleListStatus,
  ruleScope,
  ruleSortValue,
  type RuleListFilters
} from "../../src/ui/rules/ruleListModel";

function rule(overrides: Partial<SavedRule> = {}): SavedRule {
  return {
    id: 1,
    transaction_type: "支出",
    match_scope: "merchant_product",
    counterparty: "商户甲",
    product: "咖啡",
    category_key: "food",
    category: "餐饮",
    rewrite_merchant: "",
    rewrite_product: "",
    ...overrides
  };
}

const emptyFilters: RuleListFilters = {
  query: "",
  transactionType: "",
  status: "",
  scope: "",
  categoryKey: ""
};

describe("rule list model", () => {
  it("filters rules across conditions, rewrites, type, scope and category", () => {
    expect(matchesRule(rule({ rewrite_product: "咖啡饮品" }), {
      ...emptyFilters,
      query: "饮品"
    })).toBe(true);
    expect(matchesRule(rule(), {
      ...emptyFilters,
      transactionType: "收入"
    })).toBe(false);
    expect(matchesRule(rule({ match_scope: "product" }), {
      ...emptyFilters,
      scope: "merchant_product"
    })).toBe(false);
    expect(matchesRule(rule(), {
      ...emptyFilters,
      categoryKey: "transport"
    })).toBe(false);
    expect(matchesRule(rule({ category: "交通" }), {
      ...emptyFilters,
      query: "交通"
    })).toBe(true);
  });

  it("derives visible statuses with conflicts taking precedence over inactive categories", () => {
    expect(ruleListStatus(rule())).toBe("正常");
    expect(ruleListStatus(rule({ category_active: false }))).toBe("分类已停用");
    expect(ruleListStatus(rule({ rule_status: "重复" }))).toBe("重复");
    expect(ruleListStatus(rule({ rule_status: "冲突", category_active: false }))).toBe("冲突");
  });

  it("sorts problem states and specific scopes before ordinary broad rules", () => {
    expect([
      ruleSortValue(rule({ rule_status: undefined }), "status"),
      ruleSortValue(rule({ rule_status: "重复" }), "status"),
      ruleSortValue(rule({ rule_status: "冲突" }), "status")
    ]).toEqual([3, 1, 0]);
    expect([
      ruleSortValue(rule({ match_scope: "merchant" }), "match_scope"),
      ruleSortValue(rule({ match_scope: "product" }), "match_scope"),
      ruleSortValue(rule({ match_scope: "merchant_product" }), "match_scope")
    ]).toEqual([2, 1, 0]);
    expect(ruleSortValue(rule({ last_month: "2026-08" }), "last_used_date")).toBe("2026-08");
    expect(ruleSortValue(rule({ last_used_date: "2026-08-20", last_month: "2026-08" }), "last_used_date")).toBe("2026-08-20");
  });

  it("groups by the same visible management dimensions used by the toolbar", () => {
    expect(ruleScope(rule())).toBe("merchant_product");
    expect(ruleGroupKey(rule({ rule_status: "冲突" }), "status")).toBe("冲突");
    expect(ruleGroupKey(rule({ transaction_type: "收入" }), "transaction_type")).toBe("收入");
    expect(ruleGroupKey(rule({ match_scope: "product" }), "match_scope")).toBe("product");
    expect(ruleGroupKey(rule({ category_key: "food" }), "category")).toBe("food");
  });
});
