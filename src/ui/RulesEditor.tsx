import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Notice, type App } from "obsidian";
import type {
  CategoryDefinition,
  HistoricalProductStat,
  ProductHistoryQuery,
  RuleHealthSummary,
  RuleWorkspace,
  RuleWorkspaceAnalytics,
  RuleWorkspaceShell,
  SavedRule
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { normalizeProductKey } from "../domain/rules";
import { t } from "../i18n";
import {
  HistoryBackfillContent,
  ProductRenameModal,
  type ProductRenameGroup,
  RuleCreationModal,
  RuleHistoryModal
} from "./RuleHistoryModal";
import type { RulesMode } from "../constants";
import { alertAction } from "./ConfirmModal";
import {
  clone,
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

const EMPTY_RULE_HEALTH_SUMMARY: RuleHealthSummary = {
  product_conflicts: 0,
  rule_conflicts: 0,
  duplicate_rules: 0,
  inactive_category_transactions: 0,
  uncategorized_transactions: 0,
  stable_products_without_rule: 0
};

export interface RulesEditorHandle {
  isSectionDirty: () => boolean;
  hasUnsavedChanges: () => boolean;
  save: () => Promise<void>;
  reload: () => Promise<void>;
}

interface RulesEditorProps {
  app: App;
  api: AssetTrackService;
  hostWindow: Window;
  dataVersion: number;
  section?: RulesMode;
  onSectionChange?: (section: RulesMode) => void;
  onDirty: (dirty: boolean) => void;
  initialDraft?: RulesEditorDraftSnapshot;
  onDraftChange: (snapshot: EditorDraftSnapshot | null) => void;
  onSaved: () => void;
  onDataChanged: () => void;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
}

export const RulesEditorV2 = forwardRef<RulesEditorHandle, RulesEditorProps>(function RulesEditorV2({
  app,
  api,
  hostWindow,
  dataVersion,
  section,
  onSectionChange,
  onDirty,
  initialDraft,
  onDraftChange,
  onSaved,
  onDataChanged,
  confirmAction
}, ref) {
  const [workspace, setWorkspace] = useState<RuleWorkspace | null>(
    initialDraft ? clone(initialDraft.workspace) : null
  );
  const [analyticsReady, setAnalyticsReady] = useState(
    initialDraft?.analytics_ready ?? false
  );
  const [categorySort, setCategorySort] = useState<SortState>(null);
  const [ruleSort, setRuleSort] = useState<SortState>(null);
  const [historyPanelKey, setHistoryPanelKey] = useState(0);
  const [categoryDirty, setCategoryDirty] = useState(initialDraft?.category_dirty ?? false);
  const [ruleDirty, setRuleDirty] = useState(initialDraft?.rule_dirty ?? false);
  const [categoryState, setCategoryState] = useState<OperationState>({ kind: "idle" });
  const [ruleState, setRuleState] = useState<OperationState>({ kind: "idle" });
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const lastDataVersion = useRef(dataVersion);
  const localDirtyRef = useRef(Boolean(initialDraft?.category_dirty || initialDraft?.rule_dirty));
  const categoryDirtyRef = useRef(initialDraft?.category_dirty ?? false);
  const ruleDirtyRef = useRef(initialDraft?.rule_dirty ?? false);
  const restoredDraft = useRef(initialDraft ? clone(initialDraft) : null);
  const skipNextDataVersion = useRef(false);
  const analyticsTimer = useRef<number | null>(null);
  const rulesSectionRef = useRef<HTMLElement | null>(null);
  const actionRef = useRef<RulesEditorHandle>({
    isSectionDirty: () => false,
    hasUnsavedChanges: () => false,
    save: async () => undefined,
    reload: async () => undefined
  });
  const currentSection = section ?? "health";
  useImperativeHandle(ref, () => ({
    isSectionDirty: () => actionRef.current.isSectionDirty(),
    hasUnsavedChanges: () => actionRef.current.hasUnsavedChanges(),
    save: () => actionRef.current.save(),
    reload: () => actionRef.current.reload()
  }), [ref]);

  const applyAnalytics = useCallback((analytics: RuleWorkspaceAnalytics) => {
    setWorkspace((current) => {
      if (!current) return current;
      if (!localDirtyRef.current) {
        return {
          ...current,
          categories_revision: analytics.categories_revision,
          rules_revision: analytics.rules_revision,
          categories: analytics.categories,
          rules: analytics.rules,
          recommendations: analytics.recommendations,
          rule_conflicts: analytics.rule_conflicts,
          summary: analytics.summary
        };
      }
      const remoteCategories = new Map(analytics.categories.map((category) => [category.category_key, category]));
      const remoteRules = new Map(analytics.rules.map((rule) => [Number(rule.id ?? 0), rule]));
      return {
        ...current,
        categories: current.categories.map((category) => {
          const remote = remoteCategories.get(category.category_key);
          return remote ? {
            ...category,
            transaction_count: remote.transaction_count,
            rule_count: remote.rule_count,
            impact_months: remote.impact_months,
            conflict_product_count: remote.conflict_product_count
          } : category;
        }),
        rules: current.rules.map((rule) => {
          const remote = remoteRules.get(Number(rule.id ?? 0));
          return remote ? {
            ...rule,
            rule_status: remote.rule_status,
            duplicate_rule_ids: remote.duplicate_rule_ids,
            conflict_rule_ids: remote.conflict_rule_ids,
            occurrences: remote.occurrences,
            months_count: remote.months_count,
            last_month: remote.last_month,
            match_level: remote.match_level
          } : rule;
        }),
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      };
    });
    setAnalyticsReady(true);
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const analytics = await api.ruleWorkspaceAnalytics();
      applyAnalytics(analytics);
      setState((current) => current.kind === "error" ? current : { kind: "idle" });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [api, applyAnalytics]);

  const handleHistorySaved = useCallback(() => {
    setHistoryPanelKey((value) => value + 1);
    void loadAnalytics();
    onSaved();
  }, [loadAnalytics, onSaved]);

  const load = useCallback(async () => {
    setState({ kind: "pending", message: t("加载数据健康…", "Loading data health…") });
    try {
      const shell: RuleWorkspaceShell = await api.ruleWorkspaceShell();
      setWorkspace({ ...shell, recommendations: [], historical_products: [], rule_conflicts: [], summary: EMPTY_RULE_HEALTH_SUMMARY });
      setAnalyticsReady(false);
      setCategoryDirty(false);
      setRuleDirty(false);
      localDirtyRef.current = false;
      categoryDirtyRef.current = false;
      ruleDirtyRef.current = false;
      onDirty(false);
      setState({ kind: "idle" });
      if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
      analyticsTimer.current = hostWindow.setTimeout(() => { void loadAnalytics(); }, 0);
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  }, [api, hostWindow, loadAnalytics, onDirty]);

  useEffect(() => {
    const restored = restoredDraft.current;
    if (!restored) {
      void load();
    } else {
      restoredDraft.current = null;
      onDirty(true);
      onDraftChange(restored);
      const message = t("未保存的分类和规则草稿已恢复。", "The unsaved category and rule draft was restored.");
      setState({ kind: "success", message });
      new Notice(message);
      void api.ruleWorkspaceShell()
        .then((current) => {
          if (current.categories_revision !== restored.workspace.categories_revision || current.rules_revision !== restored.workspace.rules_revision) {
            const message = t("草稿已恢复，但其他窗口已修改分类或规则；重新加载前不能覆盖保存。", "The draft was restored, but another window changed categories or rules. Reload before saving.");
            setState({ kind: "error", message });
            new Notice(message);
          }
          if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
          analyticsTimer.current = hostWindow.setTimeout(() => { void loadAnalytics(); }, 0);
        })
        .catch((error: unknown) => {
          const message = messageFor(error);
          new Notice(message);
          setState({ kind: "error", message });
        });
    }
    return () => {
      if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
    };
  }, [api, hostWindow, load, loadAnalytics, onDirty, onDraftChange]);

  useEffect(() => {
    if (!workspace) return;
    if (!categoryDirty && !ruleDirty) {
      onDraftChange(null);
      return;
    }
    onDraftChange({ kind: "rules", workspace: clone(workspace), category_dirty: categoryDirty, rule_dirty: ruleDirty, analytics_ready: analyticsReady });
  }, [analyticsReady, categoryDirty, onDraftChange, ruleDirty, workspace]);

  useEffect(() => {
    if (lastDataVersion.current === dataVersion) return;
    lastDataVersion.current = dataVersion;
    if (skipNextDataVersion.current) {
      skipNextDataVersion.current = false;
      return;
    }
    if (localDirtyRef.current) {
      const message = t("其他窗口已修改规则或历史流水；当前草稿保留，保存前请先重新加载。", "Another window changed rules or historical transactions. The current draft is preserved; reload before saving.");
      new Notice(message);
      setState({ kind: "error", message });
      return;
    }
    void load();
  }, [dataVersion, load]);

  if (!workspace) return <Status state={state} />;

  const setDirtyFlags = (nextCategoryDirty: boolean, nextRuleDirty: boolean) => {
    const nextLocalDirty = nextCategoryDirty || nextRuleDirty;
    setCategoryDirty(nextCategoryDirty);
    setRuleDirty(nextRuleDirty);
    categoryDirtyRef.current = nextCategoryDirty;
    ruleDirtyRef.current = nextRuleDirty;
    localDirtyRef.current = nextLocalDirty;
    onDirty(nextLocalDirty);
  };
  const markCategoryDirty = () => setDirtyFlags(true, ruleDirtyRef.current);
  const markRuleDirty = () => setDirtyFlags(categoryDirtyRef.current, true);
  const updateCategories = (categories: CategoryDefinition[]) => {
    setWorkspace((current) => current ? { ...current, categories } : current);
    markCategoryDirty();
  };
  const updateRules = (rules: SavedRule[]) => {
    setWorkspace((current) => current ? { ...current, rules } : current);
    markRuleDirty();
  };

  const saveCategories = async () => {
    setCategoryState({ kind: "pending", message: t("保存分类…", "Saving categories…") });
    try {
      const result = await api.saveCategories(workspace.categories_revision, workspace.categories);
      const analytics = await api.ruleWorkspaceAnalytics();
      const categoryNames = new Map(result.rows.map((category) => [category.category_key, category.name]));
      setWorkspace((current) => current ? {
        ...current,
        categories_revision: result.revision,
        categories: result.rows,
        rules_revision: analytics.rules_revision,
        rules: ruleDirtyRef.current ? current.rules.map((rule) => ({ ...rule, category: categoryNames.get(rule.category_key) ?? rule.category })) : analytics.rules,
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      } : current);
      setDirtyFlags(false, ruleDirtyRef.current);
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
      new Notice(t("分类已保存。", "Categories saved."));
      setCategoryState({ kind: "success", message: t("分类已保存。", "Categories saved.") });
    } catch (error) {
      new Notice(messageFor(error));
      setCategoryState({ kind: "error", message: messageFor(error) });
    }
  };

  const saveRules = async () => {
    if (categoryDirtyRef.current) {
      const message = t("请先保存分类，再保存匹配规则。", "Save categories before saving matching rules.");
      new Notice(message);
      setRuleState({ kind: "error", message });
      return;
    }
    setRuleState({ kind: "pending", message: t("保存匹配规则…", "Saving matching rules…") });
    try {
      const categoryNames = new Map(workspace.categories.map((category) => [category.category_key, category.name]));
      await api.saveRules(workspace.rules_revision, workspace.rules.map((rule) => ({ ...rule, category: categoryNames.get(rule.category_key) ?? rule.category })));
      const analytics = await api.ruleWorkspaceAnalytics();
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
      setDirtyFlags(categoryDirtyRef.current, false);
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
      new Notice(t("匹配规则已保存。", "Matching rules saved."));
      setRuleState({ kind: "success", message: t("匹配规则已保存。", "Matching rules saved.") });
    } catch (error) {
      new Notice(messageFor(error));
      setRuleState({ kind: "error", message: messageFor(error) });
    }
  };

  const saveCurrentSection = async () => {
    if (currentSection === "categories") {
      await saveCategories();
      return;
    }
    if (currentSection === "matching") {
      await saveRules();
      return;
    }
    if (categoryDirtyRef.current) await saveCategories();
    if (ruleDirtyRef.current) await saveRules();
  };

  const reloadCurrentSection = async () => {
    setState({ kind: "pending", message: t("重载当前规则页面…", "Reloading this rules page…") });
    try {
      const analytics = await api.ruleWorkspaceAnalytics();
      const reloadCategories = currentSection === "categories";
      const reloadRules = currentSection === "matching" || currentSection === "health";
      const nextCategoryDirty = reloadCategories ? false : categoryDirtyRef.current;
      const nextRuleDirty = reloadRules ? false : ruleDirtyRef.current;
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
        recommendations: analytics.recommendations,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      } : current);
      setAnalyticsReady(true);
      setHistoryPanelKey((value) => value + 1);
      const message = t("当前规则页面已重载。", "The current rules page was reloaded.");
      new Notice(message);
      setState({ kind: "success", message });
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      setState({ kind: "error", message });
    }
  };

  const createRuleImmediately = async (rule: SavedRule) => {
    if (categoryDirtyRef.current || ruleDirtyRef.current) {
      throw new AssetTrackError({ code: "unsaved_rule_changes", status: 422, message: t("当前有未保存的分类或规则修改，请先保存后再直接创建规则。", "Save the current category or rule changes before creating a rule directly.") });
    }
    const normalizedProduct = normalizeProductKey(rule.product);
    const duplicate = workspace.rules.some((current) => current.transaction_type === rule.transaction_type && normalizeProductKey(current.product) === normalizedProduct);
    if (duplicate) {
      throw new AssetTrackError({ code: "duplicate_rule", status: 422, message: t("相同的收支和商品规则已经存在。", "A rule with the same type and item already exists.") });
    }
    setRuleState({ kind: "pending", message: t("正在保存规则…", "Saving rule…") });
    let savedToDatabase = false;
    try {
      await api.saveRules(workspace.rules_revision, [...workspace.rules.map((current) => ({ ...current })), { ...rule }]);
      savedToDatabase = true;
      const analytics = await api.ruleWorkspaceAnalytics();
      applyAnalytics(analytics);
      setHistoryPanelKey((value) => value + 1);
      setRuleState({ kind: "success", message: t("规则已保存，数据健康表已刷新。", "Rule saved and the data-health table was refreshed.") });
      new Notice(t("规则已直接保存，数据健康表已刷新。", "Rule saved directly and the data-health table was refreshed."));
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
    } catch (error) {
      if (savedToDatabase) {
        skipNextDataVersion.current = false;
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
  const openRuleCreation = (group: HistoricalProductStat) => {
    const suggestion = group.rule_suggestion;
    new RuleCreationModal({
      app,
      categories: workspace.categories,
      initial: {
        transaction_type: group.transaction_type,
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
    setWorkspace({ ...workspace, categories: workspace.categories.filter((_, rowIndex) => rowIndex !== index) });
    markCategoryDirty();
  };

  actionRef.current = {
    isSectionDirty: () => currentSection === "categories"
      ? categoryDirtyRef.current
      : currentSection === "matching"
        ? ruleDirtyRef.current
        : categoryDirtyRef.current || ruleDirtyRef.current,
    hasUnsavedChanges: () => categoryDirtyRef.current || ruleDirtyRef.current,
    save: saveCurrentSection,
    reload: reloadCurrentSection
  };

  return <main className="asset-track-editor">
    {(section === undefined || section === "health") && <Section>
      <HistoryBackfillContent
        key={`health-conflicts-${historyPanelKey}`}
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
        onCreateRule={openRuleCreation}
      />
    </Section>}
    {section === "products" && <Section>
      <HistoryBackfillContent
        key={`product-overview-${historyPanelKey}`}
        api={api}
        categories={workspace.categories}
        mode="product"
        overview
        embedded
        hostWindow={hostWindow}
        initialQuery={{}}
        confirmAction={confirmAction}
        onSaved={handleHistorySaved}
        onDataChanged={onDataChanged}
        onOpenDetail={openProductDetail}
        onOpenProductRename={openProductRename}
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
      dirty={categoryDirty}
      pageState={state}
      saveState={categoryState}
      onReload={reloadCurrentSection}
      onSave={saveCategories}
    />}
    {(section === undefined || section === "matching") && <MatchingRulesTable
      rules={workspace.rules}
      categories={workspace.categories}
      sort={ruleSort}
      onSort={setRuleSort}
      onChange={updateRules}
      showSectionActions={section === "matching"}
      dirty={ruleDirty}
      pageState={state}
      saveState={ruleState}
      onReload={reloadCurrentSection}
      onSave={saveRules}
      sectionRef={rulesSectionRef}
    />}
  </main>;
});
