import type {
  RuleCandidate
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import type {
  AnalysisPort,
  BackupPort,
  ConfigurationEditorPort,
  MonthEditorPort,
  RuntimePort
} from "./ports";

/**
 * Runtime composition interface. UI components should depend on the narrow
 * capability ports instead of this aggregate implementation boundary.
 */
export interface AssetTrackService
  extends MonthEditorPort,
    ConfigurationEditorPort,
    AnalysisPort,
    BackupPort,
    RuntimePort {
  applyRules(
    month: string,
    rows: Transaction[]
  ): Promise<{
    base_revision: number;
    rules_revision: number;
    proposed_rows: Transaction[];
    issues: Array<Record<string, unknown>>;
  }>;
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
}
