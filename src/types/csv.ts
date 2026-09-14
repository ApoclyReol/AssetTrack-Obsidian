import type { Transaction } from "./transactions";

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

export type CsvHeaderStatus = "normal" | "needs_confirmation";

export interface CsvHeaderCandidate {
  row: number;
  headers: string[];
  matched_fields: string[];
  score: number;
  confidence: "high" | "medium" | "low";
}

export interface CsvWorksheetCandidate {
  name: string;
  row_count: number;
  header_candidates: CsvHeaderCandidate[];
}

export interface CsvRawRow {
  row: number;
  values: string[];
}

export interface CsvStructureSelection {
  /** One-based source row number, matching the row number shown to users. */
  header_row?: number;
  /** Workbook worksheet name. CSV sources leave this unset. */
  worksheet_name?: string;
}

export type CsvEncoding = "utf-8" | "gb18030" | "utf-8-fallback";
export type CsvDelimiter = "," | "\t" | ";";

export type CsvImportFilterReason =
  | "outside_month"
  | "status_filtered"
  | "ignored_type"
  | "invalid_date"
  | "invalid_amount"
  | "unmapped_type";

export interface CsvImportFilteredRow {
  row: number;
  reason: CsvImportFilterReason;
  values: Record<string, string>;
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
  empty_counts?: Record<string, number>;
  value_counts?: Record<string, Record<string, number>>;
  header_status?: CsvHeaderStatus;
  header_confirmed?: boolean;
  header_row?: number;
  data_start_row?: number;
  raw_row_count?: number;
  raw_rows?: CsvRawRow[];
  header_candidates?: CsvHeaderCandidate[];
  worksheet_name?: string;
  worksheet_candidates?: CsvWorksheetCandidate[];
  encoding?: CsvEncoding;
  delimiter?: CsvDelimiter;
  suggested_mapping: Partial<CsvColumnMapping>;
}

export interface CsvImportStats {
  source_rows: number;
  accepted_rows: number;
  defaulted: Record<string, number>;
  defaulted_examples: Record<string, Array<Record<string, unknown>>>;
  filtered: Record<string, number>;
  examples: Record<string, Array<Record<string, unknown>>>;
  filtered_rows: CsvImportFilteredRow[];
}

export interface CsvImportPreview {
  month: string;
  rows: Transaction[];
  /** Raw source cells for accepted rows, kept in memory for the current import session. */
  source_rows?: CsvRawRow[];
  issues: Array<Record<string, unknown>>;
  type_summary: Record<string, number>;
  modes: ImportMode[];
  import_stats: CsvImportStats;
}
