export type MonthCreationReason = {
  code: "month.draft_exists" | "month.creation_limit";
  params: Record<string, string>;
};

export interface MonthCreationPolicy {
  months: string[];
  saved_months: string[];
  draft_month: string | null;
  next_target: string;
  max_creatable_month: string;
  can_create: boolean;
  reason: MonthCreationReason | null;
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

export interface InvestmentAccountAnalysis {
  account_key: string;
  name: string;
  principal: number;
  deposit: number;
  withdraw: number;
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
    previous_roi_percent: number | null;
    roi_delta_percent: number | null;
  };
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
  description?: string;
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
