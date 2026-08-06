import type {
  MonthSection,
  MonthWorkspace
} from "../types/month";
import { AssetTrackError } from "../application/errors";
import { monthEnd, previousMonth } from "../domain/dates";
import { roundHalfEven, sum } from "../domain/money";
import { MAX_IMPORT_FILE_BYTES } from "./csvImportCommit";

export type MonthMetrics = {
  asset: number;
  income: number;
  expense: number;
  discrepancy: number | null;
};

export const MONTH_SECTIONS: MonthSection[] = [
  "assets",
  "transactions",
  "debts",
  "fixed_assets"
];

export type DraftAction =
  | { type: "reset"; workspace: MonthWorkspace }
  | { type: "edit"; workspace: MonthWorkspace };

export function draftReducer(
  _state: MonthWorkspace | null,
  action: DraftAction
): MonthWorkspace | null {
  return action.workspace;
}

export async function readImportFile(file: File): Promise<ArrayBuffer> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new AssetTrackError({
      code: "import.file_too_large",
      status: 422,
      params: { limitMiB: 20 }
    });
  }
  return file.arrayBuffer();
}

export function draftMonthMetrics(workspace: MonthWorkspace): MonthMetrics {
  const income = sum(workspace.transactions
    .filter((row) => row.type === "收入")
    .map((row) => Number(row.amount) || 0));
  const allOut = sum(workspace.transactions
    .filter((row) => row.type === "支出")
    .map((row) => Number(row.amount) || 0));
  const daifu = sum(workspace.transactions
    .filter((row) => row.type === "代付")
    .map((row) => Number(row.amount) || 0));
  const expense = roundHalfEven(allOut - daifu);
  const currentMonthEnd = monthEnd(workspace.month);
  const asset = roundHalfEven(
    sum(workspace.cash_accounts.map((row) => Number(row.balance) || 0))
    - draftDebtActiveAt(workspace.debts, currentMonthEnd, currentMonthEnd)
    + sum(workspace.investment_accounts.map((row) => Number(row.principal) || 0))
  );
  const theoretical = workspace.overview.reconciliation?.available
    && workspace.overview.reconciliation.theoretical.previous_cash !== null
    ? workspace.overview.reconciliation.theoretical.previous_cash
      + income
      + draftDebtChange(workspace)
      - sum(workspace.cash_accounts.map((row) => Number(row.balance) || 0))
      - sum(workspace.transactions
        .filter((row) => row.type === "加仓")
        .map((row) => Number(row.amount) || 0))
      + sum(workspace.transactions
        .filter((row) => row.type === "提现")
        .map((row) => Number(row.amount) || 0))
    : null;
  return {
    asset,
    income,
    expense,
    discrepancy: theoretical === null ? null : roundHalfEven(expense - theoretical)
  };
}

function normalizedDebtDate(value: string | null | undefined): string {
  return String(value ?? "").replace(/\//g, "-");
}

function draftDebtPaidDate(
  row: MonthWorkspace["debts"][number],
  currentMonthEnd: string
): string | null {
  const paidDate = normalizedDebtDate(row.paid_date);
  if (row.is_paid) return paidDate || currentMonthEnd;
  return paidDate && paidDate > currentMonthEnd ? paidDate : null;
}

function draftDebtActiveAt(
  rows: MonthWorkspace["debts"],
  boundary: string,
  currentMonthEnd: string
): number {
  return sum(rows.map((row) => {
    const startDate = normalizedDebtDate(row.start_date);
    if (!startDate || startDate > boundary) return 0;
    const paidDate = draftDebtPaidDate(row, currentMonthEnd);
    if (paidDate && paidDate <= boundary) return 0;
    return Number(row.amount) || 0;
  }));
}

function draftDebtChange(workspace: MonthWorkspace): number {
  const previous = previousMonth(workspace.month);
  if (!previous) return 0;
  const currentMonthEnd = monthEnd(workspace.month);
  const previousMonthEnd = monthEnd(previous);
  return roundHalfEven(
    draftDebtActiveAt(workspace.debts, currentMonthEnd, currentMonthEnd)
    - draftDebtActiveAt(workspace.debts, previousMonthEnd, currentMonthEnd)
  );
}

export function isEmptyMonthDraft(workspace: MonthWorkspace, dirty: boolean): boolean {
  return workspace.status === "draft"
    && !dirty
    && workspace.transactions.length === 0
    && workspace.cash_accounts.every((account) => Number(account.balance) === 0)
    && workspace.investment_accounts.every((account) =>
      Number(account.principal) === 0
      && Number(account.market_value) === 0
      && Number(account.cash_balance) === 0
    );
}
