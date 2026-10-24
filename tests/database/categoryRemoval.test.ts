import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

async function ledger() {
  const value = fixture();
  const source = categoryKey("餐饮基础"), target = categoryKey("餐饮改善");
  await value.repository.saveMonth("2026-09", 0,
    [{ account_key: "cash-default", balance: 100 }],
    [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
    [{ type: "支出", category_key: source, category: "餐饮基础", product: "午餐", counterparty: "平台",
      transaction_date: "2026-09-04", amount: 20, tag_keys: ["tag-travel"] }], []);
  await value.repository.saveRules(value.repository.rules().revision,
    [{ transaction_type: "支出", match_scope: "product", product: "午餐", category_key: source, category: "餐饮基础" }]);
  return { ...value, source, target };
}

describe("category transfer and removal", () => {
  it("atomically transfers rules and history while retaining amounts, tags and target attributes", async () => {
    const { repository, source, target } = await ledger();
    const attributes = repository.categories().rows.find(row => row.category_key === target)?.attribute_keys;
    const before = await repository.getMonth("2026-09");
    const preview = repository.previewCategoryRemoval(source, target);
    expect(preview).toMatchObject({ transaction_count: 1, rule_count: 1 });
    await repository.applyCategoryRemoval(preview);
    const after = await repository.getMonth("2026-09");
    expect(after.transactions[0]).toMatchObject({ category_key: target, category: "餐饮改善", amount: 20,
      transaction_date: "2026-09-04", product: "午餐", counterparty: "平台", tag_keys: ["tag-travel"] });
    expect(after.revision).not.toBe(before.revision);
    expect(repository.categories().rows.some(row => row.category_key === source)).toBe(false);
    expect(repository.categories().rows.find(row => row.category_key === target)?.attribute_keys).toEqual(attributes);
    expect(repository.rules().rows[0]).toMatchObject({ category_key: target, category: "餐饮改善" });
    expect(repository.operationLogs(10).some(row => row.source_page === "配置/删除分类")).toBe(true);
  });
  it("refuses referenced deletion without a target", async () => {
    const { repository, source } = await ledger();
    await expect(repository.applyCategoryRemoval(repository.previewCategoryRemoval(source))).rejects.toMatchObject({ code: "category.delete_referenced" });
    expect(repository.categories().rows.some(row => row.category_key === source)).toBe(true);
  });
  it("rejects changed month data without partially transferring rules", async () => {
    const { repository, source, target } = await ledger();
    const preview = repository.previewCategoryRemoval(source, target);
    const month = await repository.getMonth("2026-09");
    await repository.saveMonth("2026-09", month.revision, month.cash_accounts, month.investment_accounts,
      month.transactions.map(row => ({ ...row, amount: 30 })), month.fixed_assets);
    await expect(repository.applyCategoryRemoval(preview)).rejects.toMatchObject({ status: 409 });
    expect(repository.rules().rows[0].category_key).toBe(source);
    expect((await repository.getMonth("2026-09")).transactions[0].category_key).toBe(source);
  });
  it("rejects stale rule configuration", async () => {
    const { repository, source, target } = await ledger();
    const preview = repository.previewCategoryRemoval(source, target);
    const rules = repository.rules();
    await repository.saveRules(rules.revision, rules.rows.map(row => ({ ...row, product: "晚餐" })));
    await expect(repository.applyCategoryRemoval(preview)).rejects.toMatchObject({ status: 409 });
    expect(repository.categories().rows.some(row => row.category_key === source)).toBe(true);
  });
  it("rejects a different transaction-type target", async () => {
    const { repository, source } = await ledger();
    const income = repository.categories().rows.find(row => row.transaction_type === "收入")!;
    expect(() => repository.previewCategoryRemoval(source, income.category_key)).toThrow();
  });
  it("deletes an unused category without requiring a target", async () => {
    const { repository } = fixture();
    const source = categoryKey("餐饮基础");
    await repository.applyCategoryRemoval(repository.previewCategoryRemoval(source));
    expect(repository.categories().rows.some(row => row.category_key === source)).toBe(false);
  });
});
