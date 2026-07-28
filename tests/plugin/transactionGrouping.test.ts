import { describe, expect, it } from "vitest";
import {
  groupTransactions,
  normalizeProduct
} from "../../src/ui/transactionGrouping";
import type { Transaction } from "../../src/types";

function row(overrides: Partial<Transaction>): Transaction {
  return {
    transaction_date: "2026-01-01",
    type: "支出",
    category: "餐饮基础",
    product: "咖啡",
    amount: 10,
    ...overrides
  };
}

describe("transaction grouping", () => {
  it("groups equivalent product labels for display without removing source rows", () => {
    const rows = [
      row({ product: "咖啡", amount: 10 }),
      row({ product: "咖 啡！", amount: 12, transaction_date: "2026-01-03" }),
      row({ type: "收入", product: "咖啡", amount: 20 })
    ];

    const groups = groupTransactions(rows);

    expect(rows).toHaveLength(3);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      count: 2,
      amount: 22,
      indexes: [0, 1],
      firstDate: "2026-01-01",
      lastDate: "2026-01-03"
    });
  });

  it("normalizes width, case, spaces and punctuation conservatively", () => {
    expect(normalizeProduct(" Ａb C！")).toBe("abc");
  });
});
