import { describe, expect, it } from "vitest";
import { mergeEligibility, previewTransactionMerge, type MergeTransactionsRequest } from "../../src/domain/transactionMerge";
import { RuleMatcher, normalizeRuleDefinition, detectRewriteChains, rulesEquivalent } from "../../src/domain/rules";
import type { SavedRule } from "../../src/types/rules";
import type { Transaction } from "../../src/types/transactions";

const rule: SavedRule = { id: 1, transaction_type: "支出", match_scope: "merchant", counterparty: "平台", product: "",
  category_key: "subscription", category: "订阅服务", match_amount_minor: 1990, rewrite_product: "会员" };
const row = (id: number, overrides: Partial<Transaction> = {}): Transaction => ({ id, transaction_date: "2026-10-15", type: "支出", counterparty: "平台", product: `订单${id}`, category: "旧分类", amount: 19.9, ...overrides });
const request = (rows = [row(1), row(2)]): MergeTransactionsRequest => ({ month: "2026-10", expected_revision: 1,
  group_by: "counterparty", rows, groups: [{ transaction_keys: rows.map((item) => item.id ? `id:${item.id}` : `client:${item.client_id}`) }] });

describe("exact amount rules", () => {
  it("prioritizes exact merchant prices above unrestricted combination rules", () => {
    const fallback: SavedRule = { ...rule, id: 2, match_scope: "merchant_product", product: "订单1", match_amount_minor: null };
    expect(new RuleMatcher([fallback, rule]).resolve(row(1)).selected_rule_id).toBe(1);
    expect(new RuleMatcher([fallback, rule]).resolve(row(1, { amount: 19.91 })).selected_rule_id).toBe(2);
  });
  it("distinguishes unrestricted and zero and rejects invalid minor units", () => {
    const zero = { ...rule, match_amount_minor: 0 };
    expect(new RuleMatcher([zero]).resolve(row(1, { amount: 0 })).status).toBe("matched");
    expect(new RuleMatcher([zero]).resolve(row(1)).status).toBe("none");
    for (const amount of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(normalizeRuleDefinition({ ...rule, match_amount_minor: amount }).value).toBeNull();
    }
    expect(rulesEquivalent(rule, { ...rule, match_amount_minor: 2990 })).toBe(false);
  });
  it("does not invent rewrite chains between different prices", () => {
    const source = { ...rule, match_scope: "product" as const, counterparty: "", product: "原商品", rewrite_product: "会员" };
    const target = { ...source, id: 2, product: "会员", rewrite_product: "", category_key: "other", category: "其他", match_amount_minor: 2990 };
    expect(detectRewriteChains([source, target])).toEqual([]);
    expect(detectRewriteChains([source, { ...target, match_amount_minor: 1990 }])[0].category_conflict).toBe(true);
  });
});

describe("actual transaction merge", () => {
  it("excludes tagged rows by default and preserves all tag totals when opted in", () => {
    const rows = [row(1), row(2), row(3, { tag_keys: ["a"] }), row(4, { tag_keys: ["a"] }),
      row(5, { tag_keys: ["a", "b"] }), row(6, { tag_keys: ["b", "a"] }), row(7, { tag_keys: ["b"] })];
    const totals = (values: Transaction[]) => ["a", "b"].map((key) => Math.round(values.filter((value) => value.tag_keys?.includes(key)).reduce((sum, value) => sum + value.amount, 0) * 100));
    const ordinary = previewTransactionMerge(request(rows));
    expect(ordinary.groups).toHaveLength(1); expect(ordinary.excluded_tagged_count).toBe(5);
    expect(ordinary.rows.slice(1)).toEqual(rows.slice(2));
    const tagged = previewTransactionMerge({ ...request(rows), include_tagged: true });
    expect(tagged.groups).toHaveLength(3); expect(tagged.rows).toHaveLength(4);
    expect(tagged.groups.map((group) => group.after.tag_keys)).toEqual([[], ["a"], ["a", "b"]]);
    expect(tagged.rows.at(-1)).toEqual(rows.at(-1)); expect(totals(tagged.rows)).toEqual(totals(rows));
  });

  it("keeps the summary name and identical secondary names, and explicitly clears differing secondary names", () => {
    const different = previewTransactionMerge(request());
    expect(different.groups).toHaveLength(1);
    expect(different.groups[0]).toMatchObject({ cleared_fields: ["product"], after: { product: "", counterparty: "平台", category: "旧分类", amount: 39.8 } });
    const sameRows = [row(1, { product: "原始名称" }), row(2, { product: "原始名称" })];
    const same = previewTransactionMerge(request(sameRows));
    expect(same.groups[0]).toMatchObject({ cleared_fields: [], after: { product: "原始名称", counterparty: "平台", amount: 39.8 } });
    const byProduct = previewTransactionMerge({ ...request(sameRows.map((value, index) => ({ ...value, counterparty: `平台${index}` }))), group_by: "product" });
    expect(byProduct.groups[0]).toMatchObject({ cleared_fields: ["counterparty"], after: { product: "原始名称", counterparty: "" } });
  });
  it("creates one new first-day row for a complete tag set and preserves unselected rows", () => {
    const a = row(1, { tag_keys: ["a", "b"] }); const b = row(2, { tag_keys: ["b", "a"] }); const untouched = row(3, { amount: 77 });
    const req = request([a, b, untouched]); req.groups[0].transaction_keys = ["id:1", "id:2"];
    req.include_tagged = true;
    const result = previewTransactionMerge(req);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ transaction_date: "2026-10-01", amount: 39.8, product: "", counterparty: "平台", category: "旧分类", tag_keys: ["a", "b"] });
    expect(result.rows[0].id).toBeUndefined(); expect(result.rows[0].client_id).toBeTruthy();
    expect(result.rows[1]).toEqual(untouched); expect(req.rows).toHaveLength(3);
  });
  it("merges the four screenshot amounts without requiring rules or equal prices", () => {
    const rows = [1.12, 0.33, 0.30, 0.29].map((amount, index) => row(index + 1, { amount,
      counterparty: "杭州企鹅科技有限公司", product: "喝水", category: "餐饮基础", transaction_date: `2026-10-${[29, 16, 12, 4][index].toString().padStart(2, "0")}` }));
    expect(mergeEligibility(rows, "2026-10").reason).toBeNull();
    const result = previewTransactionMerge(request(rows));
    expect(result.groups[0].after).toMatchObject({ amount: 2.04, product: "喝水", counterparty: "杭州企鹅科技有限公司", category: "餐饮基础" });
    expect(result.preview.rule_ids).toEqual([]);
    expect(result.preview.metadata).not.toHaveProperty("rules_revision");
  });
  it("preserves category totals, uncategorized rows and all tag totals across independent partitions", () => {
    const rows = [row(1), row(2), row(3, { category: "另一分类", category_key: "other" }), row(4, { category: "另一分类", category_key: "other" }),
      row(5, { category: "", category_key: null }), row(6, { category: "", category_key: null }),
      row(7, { tag_keys: ["a"] }), row(8, { tag_keys: ["a"] }), row(9, { tag_keys: ["a", "b"] })];
    const result = previewTransactionMerge({ ...request(rows), include_tagged: true });
    expect(result.groups).toHaveLength(4); expect(result.unchanged_count).toBe(1);
    const totals = (values: Transaction[], predicate: (value: Transaction) => boolean) => Math.round(values.filter(predicate).reduce((sum, value) => sum + value.amount, 0) * 100);
    for (const category of ["旧分类", "另一分类", ""]) {
      expect(totals(result.rows, (value) => value.category === category)).toBe(totals(rows, (value) => value.category === category));
    }
    for (const tag of ["a", "b"]) {
      expect(totals(result.rows, (value) => !!value.tag_keys?.includes(tag))).toBe(totals(rows, (value) => !!value.tag_keys?.includes(tag)));
    }
    expect(result.rows.at(-1)).toEqual(rows.at(-1));
  });
  it("allows opening an all-tagged group and can merge a previous total again", () => {
    const tagged = [row(1, { tag_keys: ["a"] }), row(2, { tag_keys: ["a"] })];
    expect(mergeEligibility(tagged, "2026-10").reason).toBeNull();
    expect(previewTransactionMerge(request(tagged)).groups).toHaveLength(0);
    const first = previewTransactionMerge(request());
    const result = previewTransactionMerge(request([...first.rows, row(3, { amount: 0.2 })]));
    expect(result.rows).toHaveLength(1); expect(result.rows[0].amount).toBe(40);
    expect(mergeEligibility(result.rows, "2026-10").reason).toBe("single");
  });
  it("keeps selected groups separate and supports new draft identities", () => {
    const rows = [row(1), row(2), row(3, { id: undefined, client_id: "a" }), row(4, { id: undefined, client_id: "b" })];
    const req = request(rows); req.groups = [{ transaction_keys: ["id:1", "id:2"] }, { transaction_keys: ["client:a", "client:b"] }];
    const result = previewTransactionMerge(req);
    expect(result.rows).toHaveLength(2); expect(result.rows.map((item) => item.amount)).toEqual([39.8, 39.8]);
  });
  it("rejects singleton, mixed month/type, investments, invalid amounts and overlapping groups", () => {
    for (const rows of [[row(1)], [row(1), row(2, { transaction_date: "2026-09-30" })], [row(1), row(2, { type: "收入" })],
      [row(1, { type: "加仓" }), row(2, { type: "加仓" })], [row(1), row(2, { amount: -1 })], [row(1), row(2, { amount: Infinity })],
      [row(1, { amount: 90_000_000_000_000 }), row(2, { amount: 90_000_000_000_000 })]]) {
      expect(() => previewTransactionMerge(request(rows))).toThrow();
    }
    const overlap = request(); overlap.groups.push(overlap.groups[0]);
    expect(() => previewTransactionMerge(overlap)).toThrow();
    expect(() => previewTransactionMerge(request([row(1), row(1)]))).toThrow();
    expect(() => previewTransactionMerge(request([row(1), row(2, { id: undefined, client_id: "" })]))).toThrow();
  });
  it("enforces the actual summary identity and supports the same normalized variants as the view", () => {
    expect(() => previewTransactionMerge(request([row(1), row(2, { counterparty: "别的平台" })]))).toThrow();
    expect(() => previewTransactionMerge({ ...request(), group_by: "product" })).toThrow();
    const result = previewTransactionMerge(request([row(1, { counterparty: "Ａ平台 · 店铺" }), row(2, { counterparty: "a平台店铺" })]));
    expect(result.rows[0].counterparty).toBe("Ａ平台 · 店铺");
  });
  it.each(["收入", "代付"])("supports %s without requiring rules", (type) => {
    const result = previewTransactionMerge(request([row(1, { type, amount: 0 }), row(2, { type, amount: 0.1 })]));
    expect(result.rows[0]).toMatchObject({ type, amount: 0.1 });
  });
});
