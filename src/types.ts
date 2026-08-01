export interface AssetTrackSettings {
  dataDirectory: string;
  csvMappings: CsvMappingProfile[];
  baseCurrency: string;
  currencyFormat: "standard" | "accounting";
  reconciliationTolerance: number;
  largeExpenseThreshold: number;
}

export type ImportMode = "append" | "replace";

export interface CsvColumnMapping {
  date_column: string;
  product_column: string;
  counterparty_column?: string;
  amount_column: string;
  type_column: string;
  category_column?: string;
  status_column?: string;
  type_values: Record<string, string>;
  included_statuses: string[];
}

export interface CsvMappingProfile {
  header_signature: string;
  mapping: CsvColumnMapping;
  updated_at: string;
}

export interface CsvInspection {
  month: string;
  filename: string;
  headers: string[];
  header_signature: string;
  row_count: number;
  sample_rows: Array<Record<string, string>>;
  distinct_values: Record<string, string[]>;
  empty_values: Record<string, boolean>;
  suggested_mapping: Partial<CsvColumnMapping>;
}

export interface CsvImportStats {
  source_rows: number;
  accepted_rows: number;
  defaulted: Record<string, number>;
  defaulted_examples: Record<string, Array<Record<string, unknown>>>;
  filtered: Record<string, number>;
  examples: Record<string, Array<Record<string, unknown>>>;
}

export interface CsvImportPreview {
  month: string;
  rows: Transaction[];
  issues: Array<Record<string, unknown>>;
  type_summary: Record<string, number>;
  modes: ImportMode[];
  import_stats: CsvImportStats;
}

export type RuleMatchLevel = "exact" | "product" | "counterparty";

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
  category_key?: string | null;
  category?: string;
  reason: string;
}

export interface RuleApplicationIssue {
  row_index: number;
  row_id?: number;
  rule_ids: number[];
  reason: string;
  level?: RuleMatchLevel;
}

export interface RuleCandidate {
  transaction_type: "支出" | "收入";
  product: string;
  product_key?: string;
  counterparty: string;
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
  counterparty: string;
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
}

export interface SavedRule {
  id?: number;
  transaction_type: "支出" | "收入";
  counterparty: string;
  product: string;
  category_key: string;
  category: string;
  rule_status?: "正常" | "重复" | "冲突";
  duplicate_rule_ids?: number[];
  conflict_rule_ids?: number[];
  occurrences?: number;
  months_count?: number;
  last_month?: string;
  match_level?: RuleMatchLevel;
}

export type RuleConflictKind = "duplicate" | "same-condition" | "overlap";

export interface RuleConflictGroup {
  conflict_key: string;
  kind: RuleConflictKind;
  rule_ids: number[];
  rules: SavedRule[];
  affected_transaction_count: number;
  affected_months: string[];
  description: string;
}

export interface RuleWorkspace {
  categories_revision: number;
  rules_revision: number;
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
  categories: CategoryDefinition[];
  rules: SavedRule[];
  recommendations: RuleCandidate[];
  rule_conflicts: RuleConflictGroup[];
  summary: RuleHealthSummary;
}

export type ProductHistoryIssueFilter =
  | "conflict"
  | "rule-conflict"
  | "duplicate"
  | "inactive"
  | "uncategorized"
  | "no-rule"
  | "mismatch";

export interface ProductHistoryQuery {
  transaction_type?: "支出" | "收入";
  product_key?: string;
  category_key?: string | null;
  product_search?: string;
  issue_filter?: ProductHistoryIssueFilter;
  from_month?: string;
  to_month?: string;
  min_occurrences?: number;
}

export interface ProductHistoryIndexResult {
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

export interface SaveRuleWorkspaceRequest {
  categories_revision: number;
  rules_revision: number;
  categories: CategoryDefinition[];
  rules: SavedRule[];
}

export interface RuleInsights {
  rules_revision: number;
  categories_revision: number;
  min_occurrences: number;
  recommendations: RuleCandidate[];
  historical_products: HistoricalProductStat[];
  rule_conflicts: RuleConflictGroup[];
  summary: RuleHealthSummary;
}

export interface Transaction {
  id?: number;
  client_id?: string;
  transaction_date: string;
  type: string;
  category_key?: string | null;
  category: string;
  counterparty?: string;
  product: string;
  amount: number;
}

export interface FixedAsset {
  id?: number;
  client_id?: string;
  asset_key?: string;
  asset_name: string;
  category: string;
  purchase_date?: string | null;
  purchase_price: number;
  status: string;
  note: string;
}

export interface MonthWorkspace {
  month: string;
  revision: number;
  status: "draft" | "saved";
  cash_accounts: CashAccountBalance[];
  investment_accounts: InvestmentAccountBalance[];
  transactions: Transaction[];
  fixed_assets: FixedAsset[];
  computed: Record<string, unknown>;
  overview: MonthOverview;
}

export interface CurrentAsset {
  month: string | null;
  cash?: number;
  debt?: number;
  principal?: number;
  market_value?: number;
  investment_cash?: number;
  cost_assets: number;
  market_net_assets: number;
  total_assets: number;
  fixed_assets: FixedAsset[];
  fixed_assets_note?: string;
}

export interface ReconciliationExplanation {
  level: "success" | "error" | "warning" | "info";
  title: string;
  summary: string;
  causes: string[];
  suggestions: string[];
}

export interface MonthOverview {
  available: boolean;
  metrics?: {
    asset_delta: number | null;
    total_income: number;
    total_expense: number;
    surplus: number;
    savings_rate: number | null;
    cost_assets: number;
    market_net_assets: number;
    total_assets: number;
  };
  cash_accounts?: Array<{
    account: string;
    balance: number;
    share_percent: number;
  }>;
  cash_total?: number;
  investment?: {
    principal: number;
    market_value: number;
    cash_balance: number;
    position: number;
    profit: number;
    roi_percent: number;
    comparison: {
      available: boolean;
      previous_position: number | null;
      amount_delta: number | null;
      percent_delta: number | null;
    };
  };
  reconciliation?: {
    available: boolean;
    actual: { all_out: number; daifu: number; net_expense: number };
    theoretical: {
      previous_cash: number | null;
      income: number;
      debt_change: number | null;
      cash: number;
      deposit: number;
      withdraw: number;
      net_expense: number | null;
    };
    discrepancy: number | null;
    explanation: ReconciliationExplanation;
  };
  anomalies?: {
    category_changes: Array<Record<string, string | number>>;
    new_big_items: Array<Record<string, string | number>>;
    missing_periodic: Array<Record<string, string | number>>;
  };
  structure?: {
    necessary: number;
    controlled: number;
    controlled_percent: number;
    leverage: number;
    periodic: number;
    daily: number;
    occasional: number;
    necessary_categories: string[];
    controlled_categories: string[];
  };
  category_summary?: Array<{ category: string; amount: number }>;
  category_comparison?: {
    available: boolean;
    previous_month: string | null;
    rows: Array<{
      category: string;
      current: number;
      previous: number;
      delta: number;
    }>;
  };
  big_tickets?: Array<{ product: string; category: string; amount: number }>;
}

export interface AnnualRow {
  month: string;
  cash: number;
  debt: number;
  principal: number;
  inv_position: number;
  cost_assets: number;
  market_net_assets: number;
  total_assets: number;
  inv_profit: number;
  inv_roi: number;
  inv_weight: number;
  total_income: number;
  total_expense: number;
  savings_rate: number | null;
  total_deposit: number;
  total_withdraw: number;
  all_out: number;
  total_daifu: number;
  necessary: number;
  controlled: number;
  periodic: number;
  daily: number;
  occasional: number;
  discrepancy: number | null;
}

export interface RecurringExpenseSummary {
  product: string;
  category: string;
  months_count: number;
  transaction_count: number;
  total: number;
  average_amount: number;
  latest_amount: number;
  last_date: string;
}

export interface AnnualCostAudit {
  months_count: number;
  total_expense: number;
  necessary_total: number;
  controlled_total: number;
  controlled_percent: number;
  asset_support_months: number | null;
  categories: Array<{
    category: string;
    necessity: string;
    pattern: string;
    total: number;
    monthly_average: number;
    share_percent: number;
  }>;
  patterns: Array<{
    pattern: string;
    total: number;
    monthly_average: number;
    share_percent: number;
  }>;
  big_tickets: Array<{
    month: string;
    product: string;
    category: string;
    amount: number;
  }>;
  subscriptions: Array<{
    product: string;
    total: number;
    monthly_average: number;
  }>;
  daily_essentials: Array<{
    product: string;
    total: number;
    monthly_average: number;
  }>;
}

export interface AnnualOverview {
  year: string;
  months: string[];
  rows: AnnualRow[];
  metrics: {
    total_income: number;
    total_expense: number;
    savings: number;
    savings_rate: number | null;
  };
  latest: AnnualRow | null;
  rolling_rows: AnnualRow[];
  recurring_expenses: RecurringExpenseSummary[];
  all_trend_rows: AnnualRow[];
  cost_audit: AnnualCostAudit;
}

export interface MonthCreationPolicy {
  months: string[];
  draft_month: string | null;
  next_target: string;
  max_creatable_month: string;
  can_create: boolean;
  reason: string | null;
}

export interface CashAccountBalance {
  account_key: string;
  account?: string;
  name?: string;
  balance: number;
  is_active?: boolean;
  sort_order?: number;
}

export interface InvestmentAccountBalance {
  account_key: string;
  name?: string;
  principal: number;
  market_value: number;
  cash_balance: number;
  is_active?: boolean;
  sort_order?: number;
}

export interface CategoryDefinition {
  category_key: string;
  name: string;
  transaction_type: "支出" | "收入";
  necessity: "必要" | "可控" | "不适用";
  pattern: "周期" | "日常" | "偶尔" | "不适用";
  is_big_ticket: boolean;
  color: string;
  is_active: boolean;
  sort_order: number;
  transaction_count?: number;
  rule_count?: number;
  conflict_product_count?: number;
  impact_months?: string[];
}

export interface AccountDefinition {
  account_key: string;
  name: string;
  account_type: "cash" | "investment";
  is_active: boolean;
  sort_order: number;
  usage_count?: number;
  impact_months?: string[];
}
