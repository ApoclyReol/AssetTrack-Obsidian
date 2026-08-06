import type { SavedRule } from "./rules";
import type { Transaction } from "./transactions";

export type OperationKind =
  | "apply-rules"
  | "bulk-edit-counterparty"
  | "bulk-edit-product"
  | "bulk-edit-category"
  | "create-rule"
  | "income-to-daifu"
  | "daifu-to-income"
  | "ai-classification"
  | "save-categories"
  | "save-rules"
  | "history-category-backfill"
  | "history-product-rename"
  | "history-counterparty-rename";

export interface OperationAuditContext {
  source_page: string;
  business_tab?: OperationBusinessTab;
  actor?: string;
  operation_id?: string;
  operation_type?: OperationKind;
  selection?: string[];
  metadata?: Record<string, unknown>;
}

export interface OperationPreviewChange {
  transaction_id: number | null;
  transaction_key?: string;
  month: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  status: "change" | "skip" | "failure";
  reason?: string;
  rule_ids?: number[];
}

export interface OperationPreview {
  operation_id: string;
  actor?: string;
  operation_type: OperationKind;
  source_page: string;
  business_tab?: OperationBusinessTab;
  total_count: number;
  change_count: number;
  skipped_count: number;
  failure_count: number;
  changes: OperationPreviewChange[];
  protected_count?: number;
  rule_ids?: number[];
  metadata?: Record<string, unknown>;
}

export interface OperationResult extends OperationPreview {
  completed_at: string;
  success_count: number;
}

export interface OperationLogSummary {
  operation_id: string;
  created_at: string;
  actor: string;
  operation_type: string;
  source_page: string;
  business_tab: string | null;
  total_count: number;
  success_count: number;
  skipped_count: number;
  failure_count: number;
  preview_only?: boolean;
}

export interface AiBatchResult {
  batch_id: string;
  model: string;
  created_at: string;
  total_count: number;
  classified_count: number;
  unclassified_count: number;
  review_count: number;
  error_count: number;
  rows: Array<{
    transaction_id: number | null;
    transaction_key?: string;
    status: "classified" | "unclassified" | "need_review" | "error";
    category_key: string | null;
    rewrite_merchant: string | null;
    rewrite_product: string | null;
    confidence: number | null;
    raw?: unknown;
    error?: string;
  }>;
}

export type TransactionBusinessTab = "outgoing" | "incoming" | "investment";
export type OperationBusinessTab = TransactionBusinessTab | "all";
export type TransactionViewMode = "detail" | "product" | "counterparty";

export interface TransactionOperationRequest {
  month: string;
  operation_type: OperationKind;
  transaction_ids: number[];
  transaction_keys?: string[];
  expected_revision: number;
  source_page: string;
  business_tab?: OperationBusinessTab;
  target_value?: string;
  target_category_key?: string | null;
  target_type?: "收入" | "代付";
  rules_revision?: number;
  protected_transaction_ids?: number[];
  protected_transaction_keys?: string[];
  include_protected?: boolean;
}

export interface TransactionOperationPreviewRequest extends TransactionOperationRequest {
  rows: Transaction[];
  rules?: SavedRule[];
  rules_revision?: number;
}

export interface PendingOperationLog {
  preview: OperationPreview;
  selection: string[];
}
