export interface AssetTrackSettings {
  workspacePath: string;
}

export interface Transaction {
  id?: number;
  client_id?: string;
  transaction_date: string;
  type: string;
  category_key?: string | null;
  category: string;
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

export interface SidecarStatus {
  state: "stopped" | "starting" | "ready" | "failed";
  pid?: number;
  port?: number;
  error?: string;
}
