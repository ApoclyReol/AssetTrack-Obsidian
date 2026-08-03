export const VIEW_TYPE_ASSET_TRACK = "asset-track-editor";
export const RECOMMENDED_WORKSPACE = "Asset_Track";
export const DATABASE_NAME = "accounting_system.db";

export type EditorMode = "analysis" | "transactions" | "rules";
export type AnalysisMode = "home" | "annual" | "monthly" | "products";

export const EDITOR_MODES: EditorMode[] = [
  "analysis",
  "transactions",
  "rules"
];
export const ANALYSIS_MODES: AnalysisMode[] = ["home", "annual", "monthly", "products"];
