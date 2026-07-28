import type { Transaction } from "../types";

export const RULE_TYPES = new Set(["支出", "收入"]);

export function normalizeProductKey(value: unknown): string {
  return String(value ?? "")
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
