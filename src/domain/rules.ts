import type { Transaction } from "../types";
import { scalarText } from "./text";

export const RULE_TYPES = new Set(["支出", "收入"]);

export function normalizeProductKey(value: unknown): string {
  return scalarText(value)
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, " ")
    .replace(/[|｜]+/g, "|");
}

export interface RuleRow {
  transaction_type: string;
  counterparty: string;
  product: string;
  category_key?: string;
  category: string;
}

function comparable(value: unknown): string {
  return normalizeProductKey(value);
}

export function rulesEquivalent(left: RuleRow, right: RuleRow): boolean {
  return left.transaction_type === right.transaction_type
    && comparable(left.counterparty) === comparable(right.counterparty)
    && comparable(left.product) === comparable(right.product);
}

export function rulesOverlap(left: RuleRow, right: RuleRow): boolean {
  if (left.transaction_type !== right.transaction_type) return false;
  return ["counterparty", "product"].every((field) => {
    const leftValue = comparable(left[field as keyof RuleRow]);
    const rightValue = comparable(right[field as keyof RuleRow]);
    return !leftValue || !rightValue || leftValue === rightValue;
  });
}

export function applyRules(rows: Transaction[], rules: RuleRow[]): Transaction[] {
  const ordered = [...rules].sort((left, right) =>
    Number(Boolean(right.counterparty)) + Number(Boolean(right.product))
    - Number(Boolean(left.counterparty)) - Number(Boolean(left.product))
  );
  return rows.map((row) => {
    const product = normalizeProductKey(row.product);
    const counterparty = normalizeProductKey(row.counterparty);
    const rule = ordered.find((candidate) =>
      candidate.transaction_type === row.type
      && (!candidate.product || normalizeProductKey(candidate.product) === product)
      && (
        !candidate.counterparty
        || normalizeProductKey(candidate.counterparty) === counterparty
      )
    );
    if (!rule) return { ...row };
    return {
      ...row,
      category_key: rule.category_key ?? null,
      category: rule.category
    };
  });
}
