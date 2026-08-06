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
