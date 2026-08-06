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

export function normalizeDate(value: unknown, defaultMonth?: string): string {
  let raw = scalarText(value).trim();
  if (!raw && defaultMonth) raw = `${defaultMonth}-01`;
  raw = raw.split(/[T ]/, 1)[0]
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/[/.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (/^\d{4}-\d{1,2}$/.test(raw)) raw += "-01";
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!match) throw new AssetTrackError({ code: "date.invalid_format", status: 422 });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new AssetTrackError({ code: "date.invalid_format", status: 422 });
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
