import type { CsvMappingProfile } from "./csv";

export interface AssetTrackSettings {
  dataDirectory: string;
  csvMappings: CsvMappingProfile[];
  baseCurrency: string;
  currencyFormat: "standard" | "accounting";
  reconciliationTolerance: number;
  largeExpenseThreshold: number;
  aiEndpoint?: string;
  aiModel?: string;
  aiTimeoutMs?: number;
}
