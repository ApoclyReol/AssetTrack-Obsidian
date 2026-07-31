import type {
  AccountDefinition,
  AnnualOverview,
  CategoryDefinition,
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  CurrentAsset,
  FixedAsset,
  MonthCreationPolicy,
  MonthWorkspace,
  RuleCandidate,
  Transaction
} from "../types";

export class AssetTrackError extends Error {
  readonly status: number;
  readonly detail: unknown;
  readonly code: string;
  readonly params: Record<string, string | number | boolean | null>;
  override readonly cause?: unknown;

  constructor(
    payload: string | {
      code: string;
      message?: string;
      params?: Record<string, string | number | boolean | null>;
      status?: number;
      cause?: unknown;
    },
    legacyStatus = 500,
    legacyDetail: unknown = payload,
    legacyCode = "asset_track_error"
  ) {
    const structured = typeof payload === "string" ? null : payload;
    super(structured?.message ?? (typeof payload === "string" ? payload : payload.code));
    this.name = "AssetTrackError";
    this.status = structured?.status ?? legacyStatus;
    this.detail = structured?.params ?? legacyDetail;
    this.code = structured?.code ?? legacyCode;
    this.params = structured?.params ?? {};
    this.cause = structured?.cause;
  }
}

export interface AssetTrackService {
  meta(): Promise<Record<string, unknown>>;
  months(): Promise<MonthCreationPolicy>;
  month(month: string): Promise<MonthWorkspace>;
  currentAsset(): Promise<CurrentAsset>;
  annual(year: string): Promise<AnnualOverview>;
  createMonth(month: string): Promise<MonthWorkspace>;
  deleteMonth(month: string, revision: number): Promise<Record<string, unknown>>;
  saveMonth(
    month: string,
    payload: {
      expected_revision: number;
      cash_accounts: MonthWorkspace["cash_accounts"];
      investment_accounts: MonthWorkspace["investment_accounts"];
      transactions: Transaction[];
      fixed_assets: FixedAsset[];
    }
  ): Promise<MonthWorkspace>;
  validateTransactions(
    month: string,
    rows: Transaction[]
  ): Promise<{ issues: Array<Record<string, unknown>> }>;
  applyRules(
    month: string,
    rows: Transaction[]
  ): Promise<{ base_revision: number; proposed_rows: Transaction[] }>;
  inspectCsv(
    month: string,
    filename: string,
    content: ArrayBuffer
  ): Promise<CsvInspection>;
  previewMappedCsv(
    month: string,
    filename: string,
    content: ArrayBuffer,
    mapping: CsvColumnMapping
  ): Promise<CsvImportPreview>;
  ruleCandidates(
    month: string,
    rows: Transaction[],
    minOccurrences?: number
  ): Promise<{
    month: string;
    rules_revision: number;
    min_occurrences: number;
    rows: RuleCandidate[];
  }>;
  debts(): Promise<{ revision: number; rows: Array<Record<string, unknown>> }>;
  saveDebts(
    revision: number,
    rows: Array<Record<string, unknown>>
  ): Promise<unknown>;
  rules(): Promise<{ revision: number; rows: Array<Record<string, unknown>> }>;
  saveRules(
    revision: number,
    rows: Array<Record<string, unknown>>
  ): Promise<unknown>;
  categories(): Promise<{ revision: number; rows: CategoryDefinition[] }>;
  saveCategories(
    revision: number,
    rows: CategoryDefinition[]
  ): Promise<{ revision: number; rows: CategoryDefinition[] }>;
  accounts(): Promise<{ revision: number; rows: AccountDefinition[] }>;
  saveAccounts(
    revision: number,
    rows: AccountDefinition[]
  ): Promise<{ revision: number; rows: AccountDefinition[] }>;
  backup(directory?: string): Promise<{
    path: string;
    validation: Record<string, unknown>;
  }>;
  validateBackup(path: string): Promise<Record<string, unknown>>;
  restoreBackup(path: string): Promise<Record<string, unknown>>;
  runtimeStatus(): Promise<Record<string, unknown>>;
  exportDiagnostics(): Promise<{
    path: string;
    payload: Record<string, unknown>;
  }>;
  reopen(): Promise<void>;
  close(): Promise<void>;
}
