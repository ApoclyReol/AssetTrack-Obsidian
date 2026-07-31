import type { AssetTrackLocale } from "../i18n";

export interface MoneyFormatOptions {
  locale: AssetTrackLocale;
  currency: string;
  currencyFormat: "standard" | "accounting";
}

let currentOptions: MoneyFormatOptions = {
  locale: "zh-CN",
  currency: "CNY",
  currencyFormat: "standard"
};

export function configureMoneyFormat(options: MoneyFormatOptions): void {
  currentOptions = options;
}

export function money(value: unknown, direction: MoneyDirection = "neutral"): string {
  return formatMoney(value, currentOptions, direction);
}

export type MoneyDirection =
  | "income"
  | "expense"
  | "neutral"
  | "收入"
  | "支出"
  | "代付"
  | "加仓"
  | "提现";

export function signedMoneyValue(value: number, direction: MoneyDirection): number {
  const amount = Math.abs(value);
  return ["expense", "支出", "代付", "加仓"].includes(direction) ? -amount : amount;
}

export function formatMoney(
  value: unknown,
  options: MoneyFormatOptions,
  direction: MoneyDirection = "neutral"
): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  const displayValue = direction === "neutral"
    ? parsed
    : signedMoneyValue(parsed, direction);
  return new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currency,
    currencySign: options.currencyFormat,
    maximumFractionDigits: 1
  }).format(displayValue);
}

export function isCurrencyCode(value: string): boolean {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: value }).format(0);
    return /^[A-Z]{3}$/.test(value);
  } catch {
    return false;
  }
}
