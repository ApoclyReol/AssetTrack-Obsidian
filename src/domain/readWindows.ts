import type { ReadWindow, ReadWindowKind } from "../types/readWindows";
import { isMonth, monthEnd, normalizeDate, shiftMonth } from "./dates";

export const MONTHLY_ANALYSIS_MONTHS = 12;
export const PRODUCT_OVERVIEW_MONTHS = 12;
export const SYSTEM_CHECK_MONTHS = 60;
export const ANNUAL_TREND_TARGET_MONTHS = 18;

export function monthCount(fromMonth: string, toMonth: string): number {
  if (!isMonth(fromMonth) || !isMonth(toMonth) || fromMonth > toMonth) return 0;
  return (Number(toMonth.slice(0, 4)) - Number(fromMonth.slice(0, 4))) * 12
    + Number(toMonth.slice(5)) - Number(fromMonth.slice(5)) + 1;
}

export function createMonthReadWindow(
  kind: ReadWindowKind,
  fromMonth: string,
  toMonth: string
): ReadWindow {
  return {
    kind,
    from_month: fromMonth,
    to_month: toMonth,
    from_date: `${fromMonth}-01`,
    to_date: monthEnd(toMonth),
    month_count: monthCount(fromMonth, toMonth)
  };
}

export function createDateReadWindow(
  kind: ReadWindowKind,
  fromDate: string,
  toDate: string
): ReadWindow {
  const normalizedFrom = normalizeDate(fromDate);
  const normalizedTo = normalizeDate(toDate);
  return {
    kind,
    from_month: normalizedFrom.slice(0, 7),
    to_month: normalizedTo.slice(0, 7),
    from_date: normalizedFrom,
    to_date: normalizedTo,
    month_count: monthCount(normalizedFrom.slice(0, 7), normalizedTo.slice(0, 7))
  };
}

export function recentMonthReadWindow(
  kind: ReadWindowKind,
  latestMonth: string | undefined,
  months: number
): ReadWindow | null {
  if (!latestMonth || !isMonth(latestMonth) || months < 1) return null;
  return createMonthReadWindow(kind, shiftMonth(latestMonth, -(months - 1)), latestMonth);
}

export function sampleMonths(months: string[], target = ANNUAL_TREND_TARGET_MONTHS): string[] {
  const ordered = [...new Set(months)].filter(isMonth).sort();
  if (ordered.length <= target) return ordered;
  const indexes = new Set<number>([0, ordered.length - 1]);
  for (let index = 1; index < target - 1; index += 1) {
    indexes.add(Math.round((index * (ordered.length - 1)) / (target - 1)));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => ordered[index]);
}
