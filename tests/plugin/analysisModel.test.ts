import { describe, expect, it } from "vitest";
import type { AnnualRow, CategoryDefinition } from "../../src/types";
import { ANALYSIS_MODES, EDITOR_MODES } from "../../src/constants";
import {
  buildAnomalyDisplayRows,
  changeTone,
  createTransactionDraft,
  INFLOW_COLOR,
  OUTFLOW_COLOR,
  reconciliationStatus,
  sampleAnnualRows,
  savingsColor,
  transactionBlockNumber,
  transactionBlockNumbers,
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
    cost_assets: index,
    market_net_assets: index,
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
  it("keeps the editor, analysis, and transaction sections stable", () => {
    expect(EDITOR_MODES).toEqual(["analysis", "transactions", "rules"]);
    expect(ANALYSIS_MODES).toEqual(["home", "annual", "monthly", "products"]);
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
      category_key: null,
      category: "",
      transaction_date: "2026-07-01"
    });
    expect(withdraw).toMatchObject({
      type: "提现",
      category_key: null,
      category: ""
    });
    expect(transactionIndexes([withdraw, income], "收入")).toEqual([1]);
    expect(transactionBlockNumber([withdraw, income], 1)).toBe(1);
    expect(transactionBlockNumber([withdraw, income, income], 2)).toBe(2);
    expect(transactionBlockNumbers([withdraw, income, income])).toEqual([
      1,
      1,
      2
    ]);
  });

  it("precomputes 50k block numbers without repeated scans", () => {
    const rows = Array.from({ length: 50_000 }, (_, index) => ({
      transaction_date: "2026-07-01",
      type: index % 2 ? "收入" : "支出",
      category: "",
      product: `流水-${index}`,
      amount: index
    }));
    const started = performance.now();
    const numbers = transactionBlockNumbers(rows);
    expect(numbers.at(-1)).toBe(25_000);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("uses original App red-growth and green-decline semantics", () => {
    expect(changeTone(1)).toBe("inflow");
    expect(changeTone(-1)).toBe("outflow");
    expect(changeTone(0)).toBeUndefined();
    expect(savingsColor(20)).toBe("var(--asset-track-inflow)");
    expect(savingsColor(-20)).toBe("var(--asset-track-outflow)");
    expect(INFLOW_COLOR).toContain("inflow");
    expect(OUTFLOW_COLOR).toContain("outflow");
    expect(reconciliationStatus(0.6)).toBe("平账");
    expect(reconciliationStatus(-99.99)).toBe("平账");
    expect(reconciliationStatus(100)).toBe("平账");
    expect(reconciliationStatus(-100)).toBe("平账");
    expect(reconciliationStatus(100.01)).toBe("多消费少收入");
    expect(reconciliationStatus(-100.01)).toBe("少收入多支出");
    expect(reconciliationStatus(0)).toBe("平账");
    expect(reconciliationStatus(null)).toBe("");
  });

  it("samples full history deterministically and preserves endpoints", () => {
    const rows = Array.from({ length: 36 }, (_, index) => annualRow(index));
    const sampled = sampleAnnualRows(rows, 12);
    expect(sampled).toHaveLength(12);
    expect(sampled[0]).toBe(rows[0]);
    expect(sampled.at(-1)).toBe(rows.at(-1));
    expect(sampleAnnualRows(rows, 12)).toEqual(sampled);
  });

  it("merges monthly and three-month anomaly comparisons by category", () => {
    const rows = buildAnomalyDisplayRows({
      category_changes: [
        {
          "对比口径": "较上月",
          "分类": "餐饮基础",
          "本月金额": 1300,
          "增减金额": 300,
          "增减比例": "30.0%"
        },
        {
          "对比口径": "较近3月均值",
          "分类": "餐饮基础",
          "本月金额": 1300,
          "增减金额": 216.7,
          "增减比例": "20.0%"
        }
      ],
      new_big_items: [{
        "商品": "相机",
        "分类": "大件大额",
        "金额": 8000,
        "判断": "过去 12 个月未出现的大额商品"
      }],
      missing_periodic: [{
        "分类": "固定订阅",
        "判断": "周期项本月未出现，建议确认是否漏记或已取消"
      }]
    });
    expect(rows).toEqual([
      {
        category: "大件大额",
        amount: 8000,
        situation: "相机：过去 12 个月未出现的大额商品"
      },
      {
        category: "餐饮基础",
        amount: 1300,
        situation: "¥300.0（上月30.0%，三月20.0%）"
      },
      {
        category: "固定订阅",
        amount: 0,
        situation: "周期项本月未出现，建议确认是否漏记或已取消"
      }
    ]);
  });
});
