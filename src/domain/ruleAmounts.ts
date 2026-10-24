import { finiteNumber } from "./money";
import type { RuleAmountFields } from "../types/rules";

export const EMPTY_RULE_AMOUNT: Required<RuleAmountFields> = {
  match_amount_minor: null,
  match_amount_min_minor: null,
  match_amount_max_minor: null,
  match_amount_min_exclusive: false,
  match_amount_max_exclusive: false
};
export interface RuleAmountBounds { min: number; max: number | null; }

/** All intervals are evaluated as inclusive integer cents. Open endpoints advance by one cent. */
export function ruleAmountBounds(rule: RuleAmountFields): RuleAmountBounds | null {
  const exact = rule.match_amount_minor ?? null;
  const min = rule.match_amount_min_minor ?? null;
  const max = rule.match_amount_max_minor ?? null;
  const exclusiveMin = rule.match_amount_min_exclusive ?? false;
  const exclusiveMax = rule.match_amount_max_exclusive ?? false;
  if ([exact, min, max].some((value) => value != null && (!Number.isSafeInteger(value) || value < 0))) return null;
  // SQLite returns booleans as 0/1. Reject other values at the domain boundary.
  if ([exclusiveMin, exclusiveMax].some((value) => ![false, true, 0, 1].includes(value))) return null;
  if (exact != null) return min != null || max != null || exclusiveMin || exclusiveMax ? null : { min: exact, max: exact };
  if ((min == null && exclusiveMin) || (max == null && exclusiveMax)) return null;
  const lower = (min ?? 0) + (exclusiveMin ? 1 : 0);
  const upper = max == null ? null : max - (exclusiveMax ? 1 : 0);
  if (!Number.isSafeInteger(lower) || (upper != null && lower > upper)) return null;
  return { min: lower, max: upper };
}

export function amountMinor(value: unknown): number {
  const minor = Math.round(finiteNumber(value) * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError("Invalid amount");
  return minor;
}

export function matchesRuleAmount(rule: RuleAmountFields, amount: unknown): boolean {
  const bounds = ruleAmountBounds(rule);
  if (!bounds) return false;
  if (bounds.min === 0 && bounds.max == null) return true;
  if (amount == null) return false;
  try {
    const minor = amountMinor(amount);
    return minor >= bounds.min && (bounds.max == null || minor <= bounds.max);
  } catch { return false; }
}

/** Exact prices beat ranges; ranges beat unrestricted conditions. */
export function ruleAmountSpecificity(rule: RuleAmountFields): number {
  const bounds = ruleAmountBounds(rule);
  if (!bounds || (bounds.min === 0 && bounds.max == null)) return 0;
  return bounds.min === bounds.max ? 2 : 1;
}

export function amountRangesOverlap(left: RuleAmountFields, right: RuleAmountFields): boolean {
  const a = ruleAmountBounds(left);
  const b = ruleAmountBounds(right);
  return Boolean(a && b && a.min <= (b.max ?? Infinity) && b.min <= (a.max ?? Infinity));
}

/** Canonical read adapter shared by rule reports, previews and persistence. */
export function readRuleAmountFields(row: Record<string, unknown>): Required<RuleAmountFields> {
  return {
    match_amount_minor: row.match_amount_minor == null ? null : Number(row.match_amount_minor),
    match_amount_min_minor: row.match_amount_min_minor == null ? null : Number(row.match_amount_min_minor),
    match_amount_max_minor: row.match_amount_max_minor == null ? null : Number(row.match_amount_max_minor),
    match_amount_min_exclusive: Boolean(row.match_amount_min_exclusive),
    match_amount_max_exclusive: Boolean(row.match_amount_max_exclusive)
  };
}
