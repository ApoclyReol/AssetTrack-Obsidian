import { describe, expect, it } from "vitest";
import { EMPTY_RULE_AMOUNT, matchesRuleAmount, ruleAmountBounds } from "../../src/domain/ruleAmounts";
import { detectRewriteChains, findRuleConflicts, normalizeRuleDefinition, RuleMatcher, rulesEquivalent } from "../../src/domain/rules";
import type { RuleAmountFields, SavedRule } from "../../src/types/rules";

const base: SavedRule = { id: 1, transaction_type: "支出", match_scope: "merchant", counterparty: "平台", product: "", category_key: "food", category: "餐饮" };
const transaction = (amount: number) => ({ transaction_date: "2026-10-01", type: "支出", counterparty: "平台", product: "订单", category: "", amount });

describe("amount range endpoints", () => {
  it.each<[RuleAmountFields, number[], number[]]>([
    [{ match_amount_max_minor: 200, match_amount_max_exclusive: true }, [0, 1.99], [2, 2.01]],
    [{ match_amount_max_minor: 200 }, [0, 1.99, 2], [2.01]],
    [{ match_amount_min_minor: 10000 }, [100, 100.01, 200], [99.99]],
    [{ match_amount_min_minor: 10000, match_amount_min_exclusive: true }, [100.01, 200], [99.99, 100]],
    [{ match_amount_min_minor: 200, match_amount_max_minor: 5000 }, [2, 2.01, 49.99, 50], [1.99, 50.01]],
    [{ match_amount_min_minor: 200, match_amount_max_minor: 5000, match_amount_min_exclusive: true, match_amount_max_exclusive: true }, [2.01, 49.99], [2, 50]],
    [{ match_amount_minor: 0 }, [0], [0.01]],
    [{}, [0, 2, 10000], []]
  ])("matches inclusive/open and unbounded intervals %j", (fields, accepted, rejected) => {
    accepted.forEach((amount) => expect(matchesRuleAmount(fields, amount)).toBe(true));
    rejected.forEach((amount) => expect(matchesRuleAmount(fields, amount)).toBe(false));
  });
  it("uses canonical cents and rejects empty, reversed or malformed intervals", () => {
    expect(ruleAmountBounds({ match_amount_max_minor: 200, match_amount_max_exclusive: true })).toEqual({ min: 0, max: 199 });
    expect(matchesRuleAmount({ match_amount_max_minor: 200, match_amount_max_exclusive: true }, 1.995)).toBe(false);
    for (const fields of [
      { match_amount_min_minor: 300, match_amount_max_minor: 200 },
      { match_amount_min_minor: 200, match_amount_max_minor: 200, match_amount_min_exclusive: true },
      { match_amount_max_minor: 0, match_amount_max_exclusive: true },
      { match_amount_min_minor: -1 }, { match_amount_max_minor: NaN },
      { match_amount_min_minor: 1.5 }, { match_amount_min_minor: Number.MAX_SAFE_INTEGER, match_amount_min_exclusive: true },
      { match_amount_minor: 200, match_amount_max_minor: 300 }, { match_amount_min_exclusive: true }
    ]) {
      expect(ruleAmountBounds(fields)).toBeNull();
      expect(normalizeRuleDefinition({ ...base, ...fields }).value).toBeNull();
    }
  });
});

describe("range priorities and overlap governance", () => {
  it("chooses exact above range above unrestricted, retaining scope order within each tier", () => {
    const range = { ...base, match_amount_min_minor: 200, match_amount_max_minor: 5000 };
    const exact = { ...base, id: 2, match_amount_minor: 1990 };
    const fallback = { ...base, id: 3, match_scope: "merchant_product" as const, product: "订单" };
    const matcher = new RuleMatcher([fallback, range, exact]);
    expect(matcher.resolve(transaction(19.9)).selected_rule_id).toBe(2);
    expect(matcher.resolve(transaction(20)).selected_rule_id).toBe(1);
    expect(matcher.resolve(transaction(60)).selected_rule_id).toBe(3);
  });
  it("supports the requested bands and leaves the 50–100 gap unmatched", () => {
    const rules = [
      { ...base, match_amount_max_minor: 200, match_amount_max_exclusive: true },
      { ...base, id: 2, match_amount_min_minor: 200, match_amount_max_minor: 5000 },
      { ...base, id: 3, match_amount_min_minor: 10000 }
    ];
    const matcher = new RuleMatcher(rules);
    expect(findRuleConflicts(rules)).toEqual([]);
    expect([1.99, 2, 50, 50.01, 99.99, 100].map((value) => matcher.resolve(transaction(value)).selected_rule_id ?? null)).toEqual([1, 2, 2, null, null, 3]);
  });
  it("rejects even a one-cent intersection and allows exact exceptions", () => {
    const low = { ...base, match_amount_max_minor: 200 };
    const high = { ...base, id: 2, match_amount_min_minor: 200 };
    expect(findRuleConflicts([low, high])[0].kind).toBe("amount-overlap");
    expect(new RuleMatcher([low, high]).resolve(transaction(2)).status).toBe("conflict");
    expect(findRuleConflicts([low, { ...base, id: 3, match_amount_minor: 100 }])).toEqual([]);
    expect(findRuleConflicts([low, { ...high, counterparty: "其他平台" }])).toEqual([]);
  });
  it("treats equivalent interval notation as the same condition", () => {
    expect(rulesEquivalent({ ...base, match_amount_max_minor: 200, match_amount_max_exclusive: true }, { ...base, match_amount_max_minor: 199 })).toBe(true);
    expect(rulesEquivalent({ ...base, match_amount_minor: 200 }, { ...base, match_amount_min_minor: 200, match_amount_max_minor: 200 })).toBe(true);
    expect(rulesEquivalent(base, { ...base, match_amount_min_minor: 0 })).toBe(true);
  });
  it("detects rewrite conflicts only where the amount intervals intersect", () => {
    const source = { ...base, match_scope: "product" as const, counterparty: "", product: "旧", rewrite_product: "新", match_amount_max_minor: 200, match_amount_max_exclusive: true };
    const target = { ...source, id: 2, product: "新", rewrite_product: "", category: "其他", category_key: "other", ...EMPTY_RULE_AMOUNT, match_amount_min_minor: 200 };
    expect(detectRewriteChains([source, target])).toEqual([]);
    expect(detectRewriteChains([source, { ...target, match_amount_min_minor: 199 }])[0].category_conflict).toBe(true);
  });
});
