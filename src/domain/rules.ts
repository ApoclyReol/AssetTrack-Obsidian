import type {
  RuleApplicationIssue,
  RuleMatchExplanation,
  RuleMatchLevel,
  Transaction
} from "../types";
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
  id?: number;
  transaction_type: string;
  counterparty: string;
  product: string;
  category_key?: string;
  category: string;
}

function comparable(value: unknown): string {
  return normalizeProductKey(value);
}

export function ruleMatchLevel(rule: Pick<RuleRow, "counterparty" | "product">): RuleMatchLevel | null {
  const hasCounterparty = Boolean(comparable(rule.counterparty));
  const hasProduct = Boolean(comparable(rule.product));
  if (hasCounterparty && hasProduct) return "exact";
  if (hasProduct) return "product";
  if (hasCounterparty) return "counterparty";
  return null;
}

function ruleSpecificity(level: RuleMatchLevel): number {
  return level === "exact" ? 3 : level === "product" ? 2 : 1;
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

export function resolveRule(row: Transaction, rules: RuleRow[]): RuleMatchExplanation {
  const product = normalizeProductKey(row.product);
  const counterparty = normalizeProductKey(row.counterparty);
  const matches = rules.filter((candidate) =>
    candidate.transaction_type === row.type
    && (!comparable(candidate.product) || comparable(candidate.product) === product)
    && (!comparable(candidate.counterparty) || comparable(candidate.counterparty) === counterparty)
  );
  const byLevel = new Map<RuleMatchLevel, RuleRow[]>();
  for (const candidate of matches) {
    const level = ruleMatchLevel(candidate);
    if (!level) continue;
    const existing = byLevel.get(level) ?? [];
    existing.push(candidate);
    byLevel.set(level, existing);
  }
  const tiers: Array<{ level: RuleMatchLevel; candidates: RuleRow[] }> = [
    { level: "exact", candidates: byLevel.get("exact") ?? [] },
    { level: "product", candidates: byLevel.get("product") ?? [] },
    { level: "counterparty", candidates: byLevel.get("counterparty") ?? [] }
  ];
  for (const tier of tiers) {
    const { level, candidates } = tier;
    if (!candidates.length) continue;
    const categories = new Set(candidates.map((candidate) =>
      comparable(candidate.category_key) || comparable(candidate.category)
    ));
    const ruleIds = candidates
      .map((candidate) => Number(candidate.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (categories.size > 1) {
      return {
        status: "conflict",
        level,
        rule_ids: ruleIds,
        reason: `同一${level === "exact" ? "精确" : level === "product" ? "商品" : "交易对方"}匹配层级命中了不同分类`
      };
    }
    const selected = candidates[0];
    return {
      status: "matched",
      level,
      rule_ids: ruleIds,
      category_key: selected.category_key ?? null,
      category: selected.category,
      reason: `${level === "exact" ? "精确" : level === "product" ? "商品" : "交易对方"}规则确定命中`
    };
  }
  return {
    status: "none",
    rule_ids: [],
    reason: "没有匹配规则"
  };
}

export function applyRulesWithIssues(
  rows: Transaction[],
  rules: RuleRow[]
): { proposed_rows: Transaction[]; issues: RuleApplicationIssue[] } {
  const issues: RuleApplicationIssue[] = [];
  const proposed_rows = rows.map((row, rowIndex) => {
    const resolution = resolveRule(row, rules);
    if (resolution.status === "conflict") {
      issues.push({
        row_index: rowIndex,
        row_id: row.id,
        rule_ids: resolution.rule_ids,
        reason: resolution.reason,
        level: resolution.level
      });
      return { ...row };
    }
    if (resolution.status !== "matched") return { ...row };
    return {
      ...row,
      category_key: resolution.category_key ?? null,
      category: resolution.category ?? ""
    };
  });
  return { proposed_rows, issues };
}

export function applyRules(rows: Transaction[], rules: RuleRow[]): Transaction[] {
  return applyRulesWithIssues(rows, rules).proposed_rows;
}

export function rulePriority(rule: RuleRow): number {
  const level = ruleMatchLevel(rule);
  return level ? ruleSpecificity(level) : 0;
}
