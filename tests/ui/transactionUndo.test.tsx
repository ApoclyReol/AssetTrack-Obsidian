// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTransactionOperations } from "../../src/ui/month/useTransactionOperations";
import type { MonthWorkspace } from "../../src/types/month";
import type { MonthEditorPort } from "../../src/services/ports";
import type { PendingOperationLog } from "../../src/types/operations";
import type { Transaction } from "../../src/types/transactions";

const rows: Transaction[] = [1, 2].map(id => ({ id, transaction_date: "2026-09-01", type: "支出", category: "", product: "饮用水", amount: id }));
afterEach(cleanup);
function setup() {
  return renderHook(({ version }) => {
    const [draft, setDraft] = useState({ transactions: rows } as MonthWorkspace);
    const logs = useRef<PendingOperationLog[]>([]);
    const operations = useTransactionOperations({ api: {} as MonthEditorPort, hostWindow: window, month: "2026-09", draft,
      categories: [], rules: [], rulesRevision: null, setState: vi.fn(), mark: next => setDraft(next),
      pendingOperationLogsRef: logs, transactionResetVersion: 0, dataVersion: version });
    return { operations, draft, logs, setDraft };
  }, { initialProps: { version: 0 } });
}
describe("transaction draft undo", () => {
  it("undoes consecutive actions and restores each pending audit snapshot", () => {
    const view = setup();
    const one = rows.slice(0, 1);
    act(() => { view.result.current.operations.recordUndo(one); view.result.current.setDraft({ transactions: one } as MonthWorkspace); });
    const two = one.map(row => ({ ...row, amount: 99 }));
    act(() => { view.result.current.operations.recordUndo(two); view.result.current.setDraft({ transactions: two } as MonthWorkspace); });
    expect(view.result.current.operations.canUndo).toBe(true);
    act(() => view.result.current.operations.undo());
    expect(view.result.current.draft.transactions).toEqual(one);
    act(() => view.result.current.operations.undo());
    expect(view.result.current.draft.transactions).toEqual(rows);
    expect(view.result.current.logs.current).toEqual([]);
    expect(view.result.current.operations.canUndo).toBe(false);
  });
  it("invalidates history after a later manual edit", () => {
    const view = setup(); const next = rows.slice(1);
    act(() => { view.result.current.operations.recordUndo(next); view.result.current.setDraft({ transactions: next } as MonthWorkspace); });
    act(() => view.result.current.setDraft({ transactions: next.map(row => ({ ...row, product: "手工编辑" })) } as MonthWorkspace));
    expect(view.result.current.operations.canUndo).toBe(false);
    act(() => view.result.current.operations.undo());
    expect(view.result.current.draft.transactions[0].product).toBe("手工编辑");
  });
  it("invalidates history when data changed outside this editor", () => {
    const view = setup(); const next = rows.slice(1);
    act(() => { view.result.current.operations.recordUndo(next); view.result.current.setDraft({ transactions: next } as MonthWorkspace); });
    view.rerender({ version: 1 });
    expect(view.result.current.operations.canUndo).toBe(false);
  });
});
