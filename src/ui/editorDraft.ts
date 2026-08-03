import type {
  CategoryDefinition,
  MonthWorkspace,
  RuleWorkspace
} from "../types";

export interface MonthEditorDraftSnapshot {
  kind: "transactions";
  month: string;
  workspace: MonthWorkspace;
  categories: CategoryDefinition[];
  issues: Array<Record<string, unknown>>;
}

export interface RulesEditorDraftSnapshot {
  kind: "rules";
  workspace: RuleWorkspace;
  category_dirty: boolean;
  rule_dirty: boolean;
  analytics_ready: boolean;
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
