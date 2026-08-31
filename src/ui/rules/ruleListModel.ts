import { inferRuleScopeFromConditions } from "../../domain/rules";
import { scalarText } from "../../domain/text";
import type {
  RuleMatchScope,
  RuleTransactionType,
  SavedRule
} from "../../types/rules";

export type RuleListStatus = "正常" | "重复" | "冲突" | "分类已停用";
export type RuleGroupBy = "none" | "status" | "transaction_type" | "match_scope" | "category";

export interface RuleListFilters {
  query: string;
  transactionType: RuleTransactionType | "";
  status: RuleListStatus | "";
  scope: RuleMatchScope | "";
  categoryKey: string;
}

export const EMPTY_RULE_LIST_FILTERS: RuleListFilters = {
  query: "",
  transactionType: "",
  status: "",
  scope: "",
  categoryKey: ""
};

export const DEFAULT_RULE_SORT = {
  key: "occurrences",
  direction: "desc"
} as const;

const STATUS_RANK: Record<RuleListStatus, number> = {
  冲突: 0,
  重复: 1,
  分类已停用: 2,
  正常: 3
};

const SCOPE_RANK: Record<RuleMatchScope, number> = {
  merchant_product: 0,
  product: 1,
  merchant: 2
};

function normalizedSearchText(value: unknown): string {
  return scalarText(value).trim().toLocaleLowerCase("zh-CN");
}

export function ruleScope(rule: Pick<SavedRule, "match_scope" | "counterparty" | "product">): RuleMatchScope | null {
  return rule.match_scope ?? inferRuleScopeFromConditions(rule);
}

export function ruleListStatus(
  rule: Pick<SavedRule, "rule_status" | "category_active">
): RuleListStatus {
  if (rule.rule_status === "冲突") return "冲突";
  if (rule.rule_status === "重复") return "重复";
  if (rule.category_active === false) return "分类已停用";
  return "正常";
}

export function matchesRule(rule: SavedRule, filters: RuleListFilters): boolean {
  if (filters.transactionType && rule.transaction_type !== filters.transactionType) return false;
  if (filters.status && ruleListStatus(rule) !== filters.status) return false;
  if (filters.scope && ruleScope(rule) !== filters.scope) return false;
  if (filters.categoryKey && rule.category_key !== filters.categoryKey) return false;

  const query = normalizedSearchText(filters.query);
  if (!query) return true;
  return [
    rule.transaction_type,
    rule.counterparty,
    rule.product,
    rule.rewrite_merchant,
    rule.rewrite_product,
    rule.category
  ].some((value) => normalizedSearchText(value).includes(query));
}

export function ruleSortValue(rule: SavedRule, key: string): unknown {
  switch (key) {
    case "status":
      return STATUS_RANK[ruleListStatus(rule)];
    case "match_scope": {
      const scope = ruleScope(rule);
      return scope ? SCOPE_RANK[scope] : SCOPE_RANK.merchant + 1;
    }
    case "category":
      return rule.category;
    case "last_used_date":
      return rule.last_used_date ?? rule.last_month ?? "";
    case "occurrences":
      return rule.occurrences ?? 0;
    case "id":
      return rule.id ?? Number.MAX_SAFE_INTEGER;
    default:
      return rule[key as keyof SavedRule];
  }
}

export function ruleGroupKey(rule: SavedRule, groupBy: RuleGroupBy): string {
  switch (groupBy) {
    case "status":
      return ruleListStatus(rule);
    case "transaction_type":
      return rule.transaction_type;
    case "match_scope":
      return ruleScope(rule) ?? "unset";
    case "category":
      return rule.category_key || rule.category || "unset";
    default:
      return "all";
  }
}
