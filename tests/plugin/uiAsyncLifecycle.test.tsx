// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "react";
import { AssetTrackError } from "../../src/application/errors";
import type { MonthEditorPort } from "../../src/services/ports";
import type { CsvInspection } from "../../src/types/csv";
import type { MonthWorkspace } from "../../src/types/month";
import type { OperationPreview } from "../../src/types/operations";
import type { Transaction } from "../../src/types/transactions";
import type { MonthSection } from "../../src/types/month";
import { useCsvImportSession } from "../../src/ui/month/useCsvImportSession";
import { useTransactionOperations } from "../../src/ui/month/useTransactionOperations";
import { messageFor } from "../../src/ui/editorPrimitives";

afterEach(() => {
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function transaction(product: string): Transaction {
  return {
    client_id: product,
    transaction_date: "2026-07-01",
    type: "支出",
    category_key: null,
    category: "",
    product,
    amount: 1
  };
}

function draft(product: string): MonthWorkspace {
  return {
    revision: 1,
    transactions: [transaction(product)]
  } as MonthWorkspace;
}

const preview: OperationPreview = {
  operation_id: "operation-1",
  operation_type: "bulk-edit-product",
  source_page: "记录/流水",
  total_count: 1,
  change_count: 1,
  skipped_count: 0,
  failure_count: 0,
  changes: []
};

const inspection: CsvInspection = {
  month: "2026-07",
  filename: "账单.csv",
  headers: ["日期", "商品", "金额", "类型"],
  header_signature: "signature",
  row_count: 1,
  sample_rows: [],
  distinct_values: { 类型: ["支出"] },
  empty_values: { 日期: false, 商品: false, 金额: false, 类型: false },
  suggested_mapping: {
    date_column: "日期",
    product_column: "商品",
    amount_column: "金额",
    type_column: "类型",
    type_values: { 支出: "支出" },
    included_statuses: []
  }
};

describe("async UI lifecycle guards", () => {
  it("does not apply a late transaction preview to a new month draft", async () => {
    const pending = deferred<{ preview: OperationPreview; rows: Transaction[] }>();
    const mark = vi.fn();
    const setState = vi.fn();
    const api = {
      previewTransactionOperation: vi.fn(() => pending.promise)
    } as unknown as MonthEditorPort;
    const pendingOperationLogsRef = { current: [] };
    const hostWindow = {
      confirm: vi.fn(() => true)
    } as unknown as Window;
    const initialDraft = draft("旧流水");
    const { result, rerender } = renderHook(
      ({ currentDraft, currentMonth }: { currentDraft: MonthWorkspace; currentMonth: string }) =>
        useTransactionOperations({
          api,
          hostWindow,
          month: currentMonth,
          draft: currentDraft,
          categories: [],
          rules: [],
          rulesRevision: 1,
          setState,
          mark,
          pendingOperationLogsRef,
          transactionResetVersion: 0
        }),
      { initialProps: { currentDraft: initialDraft, currentMonth: "2026-07" } }
    );

    let operation: Promise<void> | undefined;
    act(() => {
      operation = result.current.previewOperation(
        "bulk-edit-product",
        initialDraft.transactions,
        "outgoing",
        { target_value: "新商品" }
      );
    });
    rerender({ currentDraft: draft("当前流水"), currentMonth: "2026-08" });
    pending.resolve({
      preview,
      rows: [transaction("旧响应")]
    });

    await expect(operation).rejects.toMatchObject({
      code: "operation.preview_draft_mismatch"
    });
    expect(mark).not.toHaveBeenCalled();
    expect(pendingOperationLogsRef.current).toHaveLength(0);
  });

  it("clears pending state after direct rule application updates the draft", async () => {
    const api = {
      previewTransactionOperation: vi.fn(async () => ({
        preview: {
          ...preview,
          operation_type: "apply-rules",
          rule_ids: [1]
        },
        rows: [{
          ...transaction("咖啡"),
          category_key: "food",
          category: "餐饮"
        }]
      }))
    } as unknown as MonthEditorPort;
    const setState = vi.fn();
    const pendingOperationLogsRef = { current: [] };
    const hostWindow = {
      confirm: vi.fn(() => true)
    } as unknown as Window;
    let rerenderHook: ((props: { currentDraft: MonthWorkspace; currentMonth: string }) => void) | null = null;
    const mark = vi.fn((next: MonthWorkspace) => {
      rerenderHook?.({ currentDraft: next, currentMonth: "2026-07" });
    });
    const initialDraft = draft("咖啡");
    const { result, rerender } = renderHook(
      ({ currentDraft, currentMonth }: { currentDraft: MonthWorkspace; currentMonth: string }) =>
        useTransactionOperations({
          api,
          hostWindow,
          month: currentMonth,
          draft: currentDraft,
          categories: [],
          rules: [{
            id: 1,
            transaction_type: "支出",
            match_scope: "product",
            product: "咖啡",
            counterparty: "",
            category_key: "food",
            category: "餐饮"
          }],
          rulesRevision: 1,
          setState,
          mark,
          pendingOperationLogsRef,
          transactionResetVersion: 0
        }),
      { initialProps: { currentDraft: initialDraft, currentMonth: "2026-07" } }
    );
    rerenderHook = rerender;

    await act(async () => {
      await result.current.applyRules();
    });

    expect(mark).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: "pending" }));
    expect(setState).toHaveBeenLastCalledWith({ kind: "idle" });
  });

  it("ignores a late CSV inspection after the month context changes", async () => {
    const pending = deferred<CsvInspection>();
    const setState = vi.fn();
    const api = {
      inspectCsv: vi.fn(() => pending.promise),
      previewMappedCsv: vi.fn(),
      validateTransactions: vi.fn()
    } as unknown as MonthEditorPort;
    const initialDraft = draft("当前流水");
    const { result, rerender } = renderHook(
      ({ currentDraft, currentMonth }: { currentDraft: MonthWorkspace; currentMonth: string }) =>
        useCsvImportSession({
          api,
          month: currentMonth,
          draft: currentDraft,
          setState,
          mark: vi.fn(),
          invalidatePendingOperationLogs: vi.fn(),
          saveCsvMapping: vi.fn(async () => undefined)
        }),
      { initialProps: { currentDraft: initialDraft, currentMonth: "2026-07" } }
    );
    const file = {
      name: "账单.csv",
      arrayBuffer: vi.fn(async () => new ArrayBuffer(1))
    } as unknown as File;

    let importRequest: Promise<void> | undefined;
    act(() => {
      importRequest = result.current.importCsv({
        target: { files: [file], value: "selected" }
      } as unknown as ChangeEvent<HTMLInputElement>);
    });
    rerender({ currentDraft: draft("新月份流水"), currentMonth: "2026-08" });
    pending.resolve(inspection);

    await expect(importRequest).resolves.toBeUndefined();
    expect(result.current.csvSource).toBeNull();
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "pending" }));
  });

  it("ignores a late CSV inspection after the active subpage changes", async () => {
    const pending = deferred<CsvInspection>();
    const setState = vi.fn();
    const api = {
      inspectCsv: vi.fn(() => pending.promise),
      previewMappedCsv: vi.fn(),
      validateTransactions: vi.fn()
    } as unknown as MonthEditorPort;
    const currentDraft = draft("当前流水");
    const { result, rerender } = renderHook(
      ({ activeSection }: { activeSection: MonthSection }) =>
        useCsvImportSession({
          api,
          month: "2026-07",
          draft: currentDraft,
          activeSection,
          setState,
          mark: vi.fn(),
          invalidatePendingOperationLogs: vi.fn(),
          saveCsvMapping: vi.fn(async () => undefined)
        }),
      { initialProps: { activeSection: "transactions" as MonthSection } }
    );
    const file = {
      name: "账单.csv",
      arrayBuffer: vi.fn(async () => new ArrayBuffer(1))
    } as unknown as File;

    let importRequest: Promise<void> | undefined;
    act(() => {
      importRequest = result.current.importCsv({
        target: { files: [file], value: "selected" }
      } as unknown as ChangeEvent<HTMLInputElement>);
    });
    rerender({ activeSection: "assets" });
    pending.resolve(inspection);

    await expect(importRequest).resolves.toBeUndefined();
    expect(result.current.csvSource).toBeNull();
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "pending" }));
  });

  it("keeps the stable localized message path for batch-operation errors", () => {
    expect(messageFor(new AssetTrackError({
      code: "operation.preview_draft_mismatch",
      status: 409
    }))).toContain("预览");
  });
});
