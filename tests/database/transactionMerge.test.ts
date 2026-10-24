import { describe, expect, it } from "vitest";
import { fixture } from "./databaseTestFixtures";
import { categoryKey } from "../../src/database/schema";
import { previewTransactionMerge, type MergeGroupPreview } from "../../src/domain/transactionMerge";
import { previewTransactionOperation } from "../../src/domain/transactionOperations";
import type { PendingOperationLog } from "../../src/types/operations";

async function setup() {
  const { repository, manager } = fixture();
  const savedRules = await repository.saveRules(repository.rules().revision, [{ transaction_type: "支出", match_scope: "merchant", counterparty: "平台", product: "", rewrite_product: "会员", category_key: categoryKey("订阅服务"), category: "订阅服务", match_amount_minor: 1990 }]);
  const month = await repository.saveMonth("2026-10", 0, [{ account_key: "cash-default", balance: 100 }], [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }], [1, 2].map((n) => ({ transaction_date: `2026-10-0${n}`, type: "支出", counterparty: "平台", product: `订单${n}`, amount: 19.9, category_key: categoryKey("订阅服务"), category: "订阅服务" })), []);
  const keys = month.transactions.map((row) => `id:${row.id}`);
  const merge = previewTransactionMerge({ month: month.month, expected_revision: month.revision, group_by: "counterparty", rows: month.transactions, groups: [{ transaction_keys: keys }] });
  const logs: PendingOperationLog[] = [{ preview: merge.preview, selection: keys }];
  return { repository, manager, month, merge, logs, savedRules };
}
describe("merge transaction persistence", () => {
  it("saves independent category partitions without any rules and preserves unmerged sources", async () => {
    const { repository } = fixture();
    const categories = repository.categories().rows.filter((category) => category.transaction_type === "支出").slice(0, 2);
    const month = await repository.saveMonth("2026-10", 0, [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [1.12, 0.33, 0.30, 0.29, 0.4].map((amount, index) => ({ transaction_date: "2026-10-10", type: "支出",
        counterparty: `平台${index}`, product: "喝水", amount, category_key: index < 4 ? categories[Math.floor(index / 2)].category_key : null,
        category: index < 4 ? categories[Math.floor(index / 2)].name : "" })), []);
    const merged = previewTransactionMerge({ month: month.month, expected_revision: month.revision, rows: month.transactions,
      group_by: "product", groups: [{ transaction_keys: month.transactions.map((row) => `id:${row.id}`) }] });
    const logs = [{ preview: merged.preview, selection: merged.groups.flatMap((group) => group.source_keys) }];
    const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: merged.rows, operation_logs: logs });
    expect(saved.transactions).toHaveLength(3);
    for (const category of categories) {
      const total = (rows: typeof month.transactions) => Math.round(rows.filter((row) => row.category_key === category.category_key).reduce((sum, row) => sum + row.amount, 0) * 100);
      expect(total(saved.transactions)).toBe(total(month.transactions));
    }
    expect(saved.transactions.filter((row) => row.category_key).every((row) => row.counterparty === "" && row.product === "喝水")).toBe(true);
    expect(saved.transactions.find((row) => row.id === month.transactions[4].id)).toMatchObject({ category: "", amount: 0.4 });
    expect(repository.rules().rows).toHaveLength(0);
  });
  it("persists tag partitions without changing tag totals and rejects a forged tag option", async () => {
    const { repository } = fixture();
    const taxonomy = repository.taxonomy();
    const savedTaxonomy = await repository.saveTaxonomy(taxonomy.attribute_revision, taxonomy.groups, taxonomy.options,
      taxonomy.tag_revision, [...taxonomy.tags, { tag_key: "tag-family", name: "家庭", description: "", color: "#7c3aed", is_active: true, sort_order: 1 }]);
    const tags = savedTaxonomy.tags.slice(0, 2).map((tag) => tag.tag_key);
    expect(tags).toHaveLength(2);
    const month = await repository.saveMonth("2026-10", 0, [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [[], [], [tags[0]], [tags[0]], tags, [...tags].reverse(), [tags[1]]].map((tagKeys, index) => ({
        transaction_date: "2026-10-10", type: "支出", counterparty: "平台", product: `订单${index}`,
        category_key: categoryKey("订阅服务"), category: "订阅服务", amount: 19.9, tag_keys: tagKeys
      })), []);
    const merge = previewTransactionMerge({ month: month.month, expected_revision: month.revision,
      group_by: "counterparty", rows: month.transactions, groups: [{ transaction_keys: month.transactions.map((row) => `id:${row.id}`) }], include_tagged: true });
    const log = { preview: merge.preview, selection: merge.groups.flatMap((group) => group.source_keys) };
    log.preview.metadata!.include_tagged = false;
    await expect(repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision,
      transactions: merge.rows, operation_logs: [log] })).rejects.toMatchObject({ code: "operation.preview_draft_mismatch" });
    expect((await repository.getMonth(month.month)).transactions).toHaveLength(7);
    log.preview.metadata!.include_tagged = true;
    const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision,
      transactions: merge.rows, operation_logs: [log] });
    expect(saved.transactions).toHaveLength(4);
    for (const key of tags) {
      const cents = (rows: typeof month.transactions) => Math.round(rows.filter((row) => row.tag_keys?.includes(key)).reduce((sum, row) => sum + row.amount, 0) * 100);
      expect(cents(saved.transactions)).toBe(cents(month.transactions));
    }
    expect(saved.transactions.find((row) => row.id === month.transactions[6].id)).toMatchObject({ amount: 19.9, tag_keys: [tags[1]] });
  });
  it("atomically replaces sources with a new ID and logs the assigned identity", async () => {
    const { repository, month, merge, logs } = await setup();
    const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: merge.rows, operation_logs: logs });
    expect(saved.transactions).toHaveLength(1); expect(saved.transactions[0].amount).toBe(39.8);
    expect(month.transactions.map((row) => row.id)).not.toContain(saved.transactions[0].id);
    expect(saved.revision).toBe(month.revision + 1);
    expect(repository.operationLogs(20)).toEqual(expect.arrayContaining([expect.objectContaining({ operation_type: "merge-transactions", success_count: 2 })]));
  });
  it("rejects a forged merge amount without deleting sources", async () => {
    const { repository, month, merge, logs } = await setup();
    const groups = logs[0].preview.metadata!.merge_groups as MergeGroupPreview[];
    groups[0].after.amount = 1;
    await expect(repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: merge.rows, operation_logs: logs })).rejects.toMatchObject({ code: "operation.preview_draft_mismatch" });
    expect((await repository.getMonth(month.month)).transactions).toHaveLength(2);
  });
  it("retains merge audit when the result is manually edited or deleted", async () => {
    const { repository, month, merge, logs } = await setup();
    const edited = merge.rows.map((row) => ({ ...row, product: "手工名称" }));
    const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: edited, operation_logs: logs });
    expect(saved.transactions[0].product).toBe("手工名称");
    expect(repository.operationLogs(20).some((log) => log.operation_type === "merge-transactions")).toBe(true);
  });
  it("does not depend on rule revisions when saving an already confirmed merge", async () => {
    const { repository, month, merge, logs, savedRules } = await setup();
    await repository.saveRules(savedRules.revision, savedRules.rows.map((rule) => ({ ...rule, rewrite_product: "新会员" })));
    const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: merge.rows, operation_logs: logs });
    expect(saved.transactions).toHaveLength(1);
    expect(saved.transactions[0]).toMatchObject({ product: "", counterparty: "平台", category: "订阅服务", amount: 39.8 });
  });
  it("still rejects a stale month without deleting any sources", async () => {
    const { repository, month, merge, logs } = await setup();
    await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: month.transactions });
    await expect(repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: merge.rows, operation_logs: logs })).rejects.toMatchObject({ code: "revision_conflict" });
    expect((await repository.getMonth(month.month)).transactions).toHaveLength(2);
  });
  it("supports apply-rules followed by merging the renamed draft", async () => {
    const { repository, month, savedRules } = await setup();
    const applied = previewTransactionOperation(month.transactions, { operation_type: "apply-rules", month: month.month, expected_revision: month.revision, rules_revision: savedRules.revision, transaction_ids: month.transactions.map((row) => row.id!), source_page: "记录/流水" }, savedRules.rows);
    const keys = month.transactions.map((row) => `id:${row.id}`);
    const merged = previewTransactionMerge({ month: month.month, expected_revision: month.revision, group_by: "product", rows: applied.rows, groups: [{ transaction_keys: keys }] });
    const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: merged.rows, operation_logs: [{ preview: applied.preview, selection: keys }, { preview: merged.preview, selection: keys }] });
    expect(saved.transactions[0]).toMatchObject({ product: "会员", amount: 39.8 });
  });
  it("keeps rule revision protection for a rule application preceding a merge", async () => {
    const { repository, month, savedRules } = await setup();
    const keys = month.transactions.map((row) => `id:${row.id}`);
    const applied = previewTransactionOperation(month.transactions, { operation_type: "apply-rules", month: month.month,
      expected_revision: month.revision, rules_revision: savedRules.revision, transaction_ids: month.transactions.map((row) => row.id!), source_page: "记录/流水" }, savedRules.rows);
    const merged = previewTransactionMerge({ month: month.month, expected_revision: month.revision, group_by: "product", rows: applied.rows, groups: [{ transaction_keys: keys }] });
    await repository.saveRules(savedRules.revision, savedRules.rows.map((rule) => ({ ...rule, rewrite_product: "新会员" })));
    await expect(repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: merged.rows,
      operation_logs: [{ preview: applied.preview, selection: keys }, { preview: merged.preview, selection: keys }] })).rejects.toMatchObject({ code: "revision_conflict" });
    expect((await repository.getMonth(month.month)).transactions).toHaveLength(2);
  });
  it("keeps different prices for the same merchant and reports the actual coverage", async () => {
    const { repository, savedRules } = await setup();
    await repository.saveRules(savedRules.revision, [...savedRules.rows, { ...savedRules.rows[0], id: undefined, match_amount_minor: 2990 }]);
    const report = repository.rules();
    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((rule) => rule.occurrences)).toEqual([2, 0]);
  });
});

it("supports deleting the merged draft before saving without losing audit", async () => {
  const { repository, month, logs } = await setup();
  const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: [], operation_logs: logs });
  expect(saved.transactions).toHaveLength(0);
  expect(repository.operationLogs(20).some((entry) => entry.operation_type === "merge-transactions")).toBe(true);
});

it("can merge a prior draft total again even when it no longer matches a price rule", async () => {
  const { repository, month } = await setup();
  const extra = { ...month.transactions[0], id: undefined, client_id: "extra" };
  const first = previewTransactionMerge({ month: month.month, expected_revision: month.revision, rows: [...month.transactions, extra], group_by: "counterparty", groups: [{ transaction_keys: month.transactions.map((row) => `id:${row.id}`) }] });
  const secondKeys = first.rows.map((row) => `client:${row.client_id}`);
  const second = previewTransactionMerge({ month: month.month, expected_revision: month.revision, rows: first.rows, group_by: "counterparty", groups: [{ transaction_keys: secondKeys }] });
  const saved = await repository.saveMonthSection(month.month, { section: "transactions", expected_revision: month.revision, transactions: second.rows, operation_logs: [{ preview: first.preview, selection: month.transactions.map((row) => `id:${row.id}`) }, { preview: second.preview, selection: secondKeys }] });
  expect(saved.transactions).toHaveLength(1); expect(saved.transactions[0].amount).toBe(59.7);
});
