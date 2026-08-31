import { scalarText } from "./text";
import { AssetTrackError } from "../application/errors";

export function isMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

export function nextMonth(month: string): string {
  if (!isMonth(month)) throw new AssetTrackError({ code: "month.invalid", status: 422, params: { month } });
  const year = Number(month.slice(0, 4));
  const value = Number(month.slice(5));
  return value === 12
    ? `${String(year + 1).padStart(4, "0")}-01`
    : `${String(year).padStart(4, "0")}-${String(value + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string | null {
  if (!isMonth(month)) return null;
  const year = Number(month.slice(0, 4));
  const value = Number(month.slice(5));
  return value === 1
    ? `${String(year - 1).padStart(4, "0")}-12`
    : `${String(year).padStart(4, "0")}-${String(value - 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  if (!isMonth(month)) throw new AssetTrackError({ code: "month.invalid", status: 422, params: { month } });
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + delta;
  const year = Math.floor(index / 12);
  const value = index % 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(value).padStart(2, "0")}`;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function invalidDate(): never {
  throw new AssetTrackError({ code: "date.invalid_format", status: 422 });
}

function formatDateParts({ year, month, day }: DateParts): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999
    || !Number.isInteger(month) || !Number.isInteger(day)) {
    return invalidDate();
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return invalidDate();
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datePartsFromYearLast(
  first: number,
  second: number,
  year: number
): DateParts {
  let month = first;
  let day = second;
  // If both components are at most 12, the two orders are indistinguishable.
  // Keep the Excel-style month/day/year convention instead of using the target
  // month, which could turn a genuinely cross-month row into an in-month row.
  if (first > 12 && second <= 12) {
    month = second;
    day = first;
  } else if (second > 12 && first <= 12) {
    month = first;
    day = second;
  }
  return { year, month, day };
}

function expandTwoDigitYear(year: number): number {
  return year >= 70 ? 1900 + year : 2000 + year;
}

function parseDateParts(value: string): DateParts | null {
  const normalized = value
    .replace(/[／]/g, "/")
    .replace(/[．。]/g, ".")
    .replace(/[－–—]/g, "-")
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/[/.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(normalized);
  if (compact) {
    return {
      year: Number(compact[1]),
      month: Number(compact[2]),
      day: Number(compact[3])
    };
  }
  const yearFirst = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (yearFirst) {
    return {
      year: Number(yearFirst[1]),
      month: Number(yearFirst[2]),
      day: Number(yearFirst[3])
    };
  }
  const yearMonth = /^(\d{4})-(\d{1,2})$/.exec(normalized);
  if (yearMonth) {
    return {
      year: Number(yearMonth[1]),
      month: Number(yearMonth[2]),
      day: 1
    };
  }
  const yearLast = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(normalized);
  if (yearLast) {
    return datePartsFromYearLast(
      Number(yearLast[1]),
      Number(yearLast[2]),
      Number(yearLast[3])
    );
  }
  const shortYearLast = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(normalized);
  if (shortYearLast) {
    return datePartsFromYearLast(
      Number(shortYearLast[1]),
      Number(shortYearLast[2]),
      expandTwoDigitYear(Number(shortYearLast[3]))
    );
  }
  return null;
}

function parseExcelSerialDate(value: string): string | null {
  if (!/^\d{5,7}(?:\.\d+)?$/.test(value)) return null;
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const wholeDays = Math.floor(serial);
  if (wholeDays === 60) return null;
  const epoch = wholeDays < 60
    ? Date.UTC(1899, 11, 31)
    : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + wholeDays * 86_400_000);
  return formatDateParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
}

export function normalizeDate(value: unknown, defaultMonth?: string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return invalidDate();
    return formatDateParts({
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate()
    });
  }
  let raw = scalarText(value).trim();
  if (!raw && defaultMonth) raw = `${defaultMonth}-01`;
  const dateText = raw.split(/[Tt\s]/u, 1)[0];
  const excelDate = parseExcelSerialDate(dateText);
  if (excelDate) return excelDate;
  const parts = parseDateParts(dateText);
  if (!parts) return invalidDate();
  return formatDateParts(parts);
}

export function monthEnd(month: string): string {
  if (!isMonth(month)) throw new AssetTrackError({ code: "month.invalid", status: 422, params: { month } });
  const year = Number(month.slice(0, 4));
  const value = Number(month.slice(5));
  const day = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function localMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function localTimestamp(now = new Date()): string {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join(":");
  return `${date} ${time}`;
}
