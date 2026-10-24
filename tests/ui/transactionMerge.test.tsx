import { Modal, type App } from "obsidian";
import { useTransactionOperations } from "../../src/ui/month/useTransactionOperations";
import { groupTransactions } from "../../src/ui/transactionGrouping";
import type { MonthEditorPort } from "../../src/services/ports";
import type { CategoryDefinition } from "../../src/types/configuration";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthEditorTransactionsSection } from "../../src/ui/month/MonthEditorTransactionsSection";
import { TransactionMergeContent } from "../../src/ui/TransactionMergeModal";
import { RuleCreationContent } from "../../src/ui/RuleCreationModal";
import { previewTransactionMerge, type MergeTransactionsRequest, type MergePreviewResult } from "../../src/domain/transactionMerge";
import type { Transaction } from "../../src/types/transactions";
import type { SavedRule } from "../../src/types/rules";
import type { MonthWorkspace } from "../../src/types/month";
import { setTestLanguage } from "../mocks/obsidian";

const rule: SavedRule = { id: 1, transaction_type: "支出", match_scope: "product", product: "会员", category_key: "subscription", category: "订阅服务", match_amount_minor: 1990 };
const rows: Transaction[] = [1, 2].map((id) => ({ id, transaction_date: `2026-10-0${id}`, type: "支出", product: "会员", counterparty: "平台", category: "订阅服务", category_key: "subscription", amount: 19.9 }));
const categories: CategoryDefinition[] = [{ category_key: "subscription", name: "订阅服务", transaction_type: "支出" as const, is_active: true, sort_order: 0, necessity: "必要", pattern: "周期", is_big_ticket: false, color: "#123456" }];
afterEach(() => { vi.restoreAllMocks(); cleanup(); setTestLanguage("zh-CN"); });
function section(selected: Set<number> = new Set(), transactionRows = rows, matchingRules: SavedRule[] = [rule]) {
  const merge = vi.fn();
  render(<MonthEditorTransactionsSection month="2026-10" draft={{ transactions: transactionRows } as MonthWorkspace}
    categories={categories} rules={matchingRules} summarySort={null} expandedGroup="" onSummarySort={vi.fn()} onExpandedGroupChange={vi.fn()}
    onUpdate={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} viewMode="product" onViewModeChange={vi.fn()}
    selectedTransactionKeys={selected} onSelectedTransactionKeysChange={vi.fn()} onMergeGroup={merge} />);
  return merge;
}
describe("merge summary interactions", () => {
  it("recomputes the preview when tagged transactions are included and confirms that exact result", async () => {
    const taggedRows = rows.map((row) => ({ ...row, tag_keys: ["a", "b"] }));
    const request: MergeTransactionsRequest = { month: "2026-10", rows: taggedRows, group_by: "product", groups: [{ transaction_keys: ["id:1", "id:2"] }], expected_revision: 1 };
    const result = previewTransactionMerge(request);
    const confirm = vi.fn<(value: MergePreviewResult) => Promise<void>>().mockResolvedValue(undefined);
    const onPreview = vi.fn(async (includeTagged: boolean) => previewTransactionMerge({ ...request, include_tagged: includeTagged }));
    render(<TransactionMergeContent result={result} onPreview={onPreview} tagNames={{ a: "旅行", b: "家庭" }} onConfirm={confirm} onClose={vi.fn()} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "确认合并到草稿" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "将有标签的流水也参与合并" }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "确认合并到草稿" }).disabled).toBe(false));
    expect(screen.getAllByText("旅行 · 家庭").length).toBeGreaterThan(0); expect(onPreview).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "确认合并到草稿" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(confirm.mock.calls[0][0].groups[0].after).toMatchObject({ amount: 39.8, tag_keys: ["a", "b"] });
  });
  it("only offers per-row merging and always uses the entire visible summary group", () => {
    const merge = section(new Set([1]));
    expect(screen.queryByRole("button", { name: "合并选中项目" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "合并成一条" }));
    expect(merge).toHaveBeenCalledWith(expect.objectContaining({ indexes: [0, 1] }));
  });
  it("disables a singleton with a specific explanation", () => {
    section(new Set(), rows.slice(0, 1));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "合并成一条" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "合并成一条" }).title).toContain("至少需要两笔");
  });
  it("allows unmatched, conflicted, different-price and entirely tagged rows to open the preview", () => {
    for (const matchingRules of [[], [{ ...rule, match_amount_minor: null }, { ...rule, id: 2, match_amount_minor: null }]]) {
      const values = rows.map((row, index) => ({ ...row, amount: index ? 0.33 : 1.12, tag_keys: ["a"] }));
      const merge = section(new Set(), values, matchingRules);
      const button = screen.getByRole<HTMLButtonElement>("button", { name: "合并成一条" });
      expect(button.disabled).toBe(false); fireEvent.click(button);
      expect(merge).toHaveBeenCalledOnce(); cleanup();
    }
  });
  it("marks different secondary names as intentionally blank in the preview", () => {
    const values = rows.map((row, index) => ({ ...row, counterparty: `平台${index}` }));
    const result = previewTransactionMerge({ month: "2026-10", rows: values, group_by: "product", groups: [{ transaction_keys: ["id:1", "id:2"] }], expected_revision: 1 });
    render(<TransactionMergeContent result={result} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("—（原名称不同，合并后留空）")).toBeTruthy();
  });
  it("previews irreversible replacement and only confirms on the explicit button", async () => {
    const result = previewTransactionMerge({ month: "2026-10", rows, group_by: "product", groups: [{ transaction_keys: ["id:1", "id:2"] }], expected_revision: 1 });
    const confirm = vi.fn().mockResolvedValue(undefined); const close = vi.fn();
    render(<TransactionMergeContent result={result} onConfirm={confirm} onClose={close} />);
    expect(screen.getByText(/保存流水后将替换原逐笔记录/)).toBeTruthy();
    expect(screen.getByText(/按完整标签组合分别处理/)).toBeTruthy(); expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认合并到草稿" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1)); expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("offers a single-transaction amount without enabling it automatically", async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(<RuleCreationContent initial={{ ...rule, match_amount_minor: null }} categories={categories} suggestedAmount={1990} onConfirm={confirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "金额条件方式" }), { target: { value: "eq" } });
    fireEvent.change(screen.getByRole("textbox", { name: "金额条件" }), { target: { value: "19.999" } });
    fireEvent.click(screen.getByRole("button", { name: "确认保存规则" })); expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "使用当前单笔金额 19.90" }));
    fireEvent.click(screen.getByRole("button", { name: "确认保存规则" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ match_amount_minor: 1990 })));
  });
  it("renders the merge confirmation in English", () => {
    setTestLanguage("en");
    const result = previewTransactionMerge({ month: "2026-10", rows, group_by: "product", groups: [{ transaction_keys: ["id:1", "id:2"] }], expected_revision: 1 });
    render(<TransactionMergeContent result={result} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Merge into draft" })).toBeTruthy();
    expect(screen.getByText(/the plugin cannot split them back/)).toBeTruthy();
  });
});

it("requires an open modal to confirm and works without a loaded rule revision", async () => {
  const capture: { confirm?: (isOpen: () => boolean, value: MergePreviewResult) => Promise<void>; result?: MergePreviewResult } = {};
  vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
    const options = (this as unknown as { options: { onConfirm: NonNullable<typeof capture.confirm>; result: MergePreviewResult } }).options;
    capture.confirm = options.onConfirm; capture.result = options.result;
  });
  const ruleWorkspaceShell = vi.fn();
  const api = {
    previewTransactionMerge: vi.fn(async (request: MergeTransactionsRequest) => previewTransactionMerge(request)),
    ruleWorkspaceShell
  } as unknown as MonthEditorPort;
  const mark = vi.fn();
  const currentDraft = { revision: 1, transactions: rows } as MonthWorkspace;
  const { result } = renderHook(() => useTransactionOperations({
    app: {} as App, api, month: "2026-10", draft: currentDraft,
    hostWindow: window, categories, tags: [], rules: [], rulesRevision: null, setState: vi.fn(), mark,
    pendingOperationLogsRef: { current: [] }, transactionResetVersion: 0
  }));
  await act(async () => { await result.current.mergeGroup(groupTransactions(rows, "product")[0]); });
  if (!capture.confirm || !capture.result) throw new Error("Expected merge modal");
  await expect(capture.confirm(() => false, capture.result)).rejects.toMatchObject({ code: "operation.preview_draft_mismatch" });
  expect(mark).not.toHaveBeenCalled();
  await act(async () => { await capture.confirm!(() => true, capture.result!); });
  expect(mark).toHaveBeenCalledWith(expect.objectContaining({ transactions: [expect.objectContaining({ product: "会员", amount: 39.8 })] }), "transactions");
  expect(ruleWorkspaceShell).not.toHaveBeenCalled();
});
