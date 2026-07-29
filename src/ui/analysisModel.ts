import type {
  AnnualRow,
  CategoryDefinition,
  MonthOverview,
  Transaction
} from "../types";

export const INFLOW_COLOR = "var(--asset-track-inflow)";
export const OUTFLOW_COLOR = "var(--asset-track-outflow)";

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
  return {
    client_id: clientId,
    transaction_date: `${month}-01`,
    type,
    category_key: null,
    category: "",
    counterparty: "",
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

export function transactionBlockNumber(
  rows: Transaction[],
  index: number
): number {
  const type = rows[index]?.type;
  if (!type) return 0;
  return rows.slice(0, index + 1).filter((row) => row.type === type).length;
}

export function transactionBlockNumbers(rows: Transaction[]): number[] {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const next = (counts.get(row.type) ?? 0) + 1;
    counts.set(row.type, next);
    return next;
  });
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

export function reconciliationStatus(
  value: number | null
): "多消费少支出" | "少消费多支出" | "平账" | "" {
  if (value === null || !Number.isFinite(value)) return "";
  if (Math.abs(value) < 100) return "平账";
  if (value > 0) return "多消费少支出";
  if (value < 0) return "少消费多支出";
  return "平账";
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

export interface AnomalyDisplayRow {
  category: string;
  amount: number;
  situation: string;
}

function signedAmount(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${parsed > 0 ? "+" : ""}${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1
  }).format(parsed)}`;
}

export function buildAnomalyDisplayRows(
  anomalies: MonthOverview["anomalies"]
): AnomalyDisplayRow[] {
  if (!anomalies) return [];
  const grouped = new Map<string, Array<Record<string, string | number>>>();
  anomalies.category_changes.forEach((row) => {
    const category = String(row["分类"] ?? "");
    if (!category) return;
    const values = grouped.get(category) ?? [];
    values.push(row);
    grouped.set(category, values);
  });
  const result = [...grouped].map(([category, rows]) => {
    const previous = rows.find((row) => row["对比口径"] === "较上月");
    const threeMonth = rows.find((row) => row["对比口径"] === "较近3月均值");
    const primary = previous ?? threeMonth ?? rows[0];
    const comparisons = [
      previous ? `上月${String(previous["增减比例"] ?? "")}` : "",
      threeMonth ? `三月${String(threeMonth["增减比例"] ?? "")}` : ""
    ].filter(Boolean);
    return {
      category,
      amount: Number(primary["本月金额"] ?? 0),
      situation: `${signedAmount(primary["增减金额"])}${
        comparisons.length ? `（${comparisons.join("，")}）` : ""
      }`
    };
  });
  const existing = new Set(result.map((row) => row.category));
  anomalies.new_big_items.forEach((row) => {
    const category = String(row["分类"] ?? "");
    const product = String(row["商品"] ?? "");
    if (!category) return;
    const detail = `${product ? `${product}：` : ""}${
      String(row["判断"] ?? "出现新的大额商品")
    }`;
    const current = result.find((item) => item.category === category);
    if (current) {
      current.situation = `${current.situation}；${detail}`;
      return;
    }
    existing.add(category);
    result.push({
      category,
      amount: Number(row["金额"] ?? 0),
      situation: detail
    });
  });
  anomalies.missing_periodic.forEach((row) => {
    const category = String(row["分类"] ?? "");
    if (!category || existing.has(category)) return;
    existing.add(category);
    result.push({
      category,
      amount: 0,
      situation: String(row["判断"] ?? "周期项本月未出现")
    });
  });
  return result.sort((left, right) =>
    Math.abs(right.amount) - Math.abs(left.amount)
    || left.category.localeCompare(right.category)
  );
}
