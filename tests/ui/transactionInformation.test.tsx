// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { Modal, type App } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import { previewTransactionOperation } from "../../src/domain/transactionOperations";
import type { MonthEditorPort } from "../../src/services/ports";
import type { MonthWorkspace } from "../../src/types/month";
import type { PendingOperationLog } from "../../src/types/operations";
import type { TransactionInfoTarget } from "../../src/ui/TransactionInfoEditModal";
import { useTransactionOperations } from "../../src/ui/month/useTransactionOperations";

afterEach(() => vi.restoreAllMocks());

it.each([false, true])("commits both information fields as one undo step or preserves the draft when the second field fails (%s)", async failSecond => {
  const canonical = { revision: 1, transactions: [{ id: 1, transaction_date: "2026-10-01", type: "支出",
    product: "会员", counterparty: "平台", category: "订阅", category_key: "subscription", amount: 19.9 }] } as MonthWorkspace;
  const initialDraft = { ...canonical, transactions: canonical.transactions.map(row => ({ ...row, product: "手工会员" })) };
  const capture: { confirm?: (target: TransactionInfoTarget) => Promise<void> } = {};
  vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
    capture.confirm = (this as unknown as { options: { onConfirm: NonNullable<typeof capture.confirm> } }).options.onConfirm;
  });
  const preview = vi.fn(async (request: Parameters<MonthEditorPort["previewTransactionOperation"]>[0]) => {
    if (failSecond && request.operation_type === "bulk-edit-product") throw new Error("second field failed");
    return previewTransactionOperation(request.rows, request);
  });
  const api = { month: vi.fn(async () => canonical), previewTransactionOperation: preview } as unknown as MonthEditorPort;
  const logs: { current: PendingOperationLog[] } = { current: [] };
  let updateDraft: (props: { currentDraft: MonthWorkspace }) => void = () => {};
  const mark = vi.fn((currentDraft: MonthWorkspace) => updateDraft({ currentDraft }));
  const { result, rerender } = renderHook(({ currentDraft }: { currentDraft: MonthWorkspace }) => useTransactionOperations({
    app: {} as App, api, hostWindow: window, month: "2026-10", draft: currentDraft, categories: [], rules: [],
    rulesRevision: null, setState: vi.fn(), mark, pendingOperationLogsRef: logs, transactionResetVersion: 0
  }), { initialProps: { currentDraft: initialDraft } });
  updateDraft = rerender;
  act(() => result.current.openInfoEdit("outgoing", new Set([1])));
  const target = { counterparty: "统一平台", product: "规范会员" };
  if (failSecond) {
    await act(async () => { await expect(capture.confirm!(target)).rejects.toThrow("second field failed"); });
    expect(mark).not.toHaveBeenCalled();
    expect(logs.current).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
    expect(initialDraft.transactions[0].product).toBe("手工会员");
    return;
  }
  await act(async () => capture.confirm!(target));
  expect(mark).toHaveBeenCalledTimes(1);
  expect(mark.mock.calls[0][0].transactions[0]).toMatchObject(target);
  expect(logs.current).toHaveLength(2);
  expect(logs.current[0].preview.changes[0].before.product).toBe("会员");
  expect(logs.current[1].preview.changes[0].before).toMatchObject({ product: "手工会员", counterparty: "统一平台" });
  expect(result.current.canUndo).toBe(true);
  act(() => result.current.undo());
  expect(mark.mock.calls[1][0].transactions).toEqual(initialDraft.transactions);
  expect(logs.current).toHaveLength(0);
  expect(result.current.canUndo).toBe(false);
});
