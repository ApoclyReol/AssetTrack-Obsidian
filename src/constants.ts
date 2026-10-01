export const VIEW_TYPE_ASSET_TRACK = "asset-track-editor";
export const RECOMMENDED_WORKSPACE = "Asset_Track";
export const DATABASE_NAME = "accounting_system.db";

export type EditorMode = "analysis" | "transactions" | "rules";
export type AnalysisMode = "annual" | "monthly";
/** Current configuration pages. Attribute and tag pages were unified as taxonomy. */
export type RulesMode = "health" | "categories" | "matching" | "products" | "taxonomy";
/** Sections kept only so an in-memory draft from the pre-unification UI can be recovered. */
export type LegacyRulesMode = "attributes" | "tags";
export type RulesDraftMode = RulesMode | LegacyRulesMode;

export const EDITOR_MODES: EditorMode[] = [
  "analysis",
  "transactions",
  "rules"
];
export const ANALYSIS_MODES: AnalysisMode[] = ["annual", "monthly"];
export const RULES_MODES: RulesMode[] = ["health", "categories", "taxonomy", "matching", "products"];
