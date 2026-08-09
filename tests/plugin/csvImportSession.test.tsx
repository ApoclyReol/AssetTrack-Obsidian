// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "react";
import type {
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection
} from "../../src/types/csv";
import type { MonthEditorPort } from "../../src/services/ports";
import { useCsvImportSession } from "../../src/ui/month/useCsvImportSession";
import type { MonthWorkspace } from "../../src/types/month";

const mapping: CsvColumnMapping = {
  date_column: "日期",
  product_column: "商品",
  amount_column: "金额",
  type_column: "类型",
  type_values: { 支出: "支出" },
  included_statuses: []
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
  suggested_mapping: mapping
};

const imported = {
  transaction_date: "2026-07-02",
  type: "支出",
  category: "",
  product: "导入流水",
  amount: 2
};

const preview: CsvImportPreview = {
  month: "2026-07",
  rows: [imported],
  issues: [{ code: "transaction.category.missing", severity: "warning" }],
  type_summary: { 支出: 1 },
  modes: ["append", "replace"],
  import_stats: {
    source_rows: 1,
    accepted_rows: 1,
    defaulted: {},
    defaulted_examples: {},
    filtered: {},
    examples: {},
    filtered_rows: []
  }
};

function createSession() {
  const existing = {
    transaction_date: "2026-07-01",
    type: "支出",
    category: "",
    product: "原流水",
    amount: 1
  };
  const draft = { transactions: [existing] } as MonthWorkspace;
  const mark = vi.fn();
  const invalidatePendingOperationLogs = vi.fn();
  const saveCsvMapping = vi.fn(async () => undefined);
  const previewTransactionOperation = vi.fn();
  const api = {
    inspectCsv: vi.fn(async () => inspection),
    previewMappedCsv: vi.fn(async () => preview),
    validateTransactions: vi.fn(async () => ({ issues: preview.issues })),
    previewTransactionOperation
  } as unknown as MonthEditorPort;
  const setState = vi.fn();
  const { result } = renderHook(() => useCsvImportSession({
    api,
    month: "2026-07",
    draft,
    setState,
    mark,
    invalidatePendingOperationLogs,
    getCsvMapping: () => undefined,
    saveCsvMapping
  }));
  return {
    result,
    draft,
    mark,
    invalidatePendingOperationLogs,
    saveCsvMapping,
    previewTransactionOperation,
    api,
    setState
  };
}

async function openImport(result: ReturnType<typeof createSession>["result"]) {
  const file = {
    name: "账单.csv",
    size: 1,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(1))
  } as unknown as File;
  await act(async () => {
    await result.current.importCsv({
      target: { files: [file], value: "selected" }
    } as unknown as ChangeEvent<HTMLInputElement>);
  });
}

describe("CSV import session", () => {
  it("puts accepted rows directly into the draft without opening an operation preview", async () => {
    const session = createSession();
    await openImport(session.result);

    await act(async () => {
      await session.result.current.applyCsvPreview(preview, "append", mapping);
    });

    expect(session.mark).toHaveBeenCalledWith(
      {
        ...session.draft,
        transactions: [...session.draft.transactions, imported]
      },
      "transactions",
      preview.issues
    );
    expect(session.previewTransactionOperation).not.toHaveBeenCalled();
    expect(session.invalidatePendingOperationLogs).not.toHaveBeenCalled();
    expect(session.saveCsvMapping).toHaveBeenCalledWith("signature", mapping);
  });

  it("invalidates stale operation logs before replacing the draft", async () => {
    const session = createSession();
    await openImport(session.result);

    await act(async () => {
      await session.result.current.applyCsvPreview(preview, "replace", mapping);
    });

    expect(session.invalidatePendingOperationLogs).toHaveBeenCalledOnce();
  });
});
