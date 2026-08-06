import type {
  CashAccountBalance,
  InvestmentAccountBalance,
  InvestmentAccountAnalysis
} from "./configuration";
import type { Transaction } from "./transactions";
import type { PendingOperationLog } from "./operations";

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

export interface AnnualFixedAsset extends FixedAsset {
  last_seen_month: string;
}

export interface DebtRecord {
  id?: number;
  description: string;
  counterparty: string;
  amount: number;
  start_date: string;
  is_paid: boolean;
  paid_date?: string | null;
}

export interface MonthWorkspace {
  month: string;
  revision: number;
  status: "draft" | "saved";
  debt_revision: number;
  cash_accounts: CashAccountBalance[];
  investment_accounts: InvestmentAccountBalance[];
  transactions: Transaction[];
  debts: DebtRecord[];
  fixed_assets: FixedAsset[];
  computed: Record<string, unknown>;
  overview: MonthOverview;
}

export type MonthSection = "assets" | "transactions" | "debts" | "fixed_assets";

export type MonthSectionSaveRequest =
  | {
      expected_revision: number;
      section: "assets";
      cash_accounts: CashAccountBalance[];
      investment_accounts: InvestmentAccountBalance[];
      operation_logs?: PendingOperationLog[];
    }
  | {
      expected_revision: number;
      section: "transactions";
      transactions: Transaction[];
      operation_logs?: PendingOperationLog[];
    }
  | {
      expected_revision: number;
      section: "debts";
      debt_revision: number;
      debts: DebtRecord[];
      operation_logs?: PendingOperationLog[];
    }
  | {
      expected_revision: number;
      section: "fixed_assets";
      fixed_assets: FixedAsset[];
      operation_logs?: PendingOperationLog[];
    };

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
  investment_accounts?: InvestmentAccountAnalysis[];
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
