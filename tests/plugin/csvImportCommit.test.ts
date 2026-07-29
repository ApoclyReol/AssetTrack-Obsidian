import { describe, expect, it, vi } from "vitest";
import type { CsvColumnMapping, Transaction } from "../../src/types";
import { prepareCsvImportCommit } from "../../src/ui/csvImportCommit";

const mapping: CsvColumnMapping = {
  date_column: "日期",
  product_column: "商品",
  amount_column: "金额",
  type_column: "类型",
  type_values: { 支出: "支出" },
  included_statuses: []
};

const existing: Transaction = {
  transaction_date: "2026-07-01",
  type: "支出",
  category: "",
  product: "原流水",
  amount: 1
};

const imported: Transaction = {
  transaction_date: "2026-07-02",
  type: "支出",
  category: "",
  product: "导入流水",
  amount: 2
};

describe("CSV import commit", () => {
  it("does not mutate the current draft when preparation fails", async () => {
    const current = [existing];
    await expect(prepareCsvImportCommit({
      currentTransactions: current,
      importedTransactions: [imported],
      mode: "append",
      headerSignature: "signature",
      mapping,
      saveMapping: vi.fn().mockResolvedValue(undefined),
      loadRuleCandidates: vi.fn().mockRejectedValue(new Error("候选生成失败"))
    })).rejects.toThrow("候选生成失败");
    expect(current).toEqual([existing]);
  });

  it("returns one append after a failed attempt is retried", async () => {
    const current = [existing];
    let attempts = 0;
    const loadRuleCandidates = vi.fn(async (rows: Transaction[]) => {
      attempts += 1;
      if (attempts === 1) throw new Error("临时失败");
      return { count: rows.length };
    });
    const options = {
      currentTransactions: current,
      importedTransactions: [imported],
      mode: "append" as const,
      headerSignature: "signature",
      mapping,
      saveMapping: vi.fn().mockResolvedValue(undefined),
      loadRuleCandidates
    };
    await expect(prepareCsvImportCommit(options)).rejects.toThrow("临时失败");
    const retried = await prepareCsvImportCommit(options);
    expect(retried.transactions).toEqual([existing, imported]);
    expect(retried.candidates).toEqual({ count: 2 });
  });
});
