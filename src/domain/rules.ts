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

type MatchableTransaction = Pick<Transaction, "type" | "counterparty" | "product">;

interface IndexedRule {
  rule: RuleRow;
  order: number;
}

function indexKey(type: string, value: string): string {
  return `${type}\u0000${value}`;
}

function exactIndexKey(type: string, counterparty: string, product: string): string {
  return `${type}\u0000${counterparty}\u0000${product}`;
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

/**
 * Provides indexed rule lookup while keeping the existing precedence and
 * source-order semantics of resolveRule.
 */
export class RuleMatcher {
  private readonly exact = new Map<string, IndexedRule[]>();
  private readonly product = new Map<string, IndexedRule[]>();
  private readonly counterparty = new Map<string, IndexedRule[]>();
  private readonly anyType = new Map<string, IndexedRule[]>();
  private readonly orderById = new Map<number, number>();

  constructor(rules: readonly RuleRow[]) {
    rules.forEach((rule, order) => {
      const id = Number(rule.id);
      if (Number.isFinite(id) && id > 0) this.orderById.set(id, order);
      const normalizedCounterparty = comparable(rule.counterparty);
      const normalizedProduct = comparable(rule.product);
      const level = ruleMatchLevel(rule);
      const indexed: IndexedRule = {
        rule,
        order
      };
      const target = level === "exact"
        ? this.exact
        : level === "product"
          ? this.product
          : level === "counterparty"
            ? this.counterparty
            : this.anyType;
      const key = level === "exact"
        ? exactIndexKey(rule.transaction_type, normalizedCounterparty, normalizedProduct)
        : level === "product" || level === "counterparty"
          ? indexKey(
            rule.transaction_type,
            level === "product" ? normalizedProduct : normalizedCounterparty
          )
          : rule.transaction_type;
      target.set(key, [...(target.get(key) ?? []), indexed]);
    });
  }

  orderedRuleIds(ids: Iterable<number>): number[] {
    return [...ids].sort((left, right) =>
      (this.orderById.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (this.orderById.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  matchingRules(row: MatchableTransaction): RuleRow[] {
    const normalizedCounterparty = comparable(row.counterparty);
    const normalizedProduct = comparable(row.product);
    const matches = [
      ...(this.anyType.get(row.type) ?? []),
      ...(normalizedCounterparty && normalizedProduct
        ? this.exact.get(exactIndexKey(row.type, normalizedCounterparty, normalizedProduct)) ?? []
        : []),
      ...(normalizedProduct
        ? this.product.get(indexKey(row.type, normalizedProduct)) ?? []
        : []),
      ...(normalizedCounterparty
        ? this.counterparty.get(indexKey(row.type, normalizedCounterparty)) ?? []
        : [])
    ];
    return matches
      .sort((left, right) => left.order - right.order)
      .map((candidate) => candidate.rule);
  }

  resolve(row: Transaction): RuleMatchExplanation {
    const byLevel = new Map<RuleMatchLevel, RuleRow[]>();
    for (const candidate of this.matchingRules(row)) {
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
  return new RuleMatcher(rules).resolve(row);
}

export function applyRulesWithIssues(
  rows: Transaction[],
  rules: RuleRow[]
): { proposed_rows: Transaction[]; issues: RuleApplicationIssue[] } {
  const matcher = new RuleMatcher(rules);
  const issues: RuleApplicationIssue[] = [];
  const proposed_rows = rows.map((row, rowIndex) => {
    const resolution = matcher.resolve(row);
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
