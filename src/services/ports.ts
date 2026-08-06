import type {
  AccountDefinition,
  CategoryDefinition,
  MonthCreationPolicy
} from "../types/configuration";
import type {
  AnnualOverview
} from "../types/analysis";
import type {
  CategoryBackfillPreview,
  CategoryBackfillRequest,
  CategoryBackfillResult,
  CounterpartyRenamePreview,
  CounterpartyRenameRequest,
  CounterpartyRenameResult,
  ProductHistoryIndexResult,
  ProductHistoryQuery,
  ProductHistoryResult,
  ProductRenamePreview,
  ProductRenameRequest,
  ProductRenameResult
} from "../types/history";
import type {
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection
} from "../types/csv";
import type {
  CurrentAsset,
  FixedAsset,
  MonthSectionSaveRequest,
  MonthWorkspace
} from "../types/month";
import type {
  OperationPreview,
  TransactionOperationPreviewRequest,
  OperationAuditContext,
  PendingOperationLog
} from "../types/operations";
import type {
  RuleImpactPreview,
  RuleWorkspaceAnalytics,
  RuleWorkspaceShell
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import type { RuleRow } from "../domain/rules";

export interface MonthSaveRequest {
  expected_revision: number;
  cash_accounts: MonthWorkspace["cash_accounts"];
  investment_accounts: MonthWorkspace["investment_accounts"];
  transactions: Transaction[];
  fixed_assets: FixedAsset[];
  debt_revision?: number;
  debts?: MonthWorkspace["debts"];
  operation_logs: PendingOperationLog[];
}

export interface RuleLookupPort {
  ruleWorkspaceShell(): Promise<RuleWorkspaceShell>;
}

export interface RuleWritePort {
  saveRules(
    revision: number,
    rows: Array<Record<string, unknown>>,
    audit?: OperationAuditContext
  ): Promise<unknown>;
}

export interface MonthEditorPort extends RuleLookupPort, RuleWritePort {
  month(month: string): Promise<MonthWorkspace>;
  deleteMonth(month: string, revision: number): Promise<Record<string, unknown>>;
  saveMonth(month: string, payload: MonthSaveRequest): Promise<MonthWorkspace>;
  saveMonthSection(month: string, payload: MonthSectionSaveRequest): Promise<MonthWorkspace>;
  validateTransactions(
    month: string,
    rows: Transaction[]
  ): Promise<{ issues: Array<Record<string, unknown>> }>;
  previewTransactionOperation(
    request: TransactionOperationPreviewRequest
  ): Promise<{ preview: OperationPreview; rows: Transaction[] }>;
  inspectCsv(month: string, filename: string, content: ArrayBuffer): Promise<CsvInspection>;
  previewMappedCsv(
    month: string,
    filename: string,
    content: ArrayBuffer,
    mapping: CsvColumnMapping
  ): Promise<CsvImportPreview>;
  categories(): Promise<{ revision: number; rows: CategoryDefinition[] }>;
}

export interface ConfigurationEditorPort extends RuleLookupPort, RuleWritePort {
  ruleImpactPreview(rule: RuleRow): Promise<RuleImpactPreview>;
  ruleWorkspaceAnalytics(minOccurrences?: number): Promise<RuleWorkspaceAnalytics>;
  productOverview(query?: ProductHistoryQuery): Promise<ProductHistoryIndexResult>;
  productHistoryIndex(query: ProductHistoryQuery): Promise<ProductHistoryIndexResult>;
  productHistory(query: ProductHistoryQuery): Promise<ProductHistoryResult>;
  previewCategoryBackfill(
    request: Omit<CategoryBackfillRequest, "expected_month_revisions">
  ): Promise<CategoryBackfillPreview>;
  applyCategoryBackfill(request: CategoryBackfillRequest): Promise<CategoryBackfillResult>;
  previewProductRename(
    request: Omit<ProductRenameRequest, "expected_month_revisions">
  ): Promise<ProductRenamePreview>;
  applyProductRename(request: ProductRenameRequest): Promise<ProductRenameResult>;
  previewCounterpartyRename(
    request: Omit<CounterpartyRenameRequest, "expected_month_revisions">
  ): Promise<CounterpartyRenamePreview>;
  applyCounterpartyRename(request: CounterpartyRenameRequest): Promise<CounterpartyRenameResult>;
  saveCategories(
    revision: number,
    rows: CategoryDefinition[],
    audit?: OperationAuditContext
  ): Promise<{ revision: number; rows: CategoryDefinition[] }>;
}

/** Capabilities composed by the editor shell while each child receives a narrower port. */
export interface EditorShellPort
  extends MonthEditorPort,
    ConfigurationEditorPort,
    AnalysisPort {
  months(): Promise<MonthCreationPolicy>;
  createMonth(month: string): Promise<MonthWorkspace>;
}

export interface AnalysisPort {
  annual(year: string): Promise<AnnualOverview>;
  month(month: string): Promise<MonthWorkspace>;
}

export interface BackupPort {
  backup(directory?: string): Promise<{
    path: string;
    validation: Record<string, unknown>;
  }>;
  validateBackup(path: string): Promise<Record<string, unknown>>;
  restoreBackup(path: string): Promise<Record<string, unknown>>;
}

export interface RuntimePort {
  meta(): Promise<Record<string, unknown>>;
  months(): Promise<MonthCreationPolicy>;
  currentAsset(): Promise<CurrentAsset>;
  createMonth(month: string): Promise<MonthWorkspace>;
  debts(): Promise<{ revision: number; rows: MonthWorkspace["debts"] }>;
  saveDebts(revision: number, rows: Array<Record<string, unknown>>): Promise<unknown>;
  rules(): Promise<{ revision: number; rows: Array<Record<string, unknown>> }>;
  accounts(): Promise<{ revision: number; rows: AccountDefinition[] }>;
  saveAccounts(revision: number, rows: AccountDefinition[]): Promise<{
    revision: number;
    rows: AccountDefinition[];
  }>;
  runtimeStatus(): Promise<Record<string, unknown>>;
  exportDiagnostics(): Promise<{ path: string; payload: Record<string, unknown> }>;
  reopen(): Promise<void>;
  close(): Promise<void>;
}
