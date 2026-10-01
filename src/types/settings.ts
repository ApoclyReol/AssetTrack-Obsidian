import type { CsvMappingProfile } from "./csv";

export interface AssetTrackSettings {
  dataDirectory: string;
  csvMappings: CsvMappingProfile[];
  baseCurrency: string;
  currencyFormat: "standard" | "accounting";
  reconciliationTolerance: number;
  /** Retained only to read old settings; large-ticket status now comes from attributes. */
  largeExpenseThreshold?: number;
  aiEndpoint?: string;
  aiModel?: string;
  aiTimeoutMs?: number;
}

export type AnalysisRuntimeSettings = Pick<
  AssetTrackSettings,
  "reconciliationTolerance"
>;
