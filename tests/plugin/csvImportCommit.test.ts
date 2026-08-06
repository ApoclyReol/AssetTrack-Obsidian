import { describe, expect, it, vi } from "vitest";
import type {
  CsvColumnMapping
} from "../../src/types/csv";
import type {
  Transaction
} from "../../src/types/transactions";
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
      saveMapping: vi.fn().mockRejectedValue(new Error("映射保存失败"))
    })).rejects.toThrow("映射保存失败");
    expect(current).toEqual([existing]);
  });

  it("returns one append after a failed attempt is retried", async () => {
    const current = [existing];
    let attempts = 0;
    const saveMapping = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("临时失败");
    });
    const options = {
      currentTransactions: current,
      importedTransactions: [imported],
      mode: "append" as const,
      headerSignature: "signature",
      mapping,
      saveMapping
    };
    await expect(prepareCsvImportCommit(options)).rejects.toThrow("临时失败");
    const retried = await prepareCsvImportCommit(options);
    expect(retried.transactions).toEqual([existing, imported]);
  });
});
