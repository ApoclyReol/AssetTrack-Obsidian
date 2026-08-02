import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, type App } from "obsidian";
import type {
  CategoryDefinition,
  HistoricalProductStat,
  ProductHistoryQuery,
  RuleConflictGroup,
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
import { normalizeProduct } from "./transactionGrouping";
import { CATEGORY_COLORS } from "../domain/categoryColors";
import { businessLabel, t } from "../i18n";
import {
  HistoryBackfillContent,
  ProductRenameModal,
  RuleCreationModal,
  RuleHistoryModal
} from "./RuleHistoryModal";
import { alertAction } from "./ConfirmModal";
import { ActionTableHeader } from "./TablePrimitives";
import {
  clone,
  EmptyState,
  messageFor,
  OperationState,
  Section,
  SortButton,
  sortRows,
  type SortState,
  Status
} from "./editorPrimitives";
import type {
  EditorDraftSnapshot,
  RulesEditorDraftSnapshot
} from "./editorDraft";

type HealthFilter = "all" | "conflict" | "rule-conflict" | "duplicate" | "inactive" | "uncategorized" | "no-rule" | "mismatch";
type ConflictView = "product" | "rule";

const CATEGORY_RAINBOW = CATEGORY_COLORS;

const EMPTY_RULE_HEALTH_SUMMARY: RuleHealthSummary = {
  product_conflicts: 0,
  rule_conflicts: 0,
  duplicate_rules: 0,
  inactive_category_transactions: 0,
  uncategorized_transactions: 0,
  stable_products_without_rule: 0
};

function ruleConflictKindLabel(kind: RuleConflictGroup["kind"]): string {
  return {
    duplicate: t("重复规则", "Duplicate rules"),
    "same-condition": t("同条件不同分类", "Same conditions, different categories"),
    overlap: t("条件重叠", "Overlapping conditions")
  }[kind];
}

function ruleConflictDescription(kind: RuleConflictGroup["kind"]): string {
  return {
    duplicate: t("规则条件和分类完全相同。", "The rule conditions and category are identical."),
    "same-condition": t("规则条件相同，但目标分类不同。", "The rule conditions are identical but target different categories."),
    overlap: t("规则条件重叠，且目标分类不同。", "The rule conditions overlap but target different categories.")
  }[kind];
}

function RuleConflictPanel({
  groups,
  rules,
  categories,
  localDirty,
  onUpdateRule,
  onDeleteRule
}: {
  groups: RuleConflictGroup[];
  rules: SavedRule[];
  categories: CategoryDefinition[];
  localDirty: boolean;
  onUpdateRule: (id: number, patch: Partial<SavedRule>) => void;
  onDeleteRule: (id: number) => void;
}) {
  const currentRules = new Map(
    rules.flatMap((rule) => rule.id === undefined ? [] : [[Number(rule.id), rule] as const])
  );
  return <div className="asset-track-rule-conflict-panel">
    <p>{t("规则冲突不会自动选择第一条。请编辑条件或分类，保存后重新检查。", "Rule conflicts never choose the first match automatically. Edit the conditions or category, save, and check again.")}</p>
    {localDirty && <p role="status">{t("当前存在未保存规则修改，冲突统计将在保存后刷新。", "Unsaved rule changes exist. Conflict analysis refreshes after saving.")}</p>}
    {!groups.length ? <EmptyState text={t("暂无规则冲突。", "No rule conflicts.")} /> : <div className="asset-track-rule-conflict-list">
      {groups.map((group) => <article className="asset-track-rule-conflict-card" key={group.conflict_key}>
        <header>
          <div>
            <strong>{ruleConflictKindLabel(group.kind)}</strong>
            <p>{ruleConflictDescription(group.kind)}</p>
          </div>
          <span>{t(`${group.affected_transaction_count} 条流水 · ${group.affected_months.length} 个月份`, `${group.affected_transaction_count} transactions · ${group.affected_months.length} months`)}</span>
        </header>
        <div className="asset-track-rule-conflict-rules">
          {group.rule_ids.map((id) => {
            const rule = currentRules.get(id);
            if (!rule) return null;
            const options = categories.filter((category) =>
              category.is_active && category.transaction_type === rule.transaction_type
            );
            return <div className="asset-track-rule-conflict-rule" key={id}>
              <select value={rule.transaction_type} aria-label={t(`规则 ${id} 收支`, `Rule ${id} type`)} onChange={(event) => onUpdateRule(id, {
                transaction_type: event.target.value as SavedRule["transaction_type"],
                category_key: "",
                category: ""
              })}>
                <option value="支出">{businessLabel("支出")}</option>
                <option value="收入">{businessLabel("收入")}</option>
              </select>
              <input value={rule.counterparty} placeholder={t("交易对方", "Counterparty")} aria-label={t(`规则 ${id} 交易对方`, `Rule ${id} counterparty`)} onChange={(event) => onUpdateRule(id, { counterparty: event.target.value })} />
              <input value={rule.product} placeholder={t("商品", "Item")} aria-label={t(`规则 ${id} 商品`, `Rule ${id} item`)} onChange={(event) => onUpdateRule(id, { product: event.target.value })} />
              <select value={rule.category_key} aria-label={t(`规则 ${id} 分类`, `Rule ${id} category`)} onChange={(event) => {
                const category = categories.find((item) => item.category_key === event.target.value);
                onUpdateRule(id, { category_key: event.target.value, category: category?.name ?? "" });
              }}>
                <option value="">{t("请选择分类", "Choose category")}</option>
                {options.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
              </select>
              <button type="button" onClick={() => onDeleteRule(id)}>{t("删除规则", "Delete rule")}</button>
            </div>;
          })}
        </div>
      </article>)}
    </div>}
  </div>;
}

export function RulesEditorV2({
  app,
  api,
  hostWindow,
  dataVersion,
  onDirty,
  initialDraft,
  onDraftChange,
  onSaved,
  onDataChanged,
  confirmAction
}: {
  app: App;
  api: AssetTrackService;
  hostWindow: Window;
  dataVersion: number;
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
}) {
  const [workspace, setWorkspace] = useState<RuleWorkspace | null>(
    initialDraft ? clone(initialDraft.workspace) : null
  );
  const [analyticsReady, setAnalyticsReady] = useState(
    initialDraft?.analytics_ready ?? false
  );
  const [categorySort, setCategorySort] = useState<SortState>(null);
  const [ruleSort, setRuleSort] = useState<SortState>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [conflictView, setConflictView] = useState<ConflictView>("product");
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [historyPanelQuery, setHistoryPanelQuery] = useState<ProductHistoryQuery | undefined>();
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
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [api, applyAnalytics]);

  const handleHistorySaved = useCallback(() => {
    setHistoryPanelKey((value) => value + 1);
    void loadAnalytics();
    onSaved();
  }, [loadAnalytics, onSaved]);

  const load = useCallback(async () => {
    setState({ kind: "pending", message: t("加载规则工作台…", "Loading the rules workspace…") });
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
      setState({ kind: "error", message: messageFor(error) });
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
      setState({ kind: "success", message: t("未保存的分类和规则草稿已恢复。", "The unsaved category and rule draft was restored.") });
      void api.ruleWorkspaceShell()
        .then((current) => {
          if (current.categories_revision !== restored.workspace.categories_revision || current.rules_revision !== restored.workspace.rules_revision) {
            setState({ kind: "error", message: t("草稿已恢复，但其他窗口已修改分类或规则；重新加载前不能覆盖保存。", "The draft was restored, but another window changed categories or rules. Reload before saving.") });
          }
          if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
          analyticsTimer.current = hostWindow.setTimeout(() => { void loadAnalytics(); }, 0);
        })
        .catch((error: unknown) => { setState({ kind: "error", message: messageFor(error) }); });
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
      setState({ kind: "error", message: t("其他窗口已修改规则或历史流水；当前草稿保留，保存前请先重新加载。", "Another window changed rules or historical transactions. The current draft is preserved; reload before saving.") });
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
  const ruleStatusLabel = (value: unknown) => ({
    正常: t("正常", "Normal"),
    重复: t("重复", "Duplicate"),
    冲突: t("冲突", "Conflict"),
    未创建: t("未创建", "Not created"),
    已覆盖: t("已覆盖", "Covered")
  }[String(value)] ?? t("加载中…", "Loading…"));
  const categoryForKey = (key: string) => workspace.categories.find((category) => category.category_key === key);

  const updateRule = (id: number, patch: Partial<SavedRule>) => {
    const index = workspace.rules.findIndex((rule) => Number(rule.id) === id);
    if (index < 0) return;
    const rules = clone(workspace.rules);
    rules[index] = { ...rules[index], ...patch };
    setWorkspace({ ...workspace, rules });
    markRuleDirty();
  };

  const deleteRule = async (id: number) => {
    const rule = workspace.rules.find((item) => Number(item.id) === id);
    if (!rule) return;
    const confirmed = await confirmAction(
      t("确认删除规则？", "Confirm rule deletion?"),
      t(`将删除“${rule.counterparty || "（未限定交易对方）"} / ${rule.product || "（未限定商品）"}”规则；历史流水不会被修改。`, `This will delete the rule for “${rule.counterparty || "(any counterparty)"} / ${rule.product || "(any item)"}”. Historical transactions will not change.`),
      t("删除规则", "Delete rule")
    );
    if (!confirmed) return;
    setWorkspace({ ...workspace, rules: workspace.rules.filter((item) => Number(item.id) !== id) });
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
      setRuleState({ kind: "error", message: t("请先保存分类，再保存匹配规则。", "Save categories before saving matching rules.") });
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

  const createRuleImmediately = async (rule: SavedRule) => {
    if (categoryDirtyRef.current || ruleDirtyRef.current) {
      throw new AssetTrackError({ code: "unsaved_rule_changes", status: 422, message: t("当前有未保存的分类或规则修改，请先保存后再直接创建规则。", "Save the current category or rule changes before creating a rule directly.") });
    }
    const normalizedCounterparty = normalizeProduct(rule.counterparty);
    const normalizedProduct = normalizeProduct(rule.product);
    const duplicate = workspace.rules.some((current) => current.transaction_type === rule.transaction_type && normalizeProduct(current.counterparty) === normalizedCounterparty && normalizeProduct(current.product) === normalizedProduct);
    if (duplicate) {
      throw new AssetTrackError({ code: "duplicate_rule", status: 422, message: t("相同的收支、交易对方和商品规则已经存在。", "A rule with the same type, counterparty, and item already exists.") });
    }
    setRuleState({ kind: "pending", message: t("正在保存规则…", "Saving rule…") });
    let savedToDatabase = false;
    try {
      await api.saveRules(workspace.rules_revision, [...workspace.rules.map((current) => ({ ...current })), { ...rule }]);
      savedToDatabase = true;
      const analytics = await api.ruleWorkspaceAnalytics();
      applyAnalytics(analytics);
      setHistoryPanelKey((value) => value + 1);
      setRuleState({ kind: "success", message: t("规则已保存，冲突面板已刷新。", "Rule saved and the conflict panel was refreshed.") });
      new Notice(t("规则已直接保存，冲突面板已刷新。", "Rule saved directly and the conflict panel was refreshed."));
      skipNextDataVersion.current = true;
      onSaved();
      onDataChanged();
    } catch (error) {
      if (savedToDatabase) {
        skipNextDataVersion.current = false;
        onSaved();
        onDataChanged();
      }
      setRuleState({ kind: "error", message: messageFor(error) });
      throw error;
    }
  };

  const openProductPanel = (initialQuery?: ProductHistoryQuery) => {
    setConflictView("product");
    setHistoryPanelQuery({ ...(historyPanelQuery ?? {}), ...(initialQuery ?? { issue_filter: "conflict" }) });
    setHistoryPanelKey((value) => value + 1);
    setHistoryPanelOpen(true);
  };
  const openRuleConflictPanel = (focusRules = false, filter: "rule-conflict" | "duplicate" = "rule-conflict") => {
    setConflictView("rule");
    setHealthFilter(filter);
    setHistoryPanelOpen(true);
    if (focusRules) hostWindow.setTimeout(() => rulesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const openProductDetail = (group: HistoricalProductStat, query: ProductHistoryQuery) => {
    new RuleHistoryModal({ app, api, categories: workspace.categories, mode: "product", initialQuery: query, detailOnly: true, detailGroup: group, confirmAction, onSaved: handleHistorySaved, onDataChanged }).open();
  };
  const openProductRename = (group: HistoricalProductStat) => {
    new ProductRenameModal({ app, api, categories: workspace.categories, group, confirmAction, onSaved: handleHistorySaved, onDataChanged }).open();
  };
  const openRuleCreation = (group: HistoricalProductStat) => {
    const suggestion = group.rule_suggestion;
    new RuleCreationModal({
      app,
      categories: workspace.categories,
      initial: {
        transaction_type: group.transaction_type,
        counterparty: suggestion?.counterparty ?? group.counterparty,
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
      if ((category.rule_count ?? 0) > 0) actions.push({ text: t("查看规则", "View rules"), onClick: () => openRuleConflictPanel(true) });
      alertAction(app, t("无法删除分类", "Category cannot be deleted"), t(`该分类仍绑定${reasons.join("和")}，请先处理这些引用。`, `This category is still bound to ${reasons.join(" and ")}. Resolve these references first.`), actions);
      return;
    }
    const confirmed = await confirmAction(t("确认删除分类？", "Confirm category deletion?"), t(`分类“${category.name}”没有历史流水或规则引用，删除后不可恢复。`, `Category “${category.name}” has no historical transactions or rule references and cannot be restored after deletion.`), t("确认删除", "Delete category"));
    if (!confirmed) return;
    setWorkspace({ ...workspace, categories: workspace.categories.filter((_, rowIndex) => rowIndex !== index) });
    markCategoryDirty();
  };

  const categoryView = sortRows(workspace.categories, categorySort, (row, key) => row[key as keyof CategoryDefinition]);
  const ruleView = sortRows(workspace.rules, ruleSort, (row, key) => row[key as keyof SavedRule]);
  const visibleRuleConflicts = workspace.rule_conflicts.filter((group) => healthFilter === "duplicate" ? group.kind === "duplicate" : healthFilter === "rule-conflict" ? group.kind !== "duplicate" : true);
  const summaryCards: Array<[keyof RuleHealthSummary, string, Exclude<HealthFilter, "all">]> = [
    ["product_conflicts", t("商品分类冲突", "Product conflicts"), "conflict"],
    ["rule_conflict_groups", t("自动规则冲突", "Rule conflicts"), "rule-conflict"],
    ["duplicate_rule_groups", t("重复规则", "Duplicate rules"), "duplicate"],
    ["inactive_category_transactions", t("停用分类流水", "Inactive-category transactions"), "inactive"],
    ["uncategorized_transactions", t("未分类流水", "Uncategorized transactions"), "uncategorized"],
    ["stable_products_without_rule", t("稳定商品无规则", "Stable items without rules"), "no-rule"]
  ];

  return <main className="asset-track-editor">
    <section className="asset-track-month-header">
      <div>
        <h2>{t("规则工作台", "Rules workspace")}</h2>
        <span>{t("分类、匹配和按需处理历史问题", "Categories, matching, and on-demand history issue handling")}</span>
      </div>
    </section>
    <Status state={state} />
    <Section title={t("规则健康摘要", "Rule health summary")}>
      <div className="asset-track-health-grid">
        {summaryCards.map(([key, label, filter]) => <button key={key} type="button" className={`asset-track-health-card${healthFilter === filter ? " is-active" : ""}`} disabled={!analyticsReady} aria-pressed={healthFilter === filter} onClick={() => { setHealthFilter(filter); if (filter === "rule-conflict" || filter === "duplicate") openRuleConflictPanel(false, filter); else openProductPanel({ issue_filter: filter }); }}>
          <strong>{analyticsReady ? workspace.summary[key] : "…"}</strong>
          <span>{label}</span>
        </button>)}
      </div>
      {historyPanelOpen && <div className="asset-track-health-panel">
        <div className="asset-track-health-panel-heading">
          <strong>{summaryCards.find(([, , filter]) => filter === healthFilter)?.[1] ?? t("问题详情", "Issue details")}</strong>
          <button type="button" onClick={() => setHistoryPanelOpen(false)}>{t("收起", "Collapse")}</button>
        </div>
        {conflictView === "product" ? <HistoryBackfillContent key={historyPanelKey} api={api} categories={workspace.categories} mode="product" embedded hostWindow={hostWindow} initialQuery={historyPanelQuery} hideIssueFilter confirmAction={confirmAction} onSaved={handleHistorySaved} onDataChanged={onDataChanged} onOpenDetail={openProductDetail} onOpenProductRename={openProductRename} onCreateRule={openRuleCreation} onQueryChange={setHistoryPanelQuery} onClose={() => setHistoryPanelOpen(false)} /> : <RuleConflictPanel groups={visibleRuleConflicts} rules={workspace.rules} categories={workspace.categories} localDirty={ruleDirty} onUpdateRule={updateRule} onDeleteRule={(id) => void deleteRule(id)} />}
      </div>}
    </Section>
    <Section title={t("分类定义", "Category definitions")}>
      <Status state={categoryState} />
      {categoryView.length === 0 ? <EmptyState text={t("尚无分类定义。", "No category definitions yet.")} /> : <div className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
        <table className="asset-track-category-table"><thead><tr>{[
          ["name", t("名称", "Name")], ["transaction_type", t("收支", "Type")], ["necessity", t("必要性", "Necessity")], ["pattern", t("消费频率", "Frequency")], ["is_big_ticket", t("大额", "Large")], ["color", t("颜色", "Color")], ["transaction_count", t("流水数", "Transactions")]
        ].map(([field, label]) => <th key={field} scope="col" className={field === "is_big_ticket" ? "asset-track-checkbox-heading" : field === "color" ? "asset-track-color-column" : ["transaction_type", "necessity", "pattern"].includes(field) ? "asset-track-type-column" : field === "transaction_count" ? "asset-track-count-column" : undefined}><SortButton field={field} label={label} sort={categorySort} onSort={setCategorySort} /></th>)}<ActionTableHeader /></tr></thead>
          <tbody>{categoryView.map(({ row, originalIndex: index }) => <tr key={row.category_key}>
            <td><input value={row.name} onChange={(event) => { const next = clone(workspace.categories); next[index].name = event.target.value; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }} /></td>
            <td className="asset-track-type-cell"><select value={row.transaction_type} onChange={(event) => { const next = clone(workspace.categories); next[index].transaction_type = event.target.value as "支出" | "收入"; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }}><option value="支出">{businessLabel("支出")}</option><option value="收入">{businessLabel("收入")}</option></select></td>
            <td className="asset-track-type-cell"><select value={row.necessity} onChange={(event) => { const next = clone(workspace.categories); next[index].necessity = event.target.value as CategoryDefinition["necessity"]; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }}>{["必要", "可控", "不适用"].map((value) => <option key={value} value={value}>{businessLabel(value)}</option>)}</select></td>
            <td className="asset-track-type-cell"><select value={row.pattern} onChange={(event) => { const next = clone(workspace.categories); next[index].pattern = event.target.value as CategoryDefinition["pattern"]; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }}>{["周期", "日常", "偶尔", "不适用"].map((value) => <option key={value} value={value}>{businessLabel(value)}</option>)}</select></td>
            <td className="asset-track-checkbox-cell"><input type="checkbox" checked={row.is_big_ticket} onChange={(event) => { const next = clone(workspace.categories); next[index].is_big_ticket = event.target.checked; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }} /></td>
            <td className="asset-track-color-cell"><input type="color" value={row.color} onChange={(event) => { const next = clone(workspace.categories); next[index].color = event.target.value; setWorkspace({ ...workspace, categories: next }); markCategoryDirty(); }} /></td>
            <td className="asset-track-count-cell">{row.transaction_count ?? 0}</td>
            <td className="asset-track-category-actions asset-track-actions-cell">{row.transaction_count ? <button type="button" onClick={() => openCategoryHistory({ category_key: row.category_key })}>{t("迁移", "Migrate")}</button> : null}<button type="button" onClick={() => void removeCategory(row, index)}>{t("删除", "Delete")}</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="asset-track-section-actions">
        <button type="button" onClick={() => { setWorkspace({ ...workspace, categories: [...workspace.categories, { category_key: `cat-user-${crypto.randomUUID()}`, name: "", transaction_type: "支出", necessity: "必要", pattern: "日常", is_big_ticket: false, color: CATEGORY_RAINBOW[workspace.categories.length % CATEGORY_RAINBOW.length], is_active: true, sort_order: workspace.categories.length }] }); markCategoryDirty(); }}>{t("新增分类", "Add category")}</button>
        <button type="button" className="mod-cta" disabled={!categoryDirty || categoryState.kind === "pending"} onClick={() => void saveCategories()}>{t("保存分类", "Save categories")}</button>
      </div>
    </Section>
    <Section title={t("交易匹配规则", "Transaction matching rules")} sectionRef={rulesSectionRef}>
      <Status state={ruleState} />
      {ruleView.length === 0 ? <EmptyState text={t("尚无已保存匹配规则。", "No saved matching rules yet.")} /> : <div className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
        <table className="asset-track-rules-table"><thead><tr>{[
          ["transaction_type", t("收支", "Type")], ["counterparty", t("交易对方", "Counterparty")], ["product", t("商品", "Item")], ["category", t("分类", "Category")], ["rule_status", t("规则状态", "Rule status")], ["occurrences", t("流水数", "Transactions")], ["last_month", t("最近月份", "Latest month")]
        ].map(([field, label]) => <th key={field} scope="col" className={field === "transaction_type" ? "asset-track-type-column" : field === "category" || field === "rule_status" ? "asset-track-centered-column" : field === "occurrences" ? "asset-track-count-column" : field === "last_month" ? "asset-track-date-column" : undefined}><SortButton field={field} label={label} sort={ruleSort} onSort={setRuleSort} /></th>)}<ActionTableHeader /></tr></thead>
          <tbody>{ruleView.map(({ row, originalIndex: index }) => <tr key={String(row.id ?? index)}>
            <td className="asset-track-type-cell"><select value={row.transaction_type} onChange={(event) => { const next = clone(workspace.rules); next[index].transaction_type = event.target.value as "支出" | "收入"; next[index].category_key = ""; next[index].category = ""; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }}><option value="支出">{businessLabel("支出")}</option><option value="收入">{businessLabel("收入")}</option></select></td>
            <td><input value={row.counterparty} onChange={(event) => { const next = clone(workspace.rules); next[index].counterparty = event.target.value; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }} /></td>
            <td><input value={row.product} onChange={(event) => { const next = clone(workspace.rules); next[index].product = event.target.value; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }} /></td>
            <td className="asset-track-centered-cell"><select value={row.category_key} onChange={(event) => { const next = clone(workspace.rules); const category = categoryForKey(event.target.value); next[index].category_key = event.target.value; next[index].category = category?.name ?? ""; setWorkspace({ ...workspace, rules: next }); markRuleDirty(); }}><option value="">{t("请选择", "Select")}</option>{workspace.categories.filter((category) => category.transaction_type === row.transaction_type).map((category) => <option key={category.category_key} value={category.category_key} disabled={!category.is_active}>{category.name}{category.is_active ? "" : ` · ${t("停用", "Inactive")}`}</option>)}</select></td>
            <td className="asset-track-status-cell asset-track-centered-cell">{ruleStatusLabel(row.rule_status)}{row.conflict_rule_ids?.length ? ` · ${row.conflict_rule_ids.length}` : ""}</td><td className="asset-track-count-cell">{row.occurrences ?? "—"}</td><td className="asset-track-date-cell">{row.last_month ?? "—"}</td>
            <td className="asset-track-actions-cell"><button type="button" onClick={() => { setWorkspace({ ...workspace, rules: workspace.rules.filter((_, item) => item !== index) }); markRuleDirty(); }}>{t("删除", "Delete")}</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="asset-track-section-actions">
        <button type="button" onClick={() => { const category = workspace.categories.find((row) => row.is_active && row.transaction_type === "支出"); setWorkspace({ ...workspace, rules: [...workspace.rules, { transaction_type: "支出", counterparty: "", product: "", category_key: category?.category_key ?? "", category: category?.name ?? "" }] }); markRuleDirty(); }}>{t("新增规则", "Add rule")}</button>
        <button type="button" className="mod-cta" disabled={!ruleDirty || ruleState.kind === "pending"} onClick={() => void saveRules()}>{t("保存规则", "Save rules")}</button>
      </div>
    </Section>
  </main>;
}
