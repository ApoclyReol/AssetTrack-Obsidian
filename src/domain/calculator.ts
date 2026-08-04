import type {
  AnnualRow,
  CategoryDefinition,
  ReconciliationExplanation,
  Transaction
} from "../types";
import { previousMonth, shiftMonth } from "./dates";
import { roundHalfEven, sum } from "./money";

export interface MonthlyCalculation {
  category_summary: Record<string, number>;
  all_out: number;
  total_daifu: number;
  total_expense: number;
  total_income: number;
  total_deposit: number;
  total_withdraw: number;
  structure: {
    necessary: number;
    controlled: number;
    periodic: number;
    daily: number;
    occasional: number;
  };
  big_tickets: Array<{ product: string; amount: number; category: string }>;
}

export const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  "基本饮食": "餐饮基础",
  "升级饮食": "餐饮改善",
  "生活品质提升": "生活品质"
};

export function calculateMonthly(
  rows: Transaction[],
  categories: CategoryDefinition[],
  largeExpenseThreshold = 1000
): MonthlyCalculation {
  const metadata = new Map(categories.map((row) => [row.name, row]));
  const categorySummary: Record<string, number> = {};
  const structure = {
    necessary: 0,
    controlled: 0,
    periodic: 0,
    daily: 0,
    occasional: 0
  };
  const bigTickets: MonthlyCalculation["big_tickets"] = [];
  for (const row of rows) {
    if (row.type !== "支出") continue;
    const category = LEGACY_CATEGORY_ALIASES[row.category] ?? row.category ?? "";
    categorySummary[category] = (categorySummary[category] ?? 0) + Number(row.amount || 0);
    const definition = metadata.get(category);
    const amount = Number(row.amount || 0);
    if (definition?.is_big_ticket || amount >= largeExpenseThreshold) {
      bigTickets.push({ product: row.product, amount, category });
    }
    const necessity = definition?.necessity ?? "必要";
    const pattern = definition?.pattern ?? "偶尔";
    if (necessity === "必要") structure.necessary += amount;
    if (necessity === "可控") structure.controlled += amount;
    if (pattern === "周期") structure.periodic += amount;
    if (pattern === "日常") structure.daily += amount;
    if (pattern === "偶尔") structure.occasional += amount;
  }
  const allOut = sum(rows.filter((row) => row.type === "支出").map((row) => row.amount));
  const daifu = sum(rows.filter((row) => row.type === "代付").map((row) => row.amount));
  return {
    category_summary: Object.fromEntries(
      Object.entries(categorySummary).map(([key, value]) => [key, roundHalfEven(value)])
    ),
    all_out: allOut,
    total_daifu: daifu,
    total_expense: roundHalfEven(allOut - daifu),
    total_income: sum(rows.filter((row) => row.type === "收入").map((row) => row.amount)),
    total_deposit: sum(rows.filter((row) => row.type === "加仓").map((row) => row.amount)),
    total_withdraw: sum(rows.filter((row) => row.type === "提现").map((row) => row.amount)),
    structure: Object.fromEntries(
      Object.entries(structure).map(([key, value]) => [key, roundHalfEven(value)])
    ) as MonthlyCalculation["structure"],
    big_tickets: bigTickets.sort((left, right) => right.amount - left.amount)
  };
}

export interface AnnualInput {
  month: string;
  cash: number;
  debt: number;
  principal: number;
  market_value: number;
  investment_cash: number;
  monthly: MonthlyCalculation;
}

export interface ExtendedAnnualRow extends AnnualRow {
  cash_delta: number | null;
  asset_delta: number | null;
  inv_profit_delta: number | null;
  debt_change: number | null;
  theoretical_expense: number | null;
  prev_month_valid: boolean;
}

export function buildAnnualRows(inputs: AnnualInput[]): ExtendedAnnualRow[] {
  return inputs
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((input, index, all) => {
      const position = input.market_value + input.investment_cash;
      const profit = position - input.principal;
      const totalAssets = input.cash - input.debt + input.principal;
      const marketNetAssets = input.cash - input.debt + position;
      const previous = index > 0 ? all[index - 1] : null;
      const previousPosition = previous
        ? previous.market_value + previous.investment_cash : 0;
      const previousProfit = previousPosition - (previous?.principal ?? 0);
      const consecutive = Boolean(previous && previousMonth(input.month) === previous.month);
      const debtChange = consecutive ? input.debt - (previous?.debt ?? 0) : null;
      const theoretical = consecutive
        ? (previous?.cash ?? 0)
          + input.monthly.total_income
          + (debtChange ?? 0)
          - input.cash
          - input.monthly.total_deposit
          + input.monthly.total_withdraw
        : null;
      const savingsRate = input.monthly.total_income > 0
        ? (input.monthly.total_income - input.monthly.total_expense)
          / input.monthly.total_income * 100
        : null;
      return {
        month: input.month,
        cash: roundHalfEven(input.cash),
        debt: roundHalfEven(input.debt),
        principal: roundHalfEven(input.principal),
        inv_position: roundHalfEven(position),
        cost_assets: roundHalfEven(totalAssets),
        market_net_assets: roundHalfEven(marketNetAssets),
        total_assets: roundHalfEven(totalAssets),
        inv_profit: roundHalfEven(profit),
        inv_roi: roundHalfEven(input.principal > 0 ? profit / input.principal * 100 : 0),
        inv_weight: roundHalfEven(position > 0 ? input.market_value / position * 100 : 0),
        total_income: input.monthly.total_income,
        total_expense: input.monthly.total_expense,
        savings_rate: savingsRate === null ? null : roundHalfEven(savingsRate),
        total_deposit: input.monthly.total_deposit,
        total_withdraw: input.monthly.total_withdraw,
        all_out: input.monthly.all_out,
        total_daifu: input.monthly.total_daifu,
        necessary: input.monthly.structure.necessary,
        controlled: input.monthly.structure.controlled,
        periodic: input.monthly.structure.periodic,
        daily: input.monthly.structure.daily,
        occasional: input.monthly.structure.occasional,
        discrepancy: theoretical === null
          ? null
          : roundHalfEven(input.monthly.total_expense - theoretical),
        prev_month_valid: consecutive,
        cash_delta: consecutive ? roundHalfEven(input.cash - (previous?.cash ?? 0)) : null,
        asset_delta: consecutive
          ? roundHalfEven(totalAssets - (
            (previous?.cash ?? 0) - (previous?.debt ?? 0) + (previous?.principal ?? 0)
          ))
          : null,
        inv_profit_delta: consecutive ? roundHalfEven(profit - previousProfit) : null,
        debt_change: debtChange === null ? null : roundHalfEven(debtChange),
        theoretical_expense: theoretical === null ? null : roundHalfEven(theoretical)
      };
    });
}

export function explainReconciliation(
  discrepancy: number | null,
  tolerance = 100
): ReconciliationExplanation {
  if (discrepancy === null || !Number.isFinite(discrepancy)) {
    return {
      level: "info",
      title: "暂无连续月份基准",
      summary: "首月或断月时不计算理论净支出和对账差额。",
      causes: [],
      suggestions: ["补齐上月现金快照后再进行跨月对账。"]
    };
  }
  if (Math.abs(discrepancy) < 0.01) {
    return {
      level: "success",
      title: "账目完全对齐",
      summary: "实际净支出与资产推导出的理论净支出一致。",
      causes: [],
      suggestions: []
    };
  }
  if (Math.abs(discrepancy) <= tolerance) {
    return {
      level: "success",
      title: "差额可忽略",
      summary: "当前差额在设置的平账容差以内。",
      causes: [],
      suggestions: []
    };
  }
  const positive = discrepancy > 0;
  return {
    level: "error",
    title: "存在需要排查的对账差额",
    summary: `当前差额超出平账容差，方向为${positive ? "实际流水偏高" : "资产推导偏高"}。`,
    causes: positive
      ? [
        "流水记录的净支出高于资产变动推导值。",
        "可能存在漏记收入、现金快照偏高、支出重复记录，或代付抵扣没有正确标记。"
      ]
      : [
        "资产变动推导出的理论净支出高于流水记录。",
        "可能存在漏记消费、现金快照偏低、加仓/提现类型错误，或代付被错误抵扣。"
      ],
    suggestions: positive
      ? [
        "优先检查本月大额支出是否重复导入。",
        "检查收入、退款、红包、转账回款是否漏记为收入或代付。",
        "复核月底现金快照是否多填了账户余额。"
      ]
      : [
        "优先检查是否有现金消费、自动扣款或小额多笔消费漏记。",
        "检查加仓、提现是否被误标为普通支出或收入。",
        "复核月底现金快照是否少填了账户余额。"
      ]
  };
}

export function previousMonths(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(month, index - count));
}
