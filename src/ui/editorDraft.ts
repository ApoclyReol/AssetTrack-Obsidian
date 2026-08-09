import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  MonthWorkspace,
  MonthSection
} from "../types/month";
import type { RulesMode } from "../constants";
import type {
  RuleWorkspace
} from "../types/rules";
import type {
  PendingOperationLog
} from "../types/operations";

export interface MonthEditorDraftSnapshot {
  kind: "transactions";
  month: string;
  workspace: MonthWorkspace;
  categories: CategoryDefinition[];
  issues: Array<Record<string, unknown>>;
  pending_operation_logs?: PendingOperationLog[];
  active_section?: MonthSection;
  dirty_sections?: MonthSection[];
}

export interface RulesEditorDraftSnapshot {
  kind: "rules";
  workspace: RuleWorkspace;
  category_dirty: boolean;
  rule_dirty: boolean;
  analytics_ready: boolean;
  active_section?: RulesMode;
}

export type EditorDraftSnapshot =
  | MonthEditorDraftSnapshot
  | RulesEditorDraftSnapshot;

export const DRAFT_RECOVERY_EPHEMERAL_KEY =
  "assetTrackDraftRecoveryToken";

export class DraftRecoveryStore {
  private readonly entries = new Map<string, EditorDraftSnapshot>();

  store(snapshot: EditorDraftSnapshot): string {
    const token = crypto.randomUUID();
    this.entries.set(token, structuredClone(snapshot));
    return token;
  }

  take(token: string): EditorDraftSnapshot | undefined {
    const snapshot = this.entries.get(token);
    this.entries.delete(token);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  delete(token: string): void {
    this.entries.delete(token);
  }

  clear(): void {
    this.entries.clear();
  }
}
