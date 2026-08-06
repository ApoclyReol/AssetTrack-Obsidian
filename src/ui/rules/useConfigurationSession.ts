import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { CategoryDefinition } from "../../types/configuration";
import type { RuleWorkspace, SavedRule } from "../../types/rules";
import type { RulesEditorDraftSnapshot } from "../editorDraft";
import { clone } from "../editorPrimitives";

export interface ConfigurationSession {
  workspace: RuleWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<RuleWorkspace | null>>;
  categoryDirty: boolean;
  ruleDirty: boolean;
  dirtyFlagsRef: MutableRefObject<ConfigurationDirtyFlags>;
  lastDataVersion: { current: number };
  skipNextDataVersion: { current: boolean };
  restoredDraft: { current: RulesEditorDraftSnapshot | null };
  setDirtyFlags: (nextCategoryDirty: boolean, nextRuleDirty: boolean) => void;
  markCategoryDirty: () => void;
  markRuleDirty: () => void;
  updateCategories: (categories: CategoryDefinition[]) => void;
  updateRules: (rules: SavedRule[]) => void;
  getDraftSnapshot: (analyticsReady: boolean) => RulesEditorDraftSnapshot | null;
}

export interface ConfigurationDirtyFlags {
  category: boolean;
  rule: boolean;
}

export function useConfigurationSession(
  initialDraft: RulesEditorDraftSnapshot | undefined,
  dataVersion: number
): ConfigurationSession {
  const [workspace, setWorkspace] = useState<RuleWorkspace | null>(
    initialDraft ? clone(initialDraft.workspace) : null
  );
  const initialDirtyFlags: ConfigurationDirtyFlags = {
    category: initialDraft?.category_dirty ?? false,
    rule: initialDraft?.rule_dirty ?? false
  };
  const [dirtyFlags, setDirtyFlagsState] = useState(initialDirtyFlags);
  const dirtyFlagsRef = useRef<ConfigurationDirtyFlags>(initialDirtyFlags);
  const lastDataVersion = useRef(dataVersion);
  const skipNextDataVersion = useRef(false);
  const restoredDraft = useRef(initialDraft ? clone(initialDraft) : null);

  const setDirtyFlags = useCallback((nextCategoryDirty: boolean, nextRuleDirty: boolean) => {
    const nextDirtyFlags = { category: nextCategoryDirty, rule: nextRuleDirty };
    setDirtyFlagsState(nextDirtyFlags);
    dirtyFlagsRef.current = nextDirtyFlags;
  }, []);
  const markCategoryDirty = useCallback(() => setDirtyFlags(true, dirtyFlagsRef.current.rule), [setDirtyFlags]);
  const markRuleDirty = useCallback(() => setDirtyFlags(dirtyFlagsRef.current.category, true), [setDirtyFlags]);
  const updateCategories = useCallback((categories: CategoryDefinition[]) => {
    setWorkspace((current) => current ? { ...current, categories } : current);
    markCategoryDirty();
  }, [markCategoryDirty]);
  const updateRules = useCallback((rules: SavedRule[]) => {
    setWorkspace((current) => current ? { ...current, rules } : current);
    markRuleDirty();
  }, [markRuleDirty]);
  const getDraftSnapshot = useCallback((analyticsReady: boolean): RulesEditorDraftSnapshot | null => {
    if (!workspace || (!dirtyFlagsRef.current.category && !dirtyFlagsRef.current.rule)) return null;
    return {
      kind: "rules",
      workspace: clone(workspace),
      category_dirty: dirtyFlagsRef.current.category,
      rule_dirty: dirtyFlagsRef.current.rule,
      analytics_ready: analyticsReady
    };
  }, [workspace]);

  return {
    workspace,
    setWorkspace,
    categoryDirty: dirtyFlags.category,
    ruleDirty: dirtyFlags.rule,
    dirtyFlagsRef,
    lastDataVersion,
    skipNextDataVersion,
    restoredDraft,
    setDirtyFlags,
    markCategoryDirty,
    markRuleDirty,
    updateCategories,
    updateRules,
    getDraftSnapshot
  };
}
