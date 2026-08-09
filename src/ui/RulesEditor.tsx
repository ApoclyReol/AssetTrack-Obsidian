import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Notice, type App } from "obsidian";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  HistoricalProductStat,
  RuleHealthSummary,
  RuleWorkspaceShell,
  SavedRule
} from "../types/rules";
import type {
  ProductHistoryQuery
} from "../types/history";
import type { ConfigurationEditorPort } from "../services/ports";
import { AssetTrackError } from "../application/errors";
import { inferRuleScopeFromConditions, ruleConditionKey } from "../domain/rules";
import { t } from "../i18n";
import {
  HistoryBackfillContent,
  ProductRenameModal,
  type ProductRenameGroup,
  RuleCreationModal,
  RuleHistoryModal
} from "./RuleHistoryModal";
import { CounterpartyRenameModal, type CounterpartyRenameGroup } from "./CounterpartyRenameModal";
import type { RulesMode } from "../constants";
import { alertAction } from "./ConfirmModal";
import {
  messageFor,
  OperationState,
  Section,
  type SortState,
  Status
} from "./editorPrimitives";
import type {
  EditorDraftSnapshot,
  RulesEditorDraftSnapshot
} from "./editorDraft";
import { CategoryDefinitionsTable } from "./rules/CategoryDefinitionsTable";
import { MatchingRulesTable } from "./rules/MatchingRulesTable";
import type { EditorSession } from "./editorSession";
import { useConfigurationSession } from "./rules/useConfigurationSession";
import { useRuleAnalytics } from "./rules/useRuleAnalytics";

const EMPTY_RULE_HEALTH_SUMMARY: RuleHealthSummary = {
  product_conflicts: 0,
  rule_conflicts: 0,
  duplicate_rules: 0,
  inactive_category_transactions: 0,
  uncategorized_transactions: 0,
  stable_products_without_rule: 0
};

function isRevisionConflict(error: unknown): boolean {
  return error instanceof AssetTrackError && error.code === "revision_conflict";
}

export type RulesEditorHandle = EditorSession;

interface RulesEditorProps {
  app: App;
  api: ConfigurationEditorPort;
  hostWindow: Window;
  dataVersion: number;
  section?: RulesMode;
  onSectionChange?: (section: RulesMode) => void;
  initialDraft?: RulesEditorDraftSnapshot;
  onSessionChange: (snapshot: EditorDraftSnapshot | null) => void;
  onSaved: () => void;
  onDataChanged: () => void;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
}

export const RulesEditor = forwardRef<RulesEditorHandle, RulesEditorProps>(function RulesEditor({
  app,
  api,
  hostWindow,
  dataVersion,
  section,
  onSectionChange,
  initialDraft,
  onSessionChange,
  onSaved,
  onDataChanged,
  confirmAction
}, ref) {
  const [categorySort, setCategorySort] = useState<SortState>(null);
  const [ruleSort, setRuleSort] = useState<SortState>(null);
  const [historyGroupBy, setHistoryGroupBy] = useState<"product" | "counterparty">("product");
  const [categoryState, setCategoryState] = useState<OperationState>({ kind: "idle" });
  const [ruleState, setRuleState] = useState<OperationState>({ kind: "idle" });
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const rulesSectionRef = useRef<HTMLElement | null>(null);
  const editorRequestSequence = useRef(0);
  const mounted = useRef(true);
  const saveBlockedRef = useRef(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const blockSaves = useCallback(() => {
    saveBlockedRef.current = true;
    setSaveBlocked(true);
  }, []);
  const clearSaveBlock = useCallback(() => {
    saveBlockedRef.current = false;
    setSaveBlocked(false);
  }, []);
  const session = useConfigurationSession(initialDraft, dataVersion);
  const {
    workspace,
    setWorkspace,
    categoryDirty,
    ruleDirty,
    dirtyFlagsRef,
    draftGeneration,
    lastDataVersion,
    skipNextDataVersion,
    restoredDraft,
    setDirtyFlags,
    markCategoryDirty,
    markRuleDirty,
    updateCategories,
    updateRules,
    getDraftSnapshot
  } = session;
  const onAnalyticsError = useCallback((message: string) => {
    setState({ kind: "error", message });
  }, []);
  const {
    analyticsReady,
    historyPanelKey,
    setAnalyticsReady,
    setHistoryPanelKey,
    applyAnalytics,
    loadAnalytics,
    scheduleAnalyticsLoad
  } = useRuleAnalytics({
    api,
    hostWindow,
    setWorkspace,
    dirtyFlagsRef,
    initialAnalyticsReady: initialDraft?.analytics_ready ?? false,
    onError: onAnalyticsError
  });
  const actionRef = useRef<RulesEditorHandle>({
    hasUnsavedChanges: () => false,
    getDraftSnapshot: () => null,
    save: async () => false,
    saveAll: async () => false,
    discard: async () => undefined,
    discardAll: async () => undefined
  });
  const currentSection = section ?? "health";
  const getRulesDraftSnapshot = useCallback(() => {
    const snapshot = getDraftSnapshot(analyticsReady);
    return snapshot ? { ...snapshot, active_section: currentSection } : null;
  }, [analyticsReady, currentSection, getDraftSnapshot]);
  useEffect(() => () => {
    mounted.current = false;
    editorRequestSequence.current += 1;
  }, []);
  useImperativeHandle(ref, () => ({
    hasUnsavedChanges: () => actionRef.current.hasUnsavedChanges(),
    getDraftSnapshot: () => actionRef.current.getDraftSnapshot(),
    save: () => actionRef.current.save(),
    saveAll: () => actionRef.current.saveAll(),
    discard: () => actionRef.current.discard(),
    discardAll: () => actionRef.current.discardAll()
  }), [ref]);

  const handleHistorySaved = useCallback(() => {
    setHistoryPanelKey((value) => value + 1);
    void loadAnalytics();
    onSaved();
  }, [loadAnalytics, onSaved]);

  const load = useCallback(async () => {
    const sequence = ++editorRequestSequence.current;
    setState({ kind: "pending", message: t("加载数据健康…", "Loading data health…") });
    try {
      const shell: RuleWorkspaceShell = await api.ruleWorkspaceShell();
      if (!mounted.current || sequence !== editorRequestSequence.current) return;
      setWorkspace({ ...shell, recommendations: [], historical_products: [], rule_conflicts: [], summary: EMPTY_RULE_HEALTH_SUMMARY });
      setAnalyticsReady(false);
      setDirtyFlags(false, false);
      clearSaveBlock();
      onSessionChange(null);
      setState({ kind: "idle" });
      scheduleAnalyticsLoad();
    } catch (error) {
      if (!mounted.current || sequence !== editorRequestSequence.current) return;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [api, clearSaveBlock, onSessionChange, scheduleAnalyticsLoad, setDirtyFlags]);

  useEffect(() => {
    const restored = restoredDraft.current;
    if (!restored) {
      void load();
    } else {
      const sequence = ++editorRequestSequence.current;
      restoredDraft.current = null;
      onSessionChange(restored);
      const message = t("未保存的分类和规则草稿已恢复。", "The unsaved category and rule draft was restored.");
      setState({ kind: "success", message });
      new Notice(message);
      void api.ruleWorkspaceShell()
        .then((current) => {
          if (!mounted.current || sequence !== editorRequestSequence.current) return;
          if (current.categories_revision !== restored.workspace.categories_revision || current.rules_revision !== restored.workspace.rules_revision) {
            blockSaves();
            const message = t("草稿已恢复，但其他窗口已修改分类或规则；重新加载前不能覆盖保存。", "The draft was restored, but another window changed categories or rules. Reload before saving.");
            setState({ kind: "error", message });
            new Notice(message);
          }
          scheduleAnalyticsLoad();
        })
        .catch((error: unknown) => {
          if (!mounted.current || sequence !== editorRequestSequence.current) return;
          const message = messageFor(error);
          new Notice(message);
          setState({ kind: "error", message });
        });
    }
  }, [api, blockSaves, load, onSessionChange, scheduleAnalyticsLoad]);

  useEffect(() => {
    onSessionChange(getRulesDraftSnapshot());
  }, [getRulesDraftSnapshot, onSessionChange]);

  useEffect(() => {
    if (lastDataVersion.current === dataVersion) return;
    lastDataVersion.current = dataVersion;
    if (skipNextDataVersion.current) {
      skipNextDataVersion.current = false;
      return;
    }
    if (dirtyFlagsRef.current.category || dirtyFlagsRef.current.rule) {
      blockSaves();
      editorRequestSequence.current += 1;
      const message = t("其他窗口已修改规则或历史流水；当前草稿保留，保存前请先重新加载。", "Another window changed rules or historical transactions. The current draft is preserved; reload before saving.");
      new Notice(message);
      setState({ kind: "error", message });
      return;
    }
    void load();
  }, [blockSaves, dataVersion, load]);

  if (!workspace) return <Status state={state} />;

  const reportCommittedConfigurationSave = () => {
    skipNextDataVersion.current = false;
    onSaved();
    onDataChanged();
  };

  const currentConfigurationRequest = (sequence: number, generation: number): boolean =>
    mounted.current
    && sequence === editorRequestSequence.current
    && generation === draftGeneration.current;

  const removeRule = async (index: number, rule: SavedRule) => {
    const occurrences = Number(rule.occurrences ?? 0);
    if (occurrences > 0) {
      const confirmed = await confirmAction(
        t("确认删除规则？", "Confirm rule deletion?"),
        t(`规则 #${rule.id ?? "新建"} 有历史流水，是否确认删除？`, `Rule #${rule.id ?? "new"} has historical transactions. Delete it?`),
        t("确认删除规则", "Delete rule")
      );
      if (!confirmed) return;
    }
    setWorkspace((current) => {
      if (!current) return current;
      const currentIndex = current.rules.findIndex((candidate, rowIndex) =>
        rule.id !== undefined ? candidate.id === rule.id : candidate === rule || rowIndex === index
      );
      return currentIndex < 0
        ? current
        : { ...current, rules: current.rules.filter((_, rowIndex) => rowIndex !== currentIndex) };
    });
    markRuleDirty();
  };

  const saveCategories = async (): Promise<{
    saved: boolean;
    rulesRevision?: number;
  }> => {
    if (saveBlockedRef.current) return { saved: false };
    const sequence = ++editorRequestSequence.current;
    const generation = draftGeneration.current;
    const submittedCategories = workspace.categories;
    setCategoryState({ kind: "pending", message: t("保存分类…", "Saving categories…") });
    let result: Awaited<ReturnType<ConfigurationEditorPort["saveCategories"]>>;
    try {
      result = await api.saveCategories(workspace.categories_revision, submittedCategories);
    } catch (error) {
      if (mounted.current && isRevisionConflict(error)) blockSaves();
      if (!mounted.current || sequence !== editorRequestSequence.current) return { saved: false };
      const message = messageFor(error);
      new Notice(message);
      setCategoryState({ kind: "error", message });
      return { saved: false };
    }

    let analytics: Awaited<ReturnType<ConfigurationEditorPort["ruleWorkspaceAnalytics"]>>;
    try {
      analytics = await api.ruleWorkspaceAnalytics();
      if (
        analytics.categories_revision < result.revision
        || analytics.rules_revision < (result.rules_revision ?? workspace.rules_revision)
      ) throw new Error("stale analytics snapshot");
    } catch {
      if (!mounted.current) return { saved: false };
      reportCommittedConfigurationSave();
      if (currentConfigurationRequest(sequence, generation)) {
        const categoryNames = new Map(result.rows.map((category) => [category.category_key, category.name]));
        setWorkspace((current) => current ? {
          ...current,
          categories_revision: result.revision,
          rules_revision: result.rules_revision,
          categories: result.rows,
          rules: dirtyFlagsRef.current.rule
            ? current.rules.map((rule) => ({
                ...rule,
                category: categoryNames.get(rule.category_key) ?? rule.category
              }))
            : current.rules
        } : current);
        setDirtyFlags(false, dirtyFlagsRef.current.rule);
        const message = t(
          "分类已保存，但数据健康刷新失败；当前草稿已保留，请稍后重载。",
          "Categories were saved, but data-health refresh failed; the current draft was preserved. Reload later."
        );
        new Notice(message);
        setCategoryState({ kind: "success", message });
        return { saved: true, rulesRevision: result.rules_revision };
      }
      const message = t(
        "分类已保存，但保存期间产生了新修改；当前草稿已保留，请重新加载后再保存。",
        "Categories were saved, but new edits were made during the save; the current draft was preserved. Reload before saving again."
      );
      blockSaves();
      new Notice(message);
      setCategoryState({ kind: "success", message });
      return { saved: false };
    }

    if (!currentConfigurationRequest(sequence, generation)) {
      if (mounted.current) {
        blockSaves();
        reportCommittedConfigurationSave();
        const message = t(
          "分类已保存，但保存期间产生了新修改；当前草稿已保留，请重新加载后再保存。",
          "Categories were saved, but new edits were made during the save; the current draft was preserved. Reload before saving again."
        );
        new Notice(message);
        setCategoryState({ kind: "success", message });
      }
      return { saved: false };
    }

    {
      const categoryNames = new Map(result.rows.map((category) => [category.category_key, category.name]));
      const rulesRevision = result.rules_revision ?? analytics.rules_revision;
      setWorkspace((current) => current ? {
        ...current,
        categories_revision: result.revision,
        categories: analytics.categories,
        rules_revision: rulesRevision,
        rules: dirtyFlagsRef.current.rule ? current.rules.map((rule) => ({ ...rule, category: categoryNames.get(rule.category_key) ?? rule.category })) : analytics.rules,
        recommendations: analytics.recommendations,
        historical_products: analytics.historical_products,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      } : current);
      setDirtyFlags(false, dirtyFlagsRef.current.rule);
      applyAnalytics(analytics);
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
      new Notice(t("分类已保存。", "Categories saved."));
      setCategoryState({ kind: "success", message: t("分类已保存。", "Categories saved.") });
      return { saved: true, rulesRevision };
    }
  };

  const saveRules = async (expectedRevisionOverride?: number): Promise<boolean> => {
    if (saveBlockedRef.current) return false;
    if (dirtyFlagsRef.current.category) {
      const message = t("请先保存分类，再保存匹配规则。", "Save categories before saving matching rules.");
      new Notice(message);
      setRuleState({ kind: "error", message });
      return false;
    }
    const sequence = ++editorRequestSequence.current;
    const generation = draftGeneration.current;
    setRuleState({ kind: "pending", message: t("保存匹配规则…", "Saving matching rules…") });
    let result: Awaited<ReturnType<ConfigurationEditorPort["saveRules"]>>;
    try {
      const categoryNames = new Map(workspace.categories.map((category) => [category.category_key, category.name]));
      const nextRules = workspace.rules.map((rule) => ({
        ...rule,
        match_scope: inferRuleScopeFromConditions({
          counterparty: rule.counterparty,
          product: rule.product
        }) ?? undefined,
        category: categoryNames.get(rule.category_key) ?? rule.category
      }));
      result = await api.saveRules(
        expectedRevisionOverride ?? workspace.rules_revision,
        nextRules,
        { source_page: "配置/匹配规则" }
      );
    } catch (error) {
      if (mounted.current && isRevisionConflict(error)) blockSaves();
      if (!mounted.current || sequence !== editorRequestSequence.current) return false;
      const message = messageFor(error);
      new Notice(message);
      setRuleState({ kind: "error", message });
      return false;
    }

    let analytics: Awaited<ReturnType<ConfigurationEditorPort["ruleWorkspaceAnalytics"]>>;
    try {
      analytics = await api.ruleWorkspaceAnalytics();
      if (
        analytics.categories_revision < workspace.categories_revision
        || (result?.revision !== undefined && analytics.rules_revision < result.revision)
      ) throw new Error("stale analytics snapshot");
    } catch {
      if (!mounted.current) return false;
      reportCommittedConfigurationSave();
      if (currentConfigurationRequest(sequence, generation)) {
        setWorkspace((current) => current ? {
          ...current,
          rules_revision: result.revision,
          rules: result.rows as unknown as SavedRule[]
        } : current);
        setDirtyFlags(dirtyFlagsRef.current.category, false);
        const message = t(
          "匹配规则已保存，但数据健康刷新失败；当前规则已保留，请稍后重载。",
          "Matching rules were saved, but data-health refresh failed; the saved rules were kept. Reload later."
        );
        new Notice(message);
        setRuleState({ kind: "success", message });
        return true;
      }
      const message = t(
        "匹配规则已保存，但保存期间产生了新修改；当前草稿已保留，请重新加载后再保存。",
        "Matching rules were saved, but new edits were made during the save; the current draft was preserved. Reload before saving again."
      );
      blockSaves();
      new Notice(message);
      setRuleState({ kind: "success", message });
      return false;
    }

    if (!currentConfigurationRequest(sequence, generation)) {
      if (mounted.current) {
        blockSaves();
        reportCommittedConfigurationSave();
        const message = t(
          "匹配规则已保存，但保存期间产生了新修改；当前草稿已保留，请重新加载后再保存。",
          "Matching rules were saved, but new edits were made during the save; the current draft was preserved. Reload before saving again."
        );
        new Notice(message);
        setRuleState({ kind: "success", message });
      }
      return false;
    }

    {
      setWorkspace((current) => current ? {
        ...current,
        categories_revision: analytics.categories_revision,
        rules_revision: analytics.rules_revision,
        categories: analytics.categories,
        rules: analytics.rules,
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      } : current);
      setDirtyFlags(dirtyFlagsRef.current.category, false);
      applyAnalytics(analytics);
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
      new Notice(t("匹配规则已保存。", "Matching rules saved."));
      setRuleState({ kind: "success", message: t("匹配规则已保存。", "Matching rules saved.") });
      return true;
    }
  };

  const saveCurrentSection = async (): Promise<boolean> => {
    if (saveBlockedRef.current) return false;
    if (currentSection === "categories") {
      return (await saveCategories()).saved;
    }
    if (currentSection === "matching") {
      return saveRules();
    }
    let saved = true;
    let rulesRevision: number | undefined;
    if (dirtyFlagsRef.current.category) {
      const categoryResult = await saveCategories();
      saved = categoryResult.saved;
      rulesRevision = categoryResult.rulesRevision;
    }
    if (saved && dirtyFlagsRef.current.rule) saved = await saveRules(rulesRevision);
    return saved;
  };

  const saveAllSections = async (): Promise<boolean> => {
    if (saveBlockedRef.current) return false;
    let saved = true;
    let rulesRevision: number | undefined;
    if (dirtyFlagsRef.current.category) {
      const categoryResult = await saveCategories();
      saved = categoryResult.saved;
      rulesRevision = categoryResult.rulesRevision;
    }
    if (saved && dirtyFlagsRef.current.rule) saved = await saveRules(rulesRevision);
    return saved;
  };

  const reloadCurrentSection = async () => {
    const sequence = ++editorRequestSequence.current;
    const generation = draftGeneration.current;
    setState({ kind: "pending", message: t("重载当前规则页面…", "Reloading this rules page…") });
    try {
      const analytics = await api.ruleWorkspaceAnalytics();
      if (!mounted.current || sequence !== editorRequestSequence.current) return;
      if (generation !== draftGeneration.current) {
        const message = t(
          "重载期间产生了新修改，当前草稿已保留。",
          "New edits were made while reloading; the current draft was preserved."
        );
        new Notice(message);
        setState({ kind: "error", message });
        return;
      }
      const reloadAll = saveBlockedRef.current;
      const reloadCategories = reloadAll || currentSection === "categories";
      const reloadRules = reloadAll || currentSection === "matching" || currentSection === "health";
      const nextCategoryDirty = reloadCategories ? false : dirtyFlagsRef.current.category;
      const nextRuleDirty = reloadRules ? false : dirtyFlagsRef.current.rule;
      setDirtyFlags(nextCategoryDirty, nextRuleDirty);
      setWorkspace((current) => current ? {
        ...current,
        ...(reloadCategories ? {
          categories_revision: analytics.categories_revision,
          categories: analytics.categories
        } : {}),
        ...(reloadRules ? {
          rules_revision: analytics.rules_revision,
          rules: analytics.rules
        } : {}),
        historical_products: analytics.historical_products,
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      } : current);
      setAnalyticsReady(true);
      setHistoryPanelKey((value) => value + 1);
      applyAnalytics(analytics);
      if (reloadAll) clearSaveBlock();
      const message = t("当前规则页面已重载。", "The current rules page was reloaded.");
      new Notice(message);
      setState({ kind: "success", message });
    } catch (error) {
      if (!mounted.current || sequence !== editorRequestSequence.current) return;
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  };

  const createRuleImmediately = async (rule: SavedRule) => {
    if (saveBlockedRef.current) {
      throw new AssetTrackError({ code: "revision_conflict", status: 409 });
    }
    if (dirtyFlagsRef.current.category || dirtyFlagsRef.current.rule) {
      throw new AssetTrackError({ code: "rules.unsaved_changes", status: 422 });
    }
    const conditionKey = ruleConditionKey(rule);
    const duplicate = conditionKey !== null && workspace.rules.some((current) =>
      current.id !== rule.id && ruleConditionKey(current) === conditionKey
    );
    if (duplicate) {
      throw new AssetTrackError({ code: "rules.duplicate", status: 422 });
    }
    const sequence = ++editorRequestSequence.current;
    const generation = draftGeneration.current;
    setRuleState({ kind: "pending", message: t("正在保存规则…", "Saving rule…") });
    let savedToDatabase = false;
    let commitReported = false;
    let savedResult: Awaited<ReturnType<ConfigurationEditorPort["saveRules"]>>;
    const reportConcurrentCommit = () => {
      if (commitReported || !mounted.current) return;
      commitReported = true;
      blockSaves();
      reportCommittedConfigurationSave();
      const message = t(
        "规则已保存，但保存期间产生了新修改；当前草稿已保留，请重新加载后继续。",
        "The rule was saved, but new edits were made while saving; the current draft was preserved. Reload before continuing."
      );
      new Notice(message);
      setRuleState({ kind: "success", message });
    };
    try {
      const nextRules = rule.id
        ? workspace.rules.map((current) => current.id === rule.id ? { ...rule } : { ...current })
        : [...workspace.rules.map((current) => ({ ...current })), { ...rule }];
      savedResult = await api.saveRules(workspace.rules_revision, nextRules, { source_page: "配置/规则工作台" });
      savedToDatabase = true;
      if (!currentConfigurationRequest(sequence, generation)) {
        reportConcurrentCommit();
        return;
      }
      let analytics: Awaited<ReturnType<ConfigurationEditorPort["ruleWorkspaceAnalytics"]>>;
      try {
        analytics = await api.ruleWorkspaceAnalytics();
      } catch {
        if (!currentConfigurationRequest(sequence, generation)) {
          reportConcurrentCommit();
          return;
        }
        setWorkspace((current) => current ? {
          ...current,
          rules_revision: savedResult.revision,
          rules: savedResult.rows as unknown as SavedRule[]
        } : current);
        setHistoryPanelKey((value) => value + 1);
        commitReported = true;
        reportCommittedConfigurationSave();
        const message = t(
          "规则已保存，但数据健康刷新失败；已保留本次规则，请稍后重载。",
          "The rule was saved, but data-health refresh failed; the saved rule was kept. Reload later."
        );
        new Notice(message);
        setRuleState({ kind: "success", message });
        return;
      }
      if (!currentConfigurationRequest(sequence, generation)) {
        reportConcurrentCommit();
        return;
      }
      applyAnalytics(analytics);
      setHistoryPanelKey((value) => value + 1);
      setRuleState({ kind: "success", message: t("规则已保存，数据健康表已刷新。", "Rule saved and the data-health table was refreshed.") });
      new Notice(t("规则已直接保存，数据健康表已刷新。", "Rule saved directly and the data-health table was refreshed."));
      skipNextDataVersion.current = true;
      commitReported = true;
      onSaved();
      onDataChanged();
    } catch (error) {
      if (savedToDatabase && !commitReported) {
        skipNextDataVersion.current = false;
        commitReported = true;
        onSaved();
        onDataChanged();
      }
      const message = messageFor(error);
      new Notice(message);
      setRuleState({ kind: "error", message });
      throw error;
    }
  };

  const openMatchingRulesPage = () => {
    onSectionChange?.("matching");
    hostWindow.setTimeout(() => rulesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const openProductDetail = (group: HistoricalProductStat, query: ProductHistoryQuery) => {
    new RuleHistoryModal({ app, api, categories: workspace.categories, mode: "product", initialQuery: query, detailOnly: true, detailGroup: group, confirmAction, onSaved: handleHistorySaved, onDataChanged }).open();
  };
  const openProductRename = (group: ProductRenameGroup) => {
    new ProductRenameModal({ app, api, group, onSaved: handleHistorySaved, onDataChanged }).open();
  };
  const openCounterpartyRename = (group: CounterpartyRenameGroup) => {
    new CounterpartyRenameModal({ app, api, group, onSaved: handleHistorySaved, onDataChanged }).open();
  };
  const openRuleCreation = (group: HistoricalProductStat) => {
    const suggestion = group.rule_suggestion;
    new RuleCreationModal({
      app,
      categories: workspace.categories,
      initial: {
        transaction_type: group.transaction_type,
        match_scope: suggestion?.match_scope ?? "product",
        counterparty: suggestion?.counterparty ?? "",
        product: suggestion?.product ?? group.product,
        category_key: suggestion?.category_key ?? group.recommended_category_key ?? "",
        category: suggestion?.category ?? group.recommended_category
      },
      onConfirm: createRuleImmediately
    }).open();
  };
  const openCategoryHistory = (initialQuery: ProductHistoryQuery) => {
    new RuleHistoryModal({ app, api, categories: workspace.categories, mode: "category", initialQuery, confirmAction, onSaved: handleHistorySaved, onDataChanged }).open();
  };
  const removeCategory = async (category: CategoryDefinition, index: number) => {
    const reasons: string[] = [];
    if ((category.transaction_count ?? 0) > 0) reasons.push(t(`${category.transaction_count} 条历史流水`, `${category.transaction_count} historical transactions`));
    if ((category.rule_count ?? 0) > 0) reasons.push(t(`${category.rule_count} 条规则`, `${category.rule_count} rules`));
    if (reasons.length > 0) {
      const actions: Array<{ text: string; onClick?: () => void }> = [{ text: t("关闭", "Close") }];
      if ((category.transaction_count ?? 0) > 0) actions.push({ text: t("打开历史迁移", "Open history migration"), onClick: () => openCategoryHistory({ category_key: category.category_key }) });
      if ((category.rule_count ?? 0) > 0) actions.push({ text: t("查看规则", "View rules"), onClick: openMatchingRulesPage });
      alertAction(app, t("无法删除分类", "Category cannot be deleted"), t(`该分类仍绑定${reasons.join("和")}，请先处理这些引用。`, `This category is still bound to ${reasons.join(" and ")}. Resolve these references first.`), actions);
      return;
    }
    const confirmed = await confirmAction(t("确认删除分类？", "Confirm category deletion?"), t(`分类“${category.name}”没有历史流水或规则引用，删除后不可恢复。`, `Category “${category.name}” has no historical transactions or rule references and cannot be restored after deletion.`), t("确认删除", "Delete category"));
    if (!confirmed) return;
    setWorkspace((current) => current ? {
      ...current,
      categories: current.categories.filter((candidate) => candidate.category_key !== category.category_key)
    } : current);
    markCategoryDirty();
  };

  actionRef.current = {
    hasUnsavedChanges: () => dirtyFlagsRef.current.category || dirtyFlagsRef.current.rule,
    getDraftSnapshot: getRulesDraftSnapshot,
    save: saveCurrentSection,
    saveAll: saveAllSections,
    discard: reloadCurrentSection,
    discardAll: load
  };

  return <main className="asset-track-editor">
    {(section === undefined || section === "health") && <Section>
      <HistoryBackfillContent
        key={`data-health-${historyPanelKey}`}
        api={api}
        categories={workspace.categories}
        mode="product"
        embedded
        hostWindow={hostWindow}
        initialQuery={{ issue_filter: "conflict" }}
        hideIssueFilter
        confirmAction={confirmAction}
        onSaved={handleHistorySaved}
        onDataChanged={onDataChanged}
        onOpenDetail={openProductDetail}
        onOpenProductRename={openProductRename}
      />
    </Section>}
    {section === "products" && <Section>
      <HistoryBackfillContent
        key={`product-overview-${historyGroupBy}-${historyPanelKey}`}
        api={api}
        categories={workspace.categories}
        mode="product"
        overview
        groupBy={historyGroupBy}
        onGroupBy={setHistoryGroupBy}
        embedded
        hostWindow={hostWindow}
        initialQuery={{}}
        confirmAction={confirmAction}
        onSaved={handleHistorySaved}
        onDataChanged={onDataChanged}
        onOpenDetail={openProductDetail}
        onOpenProductRename={openProductRename}
        onOpenCounterpartyRename={openCounterpartyRename}
        onCreateRule={openRuleCreation}
      />
    </Section>}
    {(section === undefined || section === "categories") && <CategoryDefinitionsTable
      categories={workspace.categories}
      sort={categorySort}
      onSort={setCategorySort}
      onChange={updateCategories}
      onRemove={removeCategory}
      onOpenHistory={openCategoryHistory}
      showSectionActions={section === "categories"}
      dirty={categoryDirty && !saveBlocked}
      saveBlocked={saveBlocked}
      pageState={state}
      saveState={categoryState}
      onReload={reloadCurrentSection}
      onSave={async () => { await saveCategories(); }}
      readWindow={section === "categories" ? workspace.scope : null}
    />}
    {(section === undefined || section === "matching") && <MatchingRulesTable
      rules={workspace.rules}
      categories={workspace.categories}
      sort={ruleSort}
      onSort={setRuleSort}
      onChange={updateRules}
      onRemove={removeRule}
      showSectionActions={section === "matching"}
      dirty={ruleDirty && !saveBlocked}
      pageState={state}
      saveState={ruleState}
      onReload={reloadCurrentSection}
      onSave={async () => { await saveRules(); }}
      readWindow={section === "matching" ? workspace.scope : null}
      sectionRef={rulesSectionRef}
    />}
  </main>;
});
