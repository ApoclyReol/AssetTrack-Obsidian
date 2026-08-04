import { Modal, Notice, type App } from "obsidian";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  CategoryBackfillPreview,
  CategoryDefinition,
  HistoricalProductStat,
  ProductHistoryIssueFilter,
  ProductHistoryQuery,
  ProductHistoryTransaction
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { businessLabel, displayError, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { normalizeProductKey } from "../domain/rules";
import { scalarText } from "../domain/text";
import { ActionTableHeader, StaticTableHeader } from "./TablePrimitives";
import { EmptyState } from "./editorPrimitives";
export {
  ProductRenameContent,
  ProductRenameModal,
  type ProductRenameGroup,
  type ProductRenameModalOptions
} from "./ProductRenameModal";
export { RuleCreationModal, type RuleCreationModalOptions } from "./RuleCreationModal";

type HistoryMode = "product" | "category";
type SortDirection = "asc" | "desc";
type HistorySort = {
  key: string;
  direction: SortDirection;
};

interface HistoryFilters {
  transaction_type: "" | "支出" | "收入";
  category_key: string;
  issue_filter: "" | ProductHistoryIssueFilter;
  product_search: string;
  from_month: string;
  to_month: string;
  min_occurrences: string;
}

export interface RuleHistoryModalOptions {
  app: App;
  api: AssetTrackService;
  categories: CategoryDefinition[];
  mode: HistoryMode;
  initialQuery?: ProductHistoryQuery;
  detailOnly?: boolean;
  detailGroup?: HistoricalProductStat;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
  onSaved: () => void;
  onDataChanged: () => void;
  onOpenProductRename?: (group: HistoricalProductStat) => void;
}

function queryFromFilters(filters: HistoryFilters): ProductHistoryQuery {
  const query: ProductHistoryQuery = {};
  if (filters.transaction_type) query.transaction_type = filters.transaction_type;
  if (filters.category_key) query.category_key = filters.category_key;
  if (filters.issue_filter) query.issue_filter = filters.issue_filter;
  if (filters.product_search.trim()) query.product_search = filters.product_search.trim();
  if (filters.from_month) query.from_month = filters.from_month;
  if (filters.to_month) query.to_month = filters.to_month;
  const minimum = Number(filters.min_occurrences);
  if (filters.min_occurrences.trim() && Number.isFinite(minimum) && minimum >= 1) {
    query.min_occurrences = Math.trunc(minimum);
  }
  return query;
}

function historyGroupKey(transactionType: string, productKey: string): string {
  return `${transactionType}\u0000${productKey}`;
}

function initialFilters(
  initialQuery: ProductHistoryQuery | undefined,
  defaultIssueFilter: HistoryFilters["issue_filter"] = "conflict"
): HistoryFilters {
  return {
    transaction_type: initialQuery?.transaction_type ?? "",
    category_key: initialQuery?.category_key ?? "",
    issue_filter: initialQuery?.issue_filter ?? defaultIssueFilter,
    product_search: initialQuery?.product_search ?? "",
    from_month: initialQuery?.from_month ?? "",
    to_month: initialQuery?.to_month ?? "",
    min_occurrences: initialQuery?.min_occurrences === undefined
      ? ""
      : String(initialQuery.min_occurrences)
  };
}

function categorySummary(
  counts: HistoricalProductStat["category_counts"]
): string {
  return counts.map((count) =>
    `${count.category || t("未分类", "Uncategorized")} (${count.occurrences})`
  ).join("\n") || t("无历史分类", "No historical category");
}

function categoryStatusLabel(value: HistoricalProductStat["category_status"]): string {
  return {
    正常: t("正常", "Normal"),
    停用: t("停用", "Inactive"),
    未分类: t("未分类", "Uncategorized"),
    混合: t("混合", "Mixed")
  }[value];
}

function statusStack(primary: string, secondary: string) {
  return <div className="asset-track-history-status-stack">
    <span>{primary}</span>
    <small>{secondary}</small>
  </div>;
}

function healthLabels(group: HistoricalProductStat): string[] {
  const labels: string[] = [];
  const hasInactive = group.category_counts.some(
    (category) => Boolean(category.category_key) && category.is_active === false
  );
  const hasUncategorized = group.category_counts.some((category) => !category.category_key);
  if (group.has_category_conflict) labels.push(t("商品-分类冲突", "Item-category conflict"));
  if (group.rule_status === "冲突") labels.push(t("规则冲突", "Rule conflict"));
  if (group.rule_status === "重复") labels.push(t("重复规则", "Duplicate rule"));
  if (hasInactive) labels.push(t("停用分类", "Inactive category"));
  if (hasUncategorized) labels.push(t("未分类", "Uncategorized"));
  if (group.unmatched_occurrences > 0) {
    labels.push(group.rule_coverage === "partial"
      ? t("部分流水无规则", "Some transactions have no rule")
      : t("没有规则", "No rule"));
  }
  if (group.history_rule_mismatch) labels.push(t("历史与规则不一致", "History-rule mismatch"));
  return labels.length ? labels : [t("正常", "Normal")];
}

function ruleStatusLabel(value: HistoricalProductStat["rule_status"]): string {
  return {
    正常: t("正常", "Normal"),
    重复: t("重复", "Duplicate"),
    冲突: t("冲突", "Conflict"),
    未创建: t("未创建", "Not created"),
    已覆盖: t("已覆盖", "Covered")
  }[value];
}

function ruleCoverageLabel(value: HistoricalProductStat["rule_coverage"]): string {
  return {
    none: t("未覆盖", "Not covered"),
    partial: t("部分覆盖", "Partially covered"),
    full: t("全部覆盖", "Fully covered")
  }[value];
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left ?? 0) - Number(right ?? 0);
  }
  return scalarText(left).localeCompare(scalarText(right), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function sortGroups(
  groups: HistoricalProductStat[],
  sort: HistorySort
): HistoricalProductStat[] {
  return [...groups].sort((left, right) => {
    const compared = compareValues(left[sort.key as keyof HistoricalProductStat], right[sort.key as keyof HistoricalProductStat]);
    return sort.direction === "asc" ? compared : -compared;
  });
}

function issueLabel(filter: ProductHistoryIssueFilter): string {
  return {
    conflict: t("商品-分类冲突", "Item-category conflict"),
    "rule-conflict": t("规则冲突", "Rule conflict"),
    duplicate: t("重复规则", "Duplicate rule"),
    inactive: t("停用分类", "Inactive category"),
    uncategorized: t("未分类", "Uncategorized"),
    "no-rule": t("没有规则", "No rule"),
    mismatch: t("历史与规则不一致", "History-rule mismatch")
  }[filter];
}

function errorMessage(error: unknown): string {
  if (error instanceof AssetTrackError && error.code === "revision_conflict") {
    return t("数据已被其他窗口修改，请重新加载。", "The data changed in another window. Reload and try again.");
  }
  return displayError(error);
}

function HistorySortButton({
  field,
  label,
  sort,
  onSort
}: {
  field: string;
  label: string;
  sort: HistorySort;
  onSort: (next: HistorySort) => void;
}) {
  const active = sort.key === field;
  const mark = active ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
  return <button
    type="button"
    className="asset-track-sort"
    aria-label={t(`${label}排序`, `Sort by ${label}`)}
    aria-pressed={active}
    onClick={() => onSort({
      key: field,
      direction: active && sort.direction === "asc" ? "desc" : "asc"
    })}
  >{label}{mark}</button>;
}

export function HistoryBackfillContent({
  api,
  categories,
  mode,
  initialQuery,
  embedded = false,
  hostWindow,
  detailOnly = false,
  detailGroup,
  overview = false,
  confirmAction,
  onSaved,
  onDataChanged,
  onOpenDetail,
  onOpenProductRename,
  onCreateRule,
  hideIssueFilter = false,
  onQueryChange,
  onClose
}: Omit<RuleHistoryModalOptions, "app"> & {
  embedded?: boolean;
  hostWindow: Window;
  overview?: boolean;
  hideIssueFilter?: boolean;
  onOpenDetail?: (group: HistoricalProductStat, query: ProductHistoryQuery) => void;
  onOpenProductRename?: (group: HistoricalProductStat) => void;
  onCreateRule?: (group: HistoricalProductStat) => void;
  onQueryChange?: (query: ProductHistoryQuery) => void;
  onClose?: () => void;
}) {
  const [filters, setFilters] = useState<HistoryFilters>(() => initialFilters(initialQuery, overview ? "" : "conflict"));
  const [groups, setGroups] = useState<HistoricalProductStat[] | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<HistoricalProductStat | null>(null);
  const [detailRows, setDetailRows] = useState<ProductHistoryTransaction[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [targetCategoryKey, setTargetCategoryKey] = useState("");
  const [preview, setPreview] = useState<CategoryBackfillPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [sort, setSort] = useState<HistorySort>({ key: "last_date", direction: "desc" });
  const requestSequence = useRef(0);
  const autoLoadTimer = useRef<number | null>(null);

  const query = useMemo(
    () => queryFromFilters(overview ? { ...filters, issue_filter: "" } : filters),
    [filters, overview]
  );
  const hasFilter = Object.keys(query).length > 0;
  const sortedGroups = useMemo(
    () => sortGroups(groups ?? [], sort),
    [groups, sort]
  );
  const detailView = detailRows ?? [];
  const visibleIds = detailView.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0
    && visibleIds.every((id) => selectedIds.has(id));

  const loadStatsForQuery = useCallback(async (
    requestedQuery: ProductHistoryQuery,
    categoryMode = false
  ) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setMessage(categoryMode
      ? t("正在加载当前分类下的商品…", "Loading items in this category…")
      : overview
        ? t("正在加载商品总览…", "Loading item overview…")
        : t("正在加载筛选后的历史统计…", "Loading filtered history statistics…"));
    try {
      const result = overview && mode === "product" && Object.keys(requestedQuery).length === 0
        ? await api.productOverview()
        : categoryMode
          ? await api.productHistory(requestedQuery)
          : await api.productHistoryIndex(requestedQuery);
      if (sequence !== requestSequence.current) return;
      setGroups(result.groups);
      setHasLoadedOnce(true);
      setSelectedGroup(null);
      setDetailRows("rows" in result ? result.rows : null);
      setSelectedIds(new Set());
      setPreview(null);
      setMessage("");
    } catch (error) {
      if (sequence === requestSequence.current) setMessage(errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [api, mode, overview]);

  const updateFilter = (next: Partial<HistoryFilters>) => {
    const nextFilters = { ...filters, ...next };
    const nextQuery = queryFromFilters(overview ? { ...nextFilters, issue_filter: "" } : nextFilters);
    const dynamicLoad = mode === "product" && !detailOnly && hasLoadedOnce;
    requestSequence.current += 1;
    setLoading(false);
    setFilters(nextFilters);
    onQueryChange?.(nextQuery);
    setSelectedGroup(null);
    setDetailRows(null);
    setSelectedIds(new Set());
    setMessage("");
    setPreview(null);
    if (autoLoadTimer.current !== null) {
      hostWindow.clearTimeout(autoLoadTimer.current);
      autoLoadTimer.current = null;
    }
    if (dynamicLoad && (overview || Object.keys(nextQuery).length > 0)) {
      autoLoadTimer.current = hostWindow.setTimeout(() => {
        void loadStatsForQuery(nextQuery);
      }, 250);
    } else {
      setGroups(null);
      if (!overview && Object.keys(nextQuery).length === 0) {
        setMessage(t("请选择至少一个筛选条件。", "Choose at least one filter."));
      }
    }
  };

  const resetFilters = () => {
    requestSequence.current += 1;
    setLoading(false);
    if (autoLoadTimer.current !== null) {
      hostWindow.clearTimeout(autoLoadTimer.current);
      autoLoadTimer.current = null;
    }
    const nextFilters = initialFilters(
      mode === "category" ? initialQuery : undefined,
      overview ? "" : "conflict"
    );
    setFilters(nextFilters);
    onQueryChange?.(queryFromFilters(overview ? { ...nextFilters, issue_filter: "" } : nextFilters));
    setGroups(null);
    setHasLoadedOnce(false);
    setSelectedGroup(null);
    setDetailRows(null);
    setSelectedIds(new Set());
    setPreview(null);
    setMessage("");
  };

  const openDetail = useCallback(async (
    group: HistoricalProductStat,
    baseQuery: ProductHistoryQuery = query
  ) => {
    const detailQuery = {
      ...baseQuery,
      transaction_type: group.transaction_type,
      product_key: group.product_key
    };
    if (embedded && !detailOnly && onOpenDetail) {
      onOpenDetail(group, detailQuery);
      return;
    }
    setLoading(true);
    setMessage(t("正在加载商品时间线…", "Loading the item timeline…"));
    try {
      const result = await api.productHistory(detailQuery);
      const summary = result.groups.find((item) =>
        item.transaction_type === group.transaction_type
        && item.product_key === group.product_key
      ) ?? group;
      setSelectedGroup(summary);
      setDetailRows(result.rows);
      setSelectedIds(new Set());
      setPreview(null);
      setTargetCategoryKey(
        categories.find((category) =>
          category.is_active && category.transaction_type === group.transaction_type
        )?.category_key ?? ""
      );
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [api, categories, detailOnly, embedded, onOpenDetail, query]);

  useEffect(() => {
    if (mode !== "product" || detailOnly || hasLoadedOnce) return;
    if (!overview && !hasFilter) return;
    void loadStatsForQuery(query);
  }, [detailOnly, hasFilter, hasLoadedOnce, loadStatsForQuery, mode, overview, query]);

  useEffect(() => {
    if (mode !== "category" || detailOnly || !initialQuery?.category_key) return;
    const source = categories.find((category) => category.category_key === initialQuery.category_key);
    setTargetCategoryKey(
      categories.find((category) => category.is_active
        && category.category_key !== initialQuery.category_key
        && (!source || category.transaction_type === source.transaction_type))?.category_key ?? ""
    );
    void loadStatsForQuery(
      { category_key: initialQuery.category_key },
      true
    );
  }, [categories, detailOnly, initialQuery?.category_key, loadStatsForQuery, mode]);

  useEffect(() => {
    if (!detailOnly || !detailGroup) return;
    void openDetail(detailGroup, initialQuery);
  }, [detailGroup, detailOnly, initialQuery, openDetail]);

  useEffect(() => () => {
    requestSequence.current += 1;
    if (autoLoadTimer.current !== null) hostWindow.clearTimeout(autoLoadTimer.current);
  }, [hostWindow]);

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
    setPreview(null);
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreview(null);
  };

  const previewBackfill = async () => {
    if (mode === "product" && selectedGroup?.rule_status === "冲突") {
      setMessage(t("请先处理当前商品的规则冲突，再修改历史分类。", "Resolve this item's rule conflict before editing historical categories."));
      return;
    }
    if (mode === "category" && sortedGroups.some((group) =>
      group.rule_status === "冲突"
      && categoryGroupTransactionIds(group).some((id) => selectedIds.has(id))
    )) {
      setMessage(t("选中商品存在未解决的规则冲突，请先处理规则后再迁移历史分类。", "Some selected items have unresolved rule conflicts. Resolve the rules before migrating historical categories."));
      return;
    }
    if (!selectedIds.size || !targetCategoryKey) {
      setMessage(t("请选择流水和目标分类后再预览。", "Select transactions and a target category before previewing."));
      return;
    }
    setLoading(true);
    setMessage(t("正在生成回溯预览…", "Preparing the backfill preview…"));
    try {
      const result = await api.previewCategoryBackfill({
        transaction_ids: [...selectedIds],
        target_category_key: targetCategoryKey
      });
      setPreview(result);
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const applyBackfill = async () => {
    if (!preview) return;
    if (mode === "category") {
      const confirmed = await confirmAction(
        t("确认迁移历史分类？", "Confirm historical category migration?"),
        t(
          `将修改 ${preview.transaction_count} 条流水，涉及 ${preview.month_count} 个月份；原始日期、金额和商品不会改变。`,
          `This will update ${preview.transaction_count} transactions across ${preview.month_count} months. Dates, amounts, and items will not change.`
        ),
        t("确认写入", "Apply changes")
      );
      if (!confirmed) return;
    }
    setLoading(true);
    setMessage(t("正在写入历史分类…", "Applying historical categories…"));
    try {
      const result = await api.applyCategoryBackfill({
        transaction_ids: preview.transaction_ids,
        target_category_key: preview.target_category_key,
        expected_month_revisions: Object.fromEntries(
          preview.months.map((month) => [month.month, month.revision])
        )
      });
      onSaved();
      onDataChanged();
      new Notice(t(`已更新 ${result.updated_count} 条历史流水。`, `Updated ${result.updated_count} historical transactions.`));
      setMessage("");
      if (!embedded) onClose?.();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const sourceCategoryKey = initialQuery?.category_key ?? "";
  const sourceCategory = categories.find((category) => category.category_key === sourceCategoryKey);
  const categoryGroupTransactionIds = (group: HistoricalProductStat): number[] =>
    (detailRows ?? [])
      .filter((row) => row.type === group.transaction_type
        && normalizeProductKey(row.product) === group.product_key)
      .map((row) => row.id);
  const categoryGroupSelected = (group: HistoricalProductStat): boolean => {
    const ids = categoryGroupTransactionIds(group);
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
  };
  const allCategoryGroupsSelected = mode === "category"
    && sortedGroups.length > 0
    && sortedGroups.every((group) => categoryGroupSelected(group));
  const targetCategories = categories.filter((category) =>
    category.is_active
      && category.category_key !== sourceCategoryKey
      && (!selectedGroup
        ? !sourceCategory || category.transaction_type === sourceCategory.transaction_type
        : category.transaction_type === selectedGroup.transaction_type)
  );

  const toggleCategoryGroup = (group: HistoricalProductStat) => {
    const ids = categoryGroupTransactionIds(group);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (categoryGroupSelected(group)) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    setPreview(null);
  };

  const toggleAllCategoryGroups = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      const allIds = sortedGroups.flatMap((group) => categoryGroupTransactionIds(group));
      if (allCategoryGroupsSelected) allIds.forEach((id) => next.delete(id));
      else allIds.forEach((id) => next.add(id));
      return next;
    });
    setPreview(null);
  };

  return <div className="asset-track-rule-history-modal-content">
    {mode === "product" && !detailOnly && (!embedded || overview) && <div className="asset-track-rule-history-filters">
      <div className="asset-track-rule-history-filter-heading">
        <strong>{overview
          ? t("筛选商品总览", "Filter item overview")
          : t("默认显示商品-分类冲突", "Item-category conflicts are shown by default")}</strong>
        <span>{overview
          ? t("可按收支、分类、商品和时间筛选。", "Filter by type, category, item, and time.")
          : t("筛选条件变化后会自动刷新统计。", "Statistics refresh automatically when filters change.")}</span>
      </div>
      <div className={`asset-track-filter-grid${overview ? " asset-track-filter-grid--overview" : ""}`}>
        <label className="asset-track-rule-history-filter-type">{t("收支", "Type")}
          <select value={filters.transaction_type} onChange={(event) => updateFilter({ transaction_type: event.target.value as HistoryFilters["transaction_type"] })}>
            <option value="">{t("全部", "All")}</option>
            <option value="支出">{businessLabel("支出")}</option>
            <option value="收入">{businessLabel("收入")}</option>
          </select>
        </label>
        {!hideIssueFilter && !overview && <label>{t("问题类型", "Issue")}
          <select value={filters.issue_filter} onChange={(event) => updateFilter({ issue_filter: event.target.value as HistoryFilters["issue_filter"] })}>
            <option value="">{t("全部", "All")}</option>
            <optgroup label={t("分类问题", "Category issues")}>
              {(["conflict", "inactive", "uncategorized"] as ProductHistoryIssueFilter[]).map((filter) => <option key={filter} value={filter}>{issueLabel(filter)}</option>)}
            </optgroup>
            <optgroup label={t("规则问题", "Rule issues")}>
              {(["rule-conflict", "duplicate", "no-rule", "mismatch"] as ProductHistoryIssueFilter[]).map((filter) => <option key={filter} value={filter}>{issueLabel(filter)}</option>)}
            </optgroup>
          </select>
        </label>}
        <label className="asset-track-rule-history-filter-category">{t("分类", "Category")}
          <select value={filters.category_key} onChange={(event) => updateFilter({ category_key: event.target.value })}>
            <option value="">{t("全部", "All")}</option>
            {categories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
          </select>
        </label>
        <label className="asset-track-rule-history-filter-search">{t("商品搜索", "Item search")}
          <input placeholder={t("搜索商品名", "Search item name")} value={filters.product_search} onChange={(event) => updateFilter({ product_search: event.target.value })} />
        </label>
        <label className="asset-track-rule-history-filter-year">{t("起始年份", "From year")}
          <input type="number" min="2000" max="2100" placeholder={t("例如 2026", "e.g. 2026")} value={filters.from_month.slice(0, 4)} onChange={(event) => updateFilter({ from_month: event.target.value ? `${event.target.value}-01` : "" })} />
        </label>
        <label className="asset-track-rule-history-filter-year">{t("结束年份", "To year")}
          <input type="number" min="2000" max="2100" placeholder={t("例如 2026", "e.g. 2026")} value={filters.to_month.slice(0, 4)} onChange={(event) => updateFilter({ to_month: event.target.value ? `${event.target.value}-12` : "" })} />
        </label>
        <label className="asset-track-rule-history-filter-count">{t("最少次数", "Minimum occurrences")}
          <input type="number" min="1" value={filters.min_occurrences} onChange={(event) => updateFilter({ min_occurrences: event.target.value })} />
        </label>
      </div>
      <div className="asset-track-rule-history-filter-actions">
        <button type="button" disabled={loading} onClick={resetFilters}>{t("重置筛选", "Reset filters")}</button>
        {loading && <span role="status">{t("正在更新统计…", "Updating statistics…")}</span>}
        {!overview && !hasFilter && !loading && <span role="status">{t("请选择至少一个筛选条件。", "Choose at least one filter.")}</span>}
      </div>
    </div>}

    {message && <p className="asset-track-rule-history-message" role="status">{message}</p>}

    {mode === "product" && !overview && !detailOnly && !hasFilter && !groups && !selectedGroup && <p className="asset-track-rule-history-empty" role="status">
      {t("请选择至少一个筛选条件。", "Choose at least one filter.")}
    </p>}

    {mode === "category" && !groups && !message && <p className="asset-track-rule-history-empty" role="status">
      {t("正在加载当前分类下的商品…", "Loading items in this category…")}
    </p>}

    {mode === "product" && !detailOnly && !selectedGroup && groups && (sortedGroups.length === 0
      ? <EmptyState text={overview
        ? t("暂无商品记录。", "No item records yet.")
        : t("暂无商品-分类冲突。", "No item-category conflicts.")} />
      : <div className="asset-track-table-scroll asset-track-history-group-scroll"><table className={`asset-track-history-group-table${overview ? " asset-track-history-group-table--overview" : " asset-track-history-group-table--health"}`}>
        <thead><tr>
          <th scope="col" className="asset-track-date-column"><HistorySortButton field="last_date" label={t("最近日期", "Latest date")} sort={sort} onSort={setSort} /></th>
          <th scope="col" className="asset-track-type-column"><HistorySortButton field="transaction_type" label={t("收支", "Type")} sort={sort} onSort={setSort} /></th>
          <th scope="col"><HistorySortButton field="product" label={t("商品", "Item")} sort={sort} onSort={setSort} /></th>
          <StaticTableHeader label={t("所属分类", "Category")} className="asset-track-centered-column" />
          <StaticTableHeader label={t("所属规则", "Rule")} className="asset-track-centered-column" />
          <StaticTableHeader label={t("健康状态", "Health")} className="asset-track-centered-column" />
          <th scope="col" className="asset-track-count-column"><HistorySortButton field="occurrences" label={t("流水数", "Transactions")} sort={sort} onSort={setSort} /></th>
          <ActionTableHeader />
        </tr></thead>
        <tbody>{sortedGroups.map((group) => {
          const health = healthLabels(group).join(" · ");
          return <tr key={`${group.transaction_type}\u0000${group.product_key}`}>
            <td className="asset-track-date-cell">{group.last_date || "—"}</td>
            <td className="asset-track-type-cell">{businessLabel(group.transaction_type)}</td>
            <td title={group.variants.join("、")}>{group.product || t("（空商品）", "(empty item)")}</td>
            <td className="asset-track-centered-cell">{statusStack(categorySummary(group.category_counts), categoryStatusLabel(group.category_status))}</td>
            <td className="asset-track-centered-cell">{statusStack(
              ruleCoverageLabel(group.rule_coverage),
              group.rule_status === "冲突" || group.rule_status === "重复"
                ? ruleStatusLabel(group.rule_status)
                : t(
                    `${group.matched_occurrences}/${group.occurrences} 条流水已覆盖`,
                    `${group.matched_occurrences}/${group.occurrences} transactions covered`
                  )
            )}</td>
            <td className="asset-track-centered-cell">{health}</td>
            <td className="asset-track-count-cell">{group.occurrences}</td>
            <td className="asset-track-history-actions">
              {onOpenProductRename && <button type="button" onClick={() => onOpenProductRename(group)}>{t("编辑商品", "Edit item")}</button>}
              {onCreateRule && group.rule_status === "未创建" && <button type="button" onClick={() => onCreateRule(group)}>{t("创建规则", "Create rule")}</button>}
              <button type="button" onClick={() => void openDetail(group)}>{t("编辑分类", "Edit category")}</button>
            </td>
          </tr>;
        })}</tbody>
      </table></div>)}

    {mode === "category" && groups && <div className="asset-track-rule-history-category-migration">
      <div className="asset-track-rule-history-detail-header">
        <div>
          <h3>{t(`分类“${sourceCategory?.name ?? ""}”的历史商品`, `Historical items in “${sourceCategory?.name ?? ""}”`)}</h3>
          <p>{t("直接选择需要迁移的商品，再指定统一的目标分类。不会按多数分类自动迁移。", "Select the items to migrate and choose one target category. No majority-based migration is automatic.")}</p>
        </div>
        {onClose && <button type="button" onClick={onClose}>{t("关闭", "Close")}</button>}
      </div>
      <div className="asset-track-rule-history-category-actions">
        <button type="button" disabled={!sortedGroups.length} onClick={toggleAllCategoryGroups}>
          {allCategoryGroupsSelected ? t("取消全选商品", "Deselect all items") : t("全选商品", "Select all items")}
        </button>
        <span className="asset-track-selected-count" role="status">
          {t(`已选择 ${sortedGroups.filter((group) => categoryGroupSelected(group)).length} 个商品`, `${sortedGroups.filter((group) => categoryGroupSelected(group)).length} items selected`)}
        </span>
      </div>
      <div className="asset-track-table-scroll asset-track-history-category-scroll">
        {sortedGroups.length === 0 ? <p className="asset-track-rule-history-empty">{t("该分类没有可迁移的历史商品。", "This category has no historical items to migrate.")}</p> : <table className="asset-track-history-category-table"><thead><tr>
          <StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" />
          <th scope="col" className="asset-track-date-column"><HistorySortButton field="last_date" label={t("最近日期", "Latest date")} sort={sort} onSort={setSort} /></th>
          <th scope="col"><HistorySortButton field="product" label={t("商品", "Item")} sort={sort} onSort={setSort} /></th>
          <StaticTableHeader label={t("交易对方", "Counterparties")} />
          <th scope="col" className="asset-track-count-column"><HistorySortButton field="occurrences" label={t("次数", "Occurrences")} sort={sort} onSort={setSort} /></th>
          <th scope="col" className="asset-track-count-column"><HistorySortButton field="months_count" label={t("月份数", "Months")} sort={sort} onSort={setSort} /></th>
          <th scope="col" className="asset-track-amount-column"><HistorySortButton field="total_amount" label={t("总金额", "Total amount")} sort={sort} onSort={setSort} /></th>
        </tr></thead><tbody>{sortedGroups.map((group) => <tr key={historyGroupKey(group.transaction_type, group.product_key)}>
          <td><input
            className="asset-track-selection-checkbox"
            type="checkbox"
            checked={categoryGroupSelected(group)}
            onChange={() => toggleCategoryGroup(group)}
            aria-label={t(`选择商品 ${group.product || "空商品"}`, `Select item ${group.product || "empty item"}`)}
          /></td>
          <td className="asset-track-date-cell">{group.last_date || "—"}</td>
          <td title={group.variants.join("、")}>{group.product || t("（空商品）", "(empty item)")}</td>
          <td>{group.counterparties.join("、") || t("（空）", "(empty)")}</td>
          <td className="asset-track-count-cell">{group.occurrences}</td><td className="asset-track-count-cell">{group.months_count}</td><td className="asset-track-amount-cell">{money(group.total_amount, group.transaction_type)}</td>
        </tr>)}</tbody></table>}
      </div>
      <div className="asset-track-backfill-actions asset-track-rule-history-target">
        <label>{t("选中商品的目标分类", "Target category for selected items")}
          <select value={targetCategoryKey} onChange={(event) => { setTargetCategoryKey(event.target.value); setPreview(null); }}>
            <option value="">{t("请选择", "Select")}</option>
            {targetCategories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
          </select>
        </label>
        <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedIds.size} 条流水`, `${selectedIds.size} transactions selected`)}</span>
        <button type="button" className="mod-cta" disabled={loading} onClick={() => void previewBackfill()}>{t("生成迁移预览", "Preview migration")}</button>
      </div>
      {preview && <div className="asset-track-backfill-preview" role="status">
        <strong>{t("迁移预览", "Migration preview")}</strong>
        <p>{t(`将 ${preview.transaction_count} 条流水迁移到“${preview.target_category}”，涉及 ${preview.month_count} 个月份。`, `Move ${preview.transaction_count} transactions to “${preview.target_category}” across ${preview.month_count} months.`)}</p>
        <p>{t("原分类：", "Old categories: ")}{categorySummary(preview.old_categories)}</p>
        <p>{preview.months.map((month) => `${month.month} revision ${month.revision} (${month.count})`).join(" · ")}</p>
        <button type="button" className="mod-cta" disabled={loading} onClick={() => void applyBackfill()}>{t("确认写入", "Apply changes")}</button>
      </div>}
    </div>}

    {mode === "product" && selectedGroup && detailRows && <div className="asset-track-rule-history-detail">
      <div className="asset-track-rule-history-detail-header">
        <div>
          <h3>{selectedGroup.product || t("（空商品）", "(empty item)")} · {businessLabel(selectedGroup.transaction_type)}</h3>
          <p>{selectedGroup.rule_status === "冲突"
            ? t("当前规则存在冲突，请先处理规则后再修改历史分类。", "These rules conflict. Resolve them before editing historical categories.")
            : t("请选择需要修改分类的流水，再指定目标分类。", "Select transactions whose category should change, then choose the target category.")}</p>
        </div>
        <button type="button" onClick={() => {
          if (detailOnly) onClose?.();
          else {
            setSelectedGroup(null);
            setDetailRows(null);
            setSelectedIds(new Set());
            setPreview(null);
          }
        }}>{detailOnly ? t("关闭", "Close") : t("返回商品列表", "Back to item list")}</button>
      </div>
      <div className="asset-track-rule-history-selection-actions">
        <button type="button" disabled={!visibleIds.length} onClick={toggleAllVisible}>
          {allVisibleSelected ? t("取消全选流水", "Deselect all transactions") : t("全选流水", "Select all transactions")}
        </button>
        <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedIds.size} 条`, `${selectedIds.size} selected`)}</span>
      </div>
      <div className="asset-track-table-scroll asset-track-history-detail-scroll">
        <table className="asset-track-history-detail-table"><thead><tr>
          <StaticTableHeader label={t("日期", "Date")} className="asset-track-date-column" /><StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" /><StaticTableHeader label={t("交易对方", "Counterparty")} /><StaticTableHeader label={t("商品", "Item")} /><StaticTableHeader label={t("原分类", "Original category")} /><StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" /><StaticTableHeader label={t("规则解释", "Rule explanation")} />
        </tr></thead><tbody>{detailView.map((row) => <tr key={row.id}>
          <td className="asset-track-date-cell">{row.transaction_date}</td>
          <td><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelected(row.id)} aria-label={t(`选择 ${row.transaction_date} ${row.counterparty || "流水"}`, `Select ${row.transaction_date} ${row.counterparty || "transaction"}`)} /></td>
          <td>{row.counterparty || t("（空）", "(empty)")}</td><td>{row.product || t("（空商品）", "(empty item)")}</td><td>{row.category || t("未分类", "Uncategorized")}</td><td className="asset-track-amount-cell">{money(row.amount, row.type)}</td>
          <td>{row.rule_match.status === "conflict"
            ? `${t("规则冲突", "Rule conflict")}（${row.rule_match.rule_ids.length}）`
            : row.rule_match.status === "matched"
              ? t("已命中规则", "Rule matched")
              : t("未命中规则", "No matching rule")}</td>
        </tr>)}</tbody></table>
      </div>
      <div className="asset-track-backfill-actions asset-track-rule-history-target">
        <label>{t("目标分类", "Target category")}
          <select value={targetCategoryKey} onChange={(event) => { setTargetCategoryKey(event.target.value); setPreview(null); }}>
            <option value="">{t("请选择", "Select")}</option>
            {targetCategories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
          </select>
        </label>
        <button type="button" className="mod-cta" disabled={loading || selectedGroup.rule_status === "冲突"} onClick={() => void previewBackfill()}>{t("修改分类", "Edit category")}</button>
        {preview && <button type="button" className="mod-warning" disabled={loading} onClick={() => void applyBackfill()}>{t(`确认修改 ${preview.transaction_count} 条`, `Confirm ${preview.transaction_count} edits`)}</button>}
      </div>
    </div>}
  </div>;
}

export class RuleHistoryModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: RuleHistoryModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(
      this.options.mode === "category"
        ? t("迁移分类历史引用", "Migrate category history")
        : this.options.detailOnly
          ? t("编辑分类", "Edit category")
        : t("商品总览", "Item overview")
    );
    this.modalEl.addClass("asset-track-rule-history-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(HistoryBackfillContent, {
      api: this.options.api,
      categories: this.options.categories,
      mode: this.options.mode,
      initialQuery: this.options.initialQuery,
      detailOnly: this.options.detailOnly,
      detailGroup: this.options.detailGroup,
      hostWindow,
      confirmAction: this.options.confirmAction,
      onSaved: this.options.onSaved,
      onDataChanged: this.options.onDataChanged,
      onOpenProductRename: this.options.onOpenProductRename,
      onClose: () => this.close()
    }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
