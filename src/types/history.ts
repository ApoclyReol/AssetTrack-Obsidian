import type {
  HistoricalCategoryCount,
  HistoricalProductStat,
  RuleMatchExplanation
} from "./rules";

export type ProductHistoryIssueFilter =
  | "conflict"
  | "rule-conflict"
  | "duplicate"
  | "inactive"
  | "uncategorized"
  | "no-rule"
  | "mismatch";

export interface ProductHistoryQuery {
  group_by?: "product" | "counterparty";
  transaction_type?: "支出" | "收入";
  product_key?: string;
  category_key?: string | null;
  product_search?: string;
  counterparty_search?: string;
  issue_filter?: ProductHistoryIssueFilter;
  from_month?: string;
  to_month?: string;
  min_occurrences?: number;
}

export interface ProductHistoryIndexResult {
  group_by?: "product" | "counterparty";
  categories_revision: number;
  rules_revision: number;
  groups: HistoricalProductStat[];
}

export interface ProductHistoryTransaction {
  id: number;
  month: string;
  transaction_date: string;
  type: "支出" | "收入";
  category_key: string | null;
  category: string;
  category_active: boolean | null;
  counterparty: string;
  product: string;
  amount: number;
  rule_match: RuleMatchExplanation;
}

export interface ProductHistoryResult {
  groups: HistoricalProductStat[];
  rows: ProductHistoryTransaction[];
}

export interface CategoryBackfillRequest {
  transaction_ids: number[];
  target_category_key: string;
  expected_month_revisions: Record<string, number>;
  source_page?: string;
  actor?: string;
}

export interface CategoryBackfillPreview {
  transaction_ids: number[];
  target_category_key: string;
  target_category: string;
  target_transaction_type: "支出" | "收入";
  transaction_count: number;
  month_count: number;
  months: Array<{ month: string; revision: number; count: number }>;
  old_categories: HistoricalCategoryCount[];
}

export interface CategoryBackfillResult extends CategoryBackfillPreview {
  updated_count: number;
  revisions: Record<string, number>;
}

export interface ProductRenameRequest {
  transaction_ids: number[];
  target_product: string;
  expected_month_revisions: Record<string, number>;
  source_page?: string;
  actor?: string;
}

export interface ProductRenamePreview {
  transaction_ids: number[];
  target_product: string;
  transaction_count: number;
  month_count: number;
  months: Array<{ month: string; revision: number; count: number }>;
  variants: Array<{ product: string; occurrences: number; months_count: number }>;
}

export interface ProductRenameResult extends ProductRenamePreview {
  updated_count: number;
  revisions: Record<string, number>;
}

export interface CounterpartyRenameRequest {
  transaction_ids: number[];
  target_counterparty: string;
  expected_month_revisions: Record<string, number>;
  source_page?: string;
  actor?: string;
}

export interface CounterpartyRenamePreview {
  transaction_ids: number[];
  target_counterparty: string;
  transaction_count: number;
  month_count: number;
  months: Array<{ month: string; revision: number; count: number }>;
  variants: Array<{ counterparty: string; occurrences: number; months_count: number }>;
}

export interface CounterpartyRenameResult extends CounterpartyRenamePreview {
  updated_count: number;
  revisions: Record<string, number>;
}
