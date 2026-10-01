import type { AnnualFixedAsset } from "./month";

/** A read-only analysis link that opens the transaction editor with a filter. */
export interface TransactionAnalysisDrilldown {
  dimension: "category" | "attribute" | "tag";
  key: string;
  label: string;
  /** The months in which the dimension appears; annual views use the latest one. */
  months?: string[];
}

export interface MonthlyCalculation {
  category_summary: Record<string, number>;
  all_out: number;
  total_daifu: number;
  total_expense: number;
  total_income: number;
  total_deposit: number;
  total_withdraw: number;
  structure: {
    necessary: number;
    controlled: number;
    periodic: number;
    daily: number;
    occasional: number;
  };
  big_tickets: Array<{ product: string; amount: number; category: string }>;
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
  /** @deprecated Legacy indicator retained for compatibility; no longer shown in the UI. */
  asset_support_months: number | null;
  categories: Array<{
    category: string;
    /** @deprecated Use attribute summaries. */
    necessity: string;
    /** @deprecated Use attribute summaries. */
    pattern: string;
    total: number;
    monthly_average: number;
    share_percent: number;
    months?: string[];
  }>;
  /** @deprecated Use attribute summaries. */
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
  attributes?: Array<{
    group_key: string;
    group: string;
    attribute_key: string;
    attribute: string;
    total: number;
    share_percent: number;
    months?: string[];
  }>;
  tags?: Array<{
    tag_key: string;
    tag: string;
    total: number;
    transaction_count: number;
    share_percent: number;
    categories?: Array<{ category: string; amount: number }>;
    trend?: Array<{ month: string; amount: number }>;
    months?: string[];
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
  fixed_assets: AnnualFixedAsset[];
  all_trend_rows: AnnualRow[];
  cost_audit: AnnualCostAudit;
}
