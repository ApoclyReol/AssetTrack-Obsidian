import { describe, expect, it } from "vitest";
import type {
  Transaction
} from "../../src/types/transactions";
import { prepareCsvImportCommit } from "../../src/ui/csvImportCommit";

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
  it("prepares an append without persisting settings", () => {
    const current = [existing];
    const prepared = prepareCsvImportCommit({
      currentTransactions: current,
      importedTransactions: [imported],
      mode: "append",
    });
    expect(prepared.transactions).toEqual([existing, imported]);
    expect(current).toEqual([existing]);
  });

  it("prepares a replacement without retaining the old draft", () => {
    const prepared = prepareCsvImportCommit({
      currentTransactions: [existing],
      importedTransactions: [imported],
      mode: "replace"
    });
    expect(prepared.transactions).toEqual([imported]);
  });
});
