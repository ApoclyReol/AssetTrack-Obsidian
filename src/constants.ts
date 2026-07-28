export const VIEW_TYPE_ASSET_TRACK = "asset-track-editor";
export const RECOMMENDED_WORKSPACE = "Asset_Track";
export const DEFAULT_DB_RELATIVE_PATH = "data/accounting_system.db";
export const PLUGIN_VERSION = "1.0.0";

export type EditorMode = "analysis" | "transactions" | "debts" | "rules";
export type AnalysisMode = "home" | "annual" | "monthly";

export const EDITOR_MODES: EditorMode[] = [
  "analysis",
  "transactions",
  "debts",
  "rules"
];
export const ANALYSIS_MODES: AnalysisMode[] = ["home", "annual", "monthly"];
