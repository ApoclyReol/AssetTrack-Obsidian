import type { CategoryDefinition } from "./configuration";
import type { ReadWindow } from "./readWindows";

export type RuleMatchScope = "product" | "merchant" | "merchant_product";
export type RuleMatchLevel = RuleMatchScope;

export type ProductCategoryStatus = "正常" | "停用" | "未分类" | "混合";

export interface HistoricalCategoryCount {
  category_key?: string | null;
  category: string;
  occurrences: number;
  is_active?: boolean;
}

export interface RuleMatchExplanation {
  status: "none" | "matched" | "conflict";
  level?: RuleMatchLevel;
  rule_ids: number[];
  selected_rule_id?: number | null;
  category_key?: string | null;
  category?: string;
  rewrite_merchant?: string | null;
  rewrite_product?: string | null;
  covered_rule_ids?: number[];
  reason: string;
}

export interface RuleApplicationIssue {
  row_index: number;
  row_id?: number;
  rule_ids: number[];
  reason: string;
  level?: RuleMatchLevel;
}

export interface RuleChainIssue {
  rule_id: number | null;
  target_rule_ids: number[];
  fields: Array<"counterparty" | "product">;
  reason: string;
}

export interface RuleCandidate {
  transaction_type: "支出" | "收入";
  product: string;
  product_key?: string;
  variants: string[];
  category: string;
  category_key?: string | null;
  category_counts?: HistoricalCategoryCount[];
  category_confidence: number;
  has_category_conflict: boolean;
  occurrences: number;
  months_count: number;
  last_month: string;
  match_level?: RuleMatchLevel;
}

export type RuleCoverage = "none" | "partial" | "full";

export interface HistoricalRuleSuggestion {
  transaction_type: "支出" | "收入";
  match_scope?: RuleMatchScope;
  counterparty?: string;
  product: string;
  category_key: string;
  category: string;
  variants: string[];
  category_counts: HistoricalCategoryCount[];
  category_confidence: number;
  occurrences: number;
  months_count: number;
  last_month: string;
}

export interface HistoricalProductStat {
  group_by?: "product" | "counterparty";
  transaction_type: "支出" | "收入";
  product_key: string;
  product: string;
  counterparty: string;
  variants: string[];
  counterparties: string[];
  counterparty_count: number;
  category_counts: HistoricalCategoryCount[];
  recommended_category: string;
  recommended_category_key: string | null;
  category_confidence: number;
  has_category_conflict: boolean;
  category_status: ProductCategoryStatus;
  occurrences: number;
  months_count: number;
  total_amount: number;
  average_amount: number;
  latest_amount: number;
  last_date: string;
  first_month: string;
  last_month: string;
  matching_rule_count: number;
  matching_rule_ids: number[];
  matching_rule_levels: RuleMatchLevel[];
  rule_coverage: RuleCoverage;
  matched_occurrences: number;
  unmatched_occurrences: number;
  conflicted_occurrences: number;
  higher_priority_covered_occurrences?: number;
  rule_suggestion?: HistoricalRuleSuggestion;
  rule_status: "未创建" | "已覆盖" | "重复" | "冲突";
  history_rule_mismatch: boolean;
}

export interface RuleHealthSummary {
  product_conflicts: number;
  rule_conflicts: number;
  duplicate_rules: number;
  rule_conflict_groups?: number;
  duplicate_rule_groups?: number;
  inactive_category_transactions: number;
  uncategorized_transactions: number;
  stable_products_without_rule: number;
  fully_covered_groups?: number;
  partially_covered_groups?: number;
  uncovered_groups?: number;
  higher_priority_covered_transactions?: number;
}

export interface SavedRule {
  id?: number;
  transaction_type: "支出" | "收入";
  match_scope?: RuleMatchScope;
  counterparty?: string;
  product: string;
  category_key: string;
  category: string;
  category_active?: boolean;
  rewrite_merchant?: string;
  rewrite_product?: string;
  rule_status?: "正常" | "重复" | "冲突";
  duplicate_rule_ids?: number[];
  conflict_rule_ids?: number[];
  occurrences?: number;
  months_count?: number;
  last_month?: string;
  last_used_date?: string;
  match_level?: RuleMatchLevel;
}

export type RuleConflictKind = "duplicate" | "same-condition" | "rewrite-chain";

export interface RuleConflictGroup {
  conflict_key: string;
  kind: RuleConflictKind;
  rule_ids: number[];
  rules: SavedRule[];
  affected_transaction_count: number;
  affected_months: string[];
  description: string;
}

export interface RuleImpactPreview {
  transaction_count: number;
  months: string[];
  category_counts: HistoricalCategoryCount[];
  existing_rule_ids: number[];
  higher_priority_rule_count: number;
}

export interface RuleWorkspace {
  categories_revision: number;
  rules_revision: number;
  scope?: ReadWindow | null;
  categories: CategoryDefinition[];
  rules: SavedRule[];
  recommendations: RuleCandidate[];
  historical_products: HistoricalProductStat[];
  rule_conflicts: RuleConflictGroup[];
  summary: RuleHealthSummary;
}

export interface RuleWorkspaceShell {
  categories_revision: number;
  rules_revision: number;
  categories: CategoryDefinition[];
  rules: SavedRule[];
}

export interface RuleWorkspaceAnalytics {
  categories_revision: number;
  rules_revision: number;
  scope?: ReadWindow | null;
  categories: CategoryDefinition[];
  rules: SavedRule[];
  recommendations: RuleCandidate[];
  historical_products: HistoricalProductStat[];
  rule_conflicts: RuleConflictGroup[];
  summary: RuleHealthSummary;
}
