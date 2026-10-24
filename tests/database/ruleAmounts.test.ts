import { describe, expect, it } from "vitest";
import { fixture } from "./databaseTestFixtures";
import { categoryKey } from "../../src/database/schema";
import { EMPTY_RULE_AMOUNT } from "../../src/domain/ruleAmounts";
import { previewTransactionMerge } from "../../src/domain/transactionMerge";
import type { SavedRule } from "../../src/types/rules";

const base: SavedRule = {
  ...EMPTY_RULE_AMOUNT, transaction_type: "支出", match_scope: "merchant", counterparty: "平台", product: "",
  category_key: categoryKey("订阅服务"), category: "订阅服务", rewrite_product: "会员"
};

async function monthWithPrices(prices: number[]) {
  const fixtureData = fixture();
  const month = await fixtureData.repository.saveMonth("2026-10", 0,
    [{ account_key: "cash-default", balance: 100 }],
    [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
    prices.map((amount, index) => ({ transaction_date: "2026-10-10", type: "支出", counterparty: "平台", product: `订单${index}`, amount,
      category_key: categoryKey("订阅服务"), category: "订阅服务" })), []);
  return { ...fixtureData, month };
}

describe("amount range persistence and read models", () => {
  it("persists the blank-rewrite policy and applies it consistently in repository previews", async () => {
    const { repository, month, manager } = await monthWithPrices([2, 3]);
    const saved = await repository.saveRules(repository.rules().revision, [{ ...base, rewrite_merchant: "", rewrite_product: "", rewrite_empty_mode: "clear" }]);
    manager.close(); manager.open();
    expect(repository.ruleWorkspaceShell().rules[0].rewrite_empty_mode).toBe("clear");
    expect(repository.rulesPreview(month.month, month.transactions).proposed_rows.every((row) => row.product === "" && row.counterparty === "")).toBe(true);
    const preserved = await repository.saveRules(saved.revision, [{ ...saved.rows[0], rewrite_empty_mode: "preserve" }]);
    expect(repository.rulesPreview(month.month, month.transactions).proposed_rows.map((row) => row.product)).toEqual(["订单0", "订单1"]);
    await expect(repository.saveRules(preserved.revision, [{ ...preserved.rows[0], rewrite_empty_mode: "invalid" }]))
      .rejects.toMatchObject({ code: "rule.definition_invalid" });
    expect(repository.ruleWorkspaceShell().rules[0].rewrite_empty_mode).toBe("preserve");
  });
  it("rejects malformed endpoint flags before they can be coerced into booleans", async () => {
    const { repository } = fixture();
    const revision = repository.rules().revision;
    for (const flag of [2, "false"]) {
      await expect(repository.saveRules(revision, [{ ...base, match_amount_min_minor: 200, match_amount_min_exclusive: flag }]))
        .rejects.toMatchObject({ code: "rule.definition_invalid" });
    }
    expect(repository.rules().rows).toHaveLength(0);
  });
  it("preserves three bands, their endpoint coverage, and gaps in all previews", async () => {
    const { repository, month, manager } = await monthWithPrices([1.99, 2, 50, 50.01, 99.99, 100]);
    const definitions = [
      { ...base, match_amount_max_minor: 200, match_amount_max_exclusive: true, rewrite_product: "小额" },
      { ...base, match_amount_min_minor: 200, match_amount_max_minor: 5000, rewrite_product: "常规" },
      { ...base, match_amount_min_minor: 10000, rewrite_product: "大额" }
    ];
    const saved = await repository.saveRules(repository.rules().revision, definitions);
    expect(saved.rows.map((row) => row.occurrences)).toEqual([1, 2, 1]);
    expect(repository.ruleImpactPreview({ ...definitions[1], id: Number(saved.rows[1].id) })).toMatchObject({ transaction_count: 2, higher_priority_rule_count: 0 });
    manager.close(); manager.open();
    const shell = repository.ruleWorkspaceShell();
    expect(shell.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ match_amount_max_minor: 200, match_amount_max_exclusive: true }),
      expect.objectContaining({ match_amount_min_minor: 200, match_amount_max_minor: 5000 }),
      expect.objectContaining({ match_amount_min_minor: 10000, match_amount_max_minor: null })
    ]));
    expect(repository.rulesPreview(month.month, month.transactions).proposed_rows.map((row) => row.product))
      .toEqual(["小额", "常规", "常规", "订单3", "订单4", "大额"]);
  });

  it("rejects a shared cent atomically while accepting an exact exception", async () => {
    const { repository, month } = await monthWithPrices([2, 3, 50]);
    const range = { ...base, match_amount_min_minor: 200, match_amount_max_minor: 5000 };
    const saved = await repository.saveRules(repository.rules().revision, [range]);
    await expect(repository.saveRules(saved.revision, [...saved.rows, { ...base, match_amount_min_minor: 5000 }]))
      .rejects.toMatchObject({ code: "rule.conflict", params: { conflict_kind: "amount-overlap", overlap_min_minor: 5000, overlap_max_minor: 5000, rule_rows: [1, 2] } });
    expect(repository.rules().revision).toBe(saved.revision);
    const exact = { ...base, match_amount_minor: 200, rewrite_product: "特殊价格" };
    await repository.saveRules(saved.revision, [...saved.rows, exact]);
    expect(repository.rulesPreview(month.month, month.transactions).proposed_rows.map((row) => row.product)).toEqual(["特殊价格", "会员", "会员"]);
    expect(repository.ruleImpactPreview({ ...range, id: Number(saved.rows[0].id) })).toMatchObject({ transaction_count: 3, higher_priority_rule_count: 1 });
  });

  it("enforces canonical uniqueness and rejects malformed ranges in SQLite", () => {
    const { manager } = fixture();
    const db = manager.open();
    const insert = db.prepare(`INSERT INTO auto_rules(transaction_type,match_scope,counterparty,category_key,category,
      match_amount_minor,match_amount_min_minor,match_amount_max_minor,match_amount_min_exclusive,match_amount_max_exclusive)
      VALUES ('支出','merchant','平台',?,'订阅服务',?,?,?,?,?)`);
    const run = (exact: number | null, min: number | null, max: number | null, openMin = 0, openMax = 0) =>
      insert.run(base.category_key, exact, min, max, openMin, openMax);
    run(null, null, 200, 0, 1);
    expect(() => run(null, null, 199)).toThrow();
    expect(() => run(199, null, 200)).toThrow();
    expect(() => run(null, 200, 200, 1)).toThrow();
    expect(() => run(null, 200, 100)).toThrow();
    expect(() => run(null, null, 200, 1)).toThrow();
    expect(() => run(null, 2.5, 200)).toThrow();
    expect(() => run(null, Number.MAX_SAFE_INTEGER, null, 1)).toThrow();
    run(null, 200, 200);
    expect(() => run(200, null, null)).toThrow();
  });

  it("merges differing amounts selected by one range and treats the total as an ordinary amount", async () => {
    const { repository, month } = await monthWithPrices([2, 3]);
    await repository.saveRules(repository.rules().revision, [{ ...base, match_amount_min_minor: 200, match_amount_max_minor: 300 }]);
    const keys = month.transactions.map((row) => `id:${row.id}`);
    const merge = previewTransactionMerge({ month: month.month, rows: month.transactions, group_by: "counterparty",
      groups: [{ transaction_keys: keys }], expected_revision: month.revision });
    const result = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision,
      transactions: merge.rows, operation_logs: [{ preview: merge.preview, selection: keys }] });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ transaction_date: "2026-10-01", product: "", amount: 5 });
    expect(repository.rules().rows[0].occurrences).toBe(0);
    expect(repository.rulesPreview(month.month, result.transactions).proposed_rows[0]).toMatchObject({ amount: 5, product: "" });
  });
});
