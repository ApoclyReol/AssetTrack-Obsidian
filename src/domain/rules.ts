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
  /** Legacy schema field. Rule matching deliberately ignores transaction parties. */
  counterparty?: string;
  product: string;
  category_key?: string;
  category: string;
}

function comparable(value: unknown): string {
  return normalizeProductKey(value);
}

type MatchableTransaction = Pick<Transaction, "type" | "product">;

interface IndexedRule {
  rule: RuleRow;
  order: number;
}

function indexKey(type: string, value: string): string {
  return `${type}\u0000${value}`;
}

export function ruleMatchLevel(rule: Pick<RuleRow, "product">): RuleMatchLevel | null {
  return comparable(rule.product) ? "product" : null;
}

export class RuleMatcher {
  private readonly product = new Map<string, IndexedRule[]>();
  private readonly orderById = new Map<number, number>();

  constructor(rules: readonly RuleRow[]) {
    rules.forEach((rule, order) => {
      const id = Number(rule.id);
      if (Number.isFinite(id) && id > 0) this.orderById.set(id, order);
      const normalizedProduct = comparable(rule.product);
      const level = ruleMatchLevel(rule);
      if (!level) return;
      const indexed: IndexedRule = {
        rule,
        order
      };
      const key = indexKey(rule.transaction_type, normalizedProduct);
      this.product.set(key, [...(this.product.get(key) ?? []), indexed]);
    });
  }

  orderedRuleIds(ids: Iterable<number>): number[] {
    return [...ids].sort((left, right) =>
      (this.orderById.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (this.orderById.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  matchingRules(row: MatchableTransaction): RuleRow[] {
    const normalizedProduct = comparable(row.product);
    if (!normalizedProduct) return [];
    return (this.product.get(indexKey(row.type, normalizedProduct)) ?? [])
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
    const candidates = byLevel.get("product") ?? [];
    if (candidates.length) {
      const categories = new Set(candidates.map((candidate) =>
        comparable(candidate.category_key) || comparable(candidate.category)
      ));
      const ruleIds = candidates
        .map((candidate) => Number(candidate.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (categories.size > 1) {
        return {
          status: "conflict",
          level: "product",
          rule_ids: ruleIds,
          reason: "同一商品匹配到了不同分类"
        };
      }
      const selected = candidates[0];
      return {
        status: "matched",
        level: "product",
        rule_ids: ruleIds,
        category_key: selected.category_key ?? null,
        category: selected.category,
        reason: "商品规则确定命中"
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
    && Boolean(comparable(left.product))
    && comparable(left.product) === comparable(right.product);
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
  return level ? 1 : 0;
}
