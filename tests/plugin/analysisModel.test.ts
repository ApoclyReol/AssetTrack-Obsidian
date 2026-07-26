import { describe, expect, it } from "vitest";
import type { AnnualRow, CategoryDefinition } from "../../src/types";
import { ANALYSIS_MODES, EDITOR_MODES } from "../../src/constants";
import {
  changeTone,
  createTransactionDraft,
  INFLOW_COLOR,
  OUTFLOW_COLOR,
  sampleAnnualRows,
  savingsColor,
  transactionIndexes,
  TRANSACTION_SECTIONS
} from "../../src/ui/analysisModel";

function annualRow(index: number): AnnualRow {
  return {
    month: `2026-${String(index + 1).padStart(2, "0")}`,
    cash: index,
    debt: 0,
    principal: 0,
    inv_position: 0,
    total_assets: index,
    inv_profit: 0,
    inv_roi: 0,
    inv_weight: 0,
    total_income: 100,
    total_expense: 50,
    savings_rate: 50,
    total_deposit: 0,
    total_withdraw: 0,
    all_out: 50,
    total_daifu: 0,
    necessary: 0,
    controlled: 0,
    periodic: 0,
    daily: 0,
    occasional: 0,
    discrepancy: null
  };
}

describe("real-time analysis model", () => {
  it("uses the five fixed transaction sections", () => {
    expect(EDITOR_MODES).toEqual(["analysis", "transactions", "debts", "rules"]);
    expect(ANALYSIS_MODES).toEqual(["home", "annual", "monthly"]);
    expect(TRANSACTION_SECTIONS).toEqual(["支出", "收入", "代付", "加仓", "提现"]);
  });

  it("writes hidden types from the section and routes imported rows", () => {
    const categories = [{
      category_key: "salary",
      name: "工资收入",
      transaction_type: "收入",
      necessity: "不适用",
      pattern: "不适用",
      is_big_ticket: false,
      color: "#D94F45",
      is_active: true,
      sort_order: 0
    }] satisfies CategoryDefinition[];
    const income = createTransactionDraft("收入", "2026-07", categories, "income");
    const withdraw = createTransactionDraft("提现", "2026-07", categories, "withdraw");
    expect(income).toMatchObject({
      type: "收入",
      category_key: "salary",
      transaction_date: "2026-07-01"
    });
    expect(withdraw).toMatchObject({
      type: "提现",
      category_key: null,
      category: ""
    });
    expect(transactionIndexes([withdraw, income], "收入")).toEqual([1]);
  });

  it("uses original App red-growth and green-decline semantics", () => {
    expect(changeTone(1)).toBe("inflow");
    expect(changeTone(-1)).toBe("outflow");
    expect(changeTone(0)).toBeUndefined();
    expect(savingsColor(20)).toBe(INFLOW_COLOR);
    expect(savingsColor(-20)).toBe(OUTFLOW_COLOR);
  });

  it("samples full history deterministically and preserves endpoints", () => {
    const rows = Array.from({ length: 36 }, (_, index) => annualRow(index));
    const sampled = sampleAnnualRows(rows, 12);
    expect(sampled).toHaveLength(12);
    expect(sampled[0]).toBe(rows[0]);
    expect(sampled.at(-1)).toBe(rows.at(-1));
    expect(sampleAnnualRows(rows, 12)).toEqual(sampled);
  });
});
