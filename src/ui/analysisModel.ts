import type {
  AnnualRow,
  CategoryDefinition,
  Transaction
} from "../types";

export const INFLOW_COLOR = "#D94F45";
export const OUTFLOW_COLOR = "#2CA58D";

export const TRANSACTION_SECTIONS: Transaction["type"][] = [
  "支出",
  "收入",
  "代付",
  "加仓",
  "提现"
];

export function createTransactionDraft(
  type: Transaction["type"],
  month: string,
  categories: CategoryDefinition[],
  clientId: string = crypto.randomUUID()
): Transaction {
  const category = ["收入", "支出"].includes(type)
    ? categories.find(
        (row) => row.is_active && row.transaction_type === type
      )
    : undefined;
  return {
    client_id: clientId,
    transaction_date: `${month}-01`,
    type,
    category_key: category?.category_key ?? null,
    category: category?.name ?? "",
    product: "",
    amount: 0
  };
}

export function transactionIndexes(
  rows: Transaction[],
  type: Transaction["type"]
): number[] {
  return rows.flatMap((row, index) => row.type === type ? [index] : []);
}

export function changeTone(
  value: unknown
): "inflow" | "outflow" | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return undefined;
  return parsed > 0 ? "inflow" : "outflow";
}

export function savingsColor(value: number | null): string {
  return (value ?? 0) >= 0 ? INFLOW_COLOR : OUTFLOW_COLOR;
}

export function sampleAnnualRows(
  rows: AnnualRow[],
  target = 18
): AnnualRow[] {
  if (rows.length <= target) return rows;
  const indexes = new Set<number>([0, rows.length - 1]);
  for (let index = 1; index < target - 1; index += 1) {
    indexes.add(Math.round((index * (rows.length - 1)) / (target - 1)));
  }
  return [...indexes].sort((a, b) => a - b).map((index) => rows[index]);
}
