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
  ProductRenamePreview,
  ProductHistoryIssueFilter,
  ProductHistoryQuery,
  ProductHistoryTransaction,
  SavedRule
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { displayError, businessLabel, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { normalizeProductKey } from "../domain/rules";
import { scalarText } from "../domain/text";
import { ActionTableHeader, StaticTableHeader } from "./TablePrimitives";

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
  initialQuery: ProductHistoryQuery | undefined
): HistoryFilters {
  return {
    transaction_type: initialQuery?.transaction_type ?? "",
    category_key: initialQuery?.category_key ?? "",
    issue_filter: initialQuery?.issue_filter ?? "conflict",
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
  ).join("、") || t("无历史分类", "No historical category");
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
  if (group.has_category_conflict) labels.push(t("分类冲突", "Category conflict"));
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
    conflict: t("分类冲突", "Category conflict"),
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
  hideIssueFilter?: boolean;
  onOpenDetail?: (group: HistoricalProductStat, query: ProductHistoryQuery) => void;
  onOpenProductRename?: (group: HistoricalProductStat) => void;
  onCreateRule?: (group: HistoricalProductStat) => void;
  onQueryChange?: (query: ProductHistoryQuery) => void;
  onClose?: () => void;
}) {
  const [filters, setFilters] = useState<HistoryFilters>(() => initialFilters(initialQuery));
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

  const query = useMemo(() => queryFromFilters(filters), [filters]);
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
      : t("正在加载筛选后的历史统计…", "Loading filtered history statistics…"));
    try {
      const result = categoryMode
        ? await api.productHistory(requestedQuery)
        : await api.productHistoryIndex(requestedQuery);
      if (sequence !== requestSequence.current) return;
      setGroups(result.groups);
      setHasLoadedOnce(true);
      setSelectedGroup(null);
      setDetailRows("rows" in result ? result.rows : null);
      setSelectedIds(new Set());
      setPreview(null);
      setMessage(categoryMode
        ? t(`已加载 ${result.groups.length} 个商品。`, `Loaded ${result.groups.length} items.`)
        : t(`已加载 ${result.groups.length} 个商品分组。`, `Loaded ${result.groups.length} item groups.`));
    } catch (error) {
      if (sequence === requestSequence.current) setMessage(errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [api]);

  const updateFilter = (next: Partial<HistoryFilters>) => {
    const nextFilters = { ...filters, ...next };
    const nextQuery = queryFromFilters(nextFilters);
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
    if (dynamicLoad && Object.keys(nextQuery).length > 0) {
      autoLoadTimer.current = hostWindow.setTimeout(() => {
        void loadStatsForQuery(nextQuery);
      }, 250);
    } else {
      setGroups(null);
      if (Object.keys(nextQuery).length === 0) {
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
    setFilters(initialFilters(mode === "category" ? initialQuery : undefined));
    onQueryChange?.(queryFromFilters(initialFilters(mode === "category" ? initialQuery : undefined)));
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
    if (!hasFilter) return;
    void loadStatsForQuery(query);
  }, [detailOnly, hasFilter, hasLoadedOnce, loadStatsForQuery, mode, query]);

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
      setMessage(t("请先处理当前商品的规则冲突，再迁移历史分类。", "Resolve this item's rule conflict before migrating historical categories."));
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
    const confirmed = await confirmAction(
      t("确认迁移历史分类？", "Confirm historical category migration?"),
      t(
        `将修改 ${preview.transaction_count} 条流水，涉及 ${preview.month_count} 个月份；原始日期、金额和商品不会改变。`,
        `This will update ${preview.transaction_count} transactions across ${preview.month_count} months. Dates, amounts, and items will not change.`
      ),
      t("确认写入", "Apply changes")
    );
    if (!confirmed) return;
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
      setMessage(t(`已更新 ${result.updated_count} 条历史流水。`, `Updated ${result.updated_count} historical transactions.`));
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
    {mode === "product" && !detailOnly && !embedded && <div className="asset-track-rule-history-filters">
      <div className="asset-track-rule-history-filter-heading">
        <strong>{t("默认显示分类冲突", "Category conflicts are shown by default")}</strong>
        <span>{t("筛选条件变化后会自动刷新统计。", "Statistics refresh automatically when filters change.")}</span>
      </div>
      <div className="asset-track-filter-grid">
        <label>{t("收支", "Type")}
          <select value={filters.transaction_type} onChange={(event) => updateFilter({ transaction_type: event.target.value as HistoryFilters["transaction_type"] })}>
            <option value="">{t("全部", "All")}</option>
            <option value="支出">{businessLabel("支出")}</option>
            <option value="收入">{businessLabel("收入")}</option>
          </select>
        </label>
        {!hideIssueFilter && <label>{t("问题类型", "Issue")}
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
        <label>{t("分类", "Category")}
          <select value={filters.category_key} onChange={(event) => updateFilter({ category_key: event.target.value })}>
            <option value="">{t("全部", "All")}</option>
            {categories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
          </select>
        </label>
        <label>{t("商品搜索", "Item search")}
          <input value={filters.product_search} onChange={(event) => updateFilter({ product_search: event.target.value })} />
        </label>
        <label>{t("起始年份", "From year")}
          <input type="number" min="2000" max="2100" placeholder={t("例如 2026", "e.g. 2026")} value={filters.from_month.slice(0, 4)} onChange={(event) => updateFilter({ from_month: event.target.value ? `${event.target.value}-01` : "" })} />
        </label>
        <label>{t("结束年份", "To year")}
          <input type="number" min="2000" max="2100" placeholder={t("例如 2026", "e.g. 2026")} value={filters.to_month.slice(0, 4)} onChange={(event) => updateFilter({ to_month: event.target.value ? `${event.target.value}-12` : "" })} />
        </label>
        <label>{t("最少次数", "Minimum occurrences")}
          <input type="number" min="1" value={filters.min_occurrences} onChange={(event) => updateFilter({ min_occurrences: event.target.value })} />
        </label>
      </div>
      <div className="asset-track-rule-history-filter-actions">
        <button type="button" disabled={loading} onClick={resetFilters}>{t("重置筛选", "Reset filters")}</button>
        {loading && <span role="status">{t("正在更新统计…", "Updating statistics…")}</span>}
        {!hasFilter && !loading && <span role="status">{t("请选择至少一个筛选条件。", "Choose at least one filter.")}</span>}
      </div>
    </div>}

    {message && <p className="asset-track-rule-history-message" role="status">{message}</p>}

    {mode === "product" && !detailOnly && !hasFilter && !groups && !selectedGroup && <p className="asset-track-rule-history-empty" role="status">
      {t("请选择至少一个筛选条件。", "Choose at least one filter.")}
    </p>}

    {mode === "category" && !groups && !message && <p className="asset-track-rule-history-empty" role="status">
      {t("正在加载当前分类下的商品…", "Loading items in this category…")}
    </p>}

    {mode === "product" && !detailOnly && !selectedGroup && groups && <div className="asset-track-table-scroll asset-track-history-group-scroll">
      {sortedGroups.length === 0 ? <p className="asset-track-rule-history-empty">{t("没有符合筛选条件的商品历史。", "No item history matches the filters.")}</p> : <table className="asset-track-history-group-table">
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
              {onCreateRule && group.rule_suggestion && <button type="button" onClick={() => onCreateRule(group)}>{t("创建规则", "Create rule")}</button>}
              <button type="button" onClick={() => void openDetail(group)}>{t("查看回溯", "View history")}</button>
            </td>
          </tr>;
        })}</tbody>
      </table>}
    </div>}

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
            ? t("当前规则存在冲突，请先处理规则后再迁移历史分类。", "These rules conflict. Resolve them before migrating historical categories.")
            : t("请选择需要迁移的冲突流水，再指定目标分类并生成预览。", "Select the conflicting transactions, choose a target category, and preview the change.")}</p>
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
          {allVisibleSelected ? t("取消全选冲突流水", "Deselect all conflicting transactions") : t("全选冲突流水", "Select all conflicting transactions")}
        </button>
        <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedIds.size} 条`, `${selectedIds.size} selected`)}</span>
      </div>
      <div className="asset-track-table-scroll asset-track-history-detail-scroll">
        <table className="asset-track-history-detail-table"><thead><tr>
          <StaticTableHeader label={t("日期", "Date")} className="asset-track-date-column" /><StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" /><StaticTableHeader label={t("月份", "Month")} className="asset-track-date-column" /><StaticTableHeader label={t("交易对方", "Counterparty")} /><StaticTableHeader label={t("商品", "Item")} /><StaticTableHeader label={t("原分类", "Original category")} /><StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" /><StaticTableHeader label={t("规则解释", "Rule explanation")} />
        </tr></thead><tbody>{detailView.map((row) => <tr key={row.id}>
          <td className="asset-track-date-cell">{row.transaction_date}</td>
          <td><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelected(row.id)} aria-label={t(`选择 ${row.transaction_date} ${row.counterparty || "流水"}`, `Select ${row.transaction_date} ${row.counterparty || "transaction"}`)} /></td>
          <td className="asset-track-date-cell">{row.month}</td><td>{row.counterparty || t("（空）", "(empty)")}</td><td>{row.product || t("（空商品）", "(empty item)")}</td><td>{row.category || t("未分类", "Uncategorized")}</td><td className="asset-track-amount-cell">{money(row.amount, row.type)}</td>
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
        <button type="button" className="mod-cta" disabled={loading || selectedGroup.rule_status === "冲突"} onClick={() => void previewBackfill()}>{t("生成回溯预览", "Preview backfill")}</button>
      </div>
      {preview && <div className="asset-track-backfill-preview" role="status">
        <strong>{t("回溯预览", "Backfill preview")}</strong>
        <p>{t(`将 ${preview.transaction_count} 条流水迁移到“${preview.target_category}”，涉及 ${preview.month_count} 个月份。`, `Move ${preview.transaction_count} transactions to “${preview.target_category}” across ${preview.month_count} months.`)}</p>
        <p>{t("原分类：", "Old categories: ")}{categorySummary(preview.old_categories)}</p>
        <p>{preview.months.map((month) => `${month.month} revision ${month.revision} (${month.count})`).join(" · ")}</p>
        <button type="button" className="mod-cta" disabled={loading} onClick={() => void applyBackfill()}>{t("确认写入", "Apply changes")}</button>
      </div>}
    </div>}
  </div>;
}

interface ProductRenameModalOptions {
  app: App;
  api: AssetTrackService;
  categories: CategoryDefinition[];
  group: HistoricalProductStat;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
  onSaved: () => void;
  onDataChanged: () => void;
}

type ProductRenameAggregation = "category-product" | "product";

interface ProductRenameAggregate {
  key: string;
  category_key: string | null;
  category: string;
  product: string;
  variants: string[];
  ids: number[];
  months: Set<string>;
}

export function ProductRenameContent({
  api,
  categories,
  group,
  hostWindow,
  confirmAction,
  onSaved,
  onDataChanged,
  onClose
}: Omit<ProductRenameModalOptions, "app"> & {
  hostWindow: Window;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ProductHistoryTransaction[] | null>(null);
  const [aggregation, setAggregation] = useState<ProductRenameAggregation>("category-product");
  const [categoryFilter, setCategoryFilter] = useState(
    group.recommended_category_key ?? "__uncategorized__"
  );
  const [productSearch, setProductSearch] = useState("");
  const [selectedAggregates, setSelectedAggregates] = useState<Set<string>>(new Set());
  const [targetProduct, setTargetProduct] = useState(group.product);
  const [preview, setPreview] = useState<ProductRenamePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const candidateQuery = useMemo<ProductHistoryQuery | null>(() => {
    const search = productSearch.trim();
    if (categoryFilter === "__all__" && !search) return null;
    return {
      transaction_type: group.transaction_type,
      category_key: categoryFilter === "__all__"
        ? undefined
        : categoryFilter === "__uncategorized__"
          ? null
          : categoryFilter,
      product_search: search || undefined
    };
  }, [categoryFilter, group.transaction_type, productSearch]);

  useEffect(() => {
    setSelectedAggregates(new Set());
    setPreview(null);
    if (!candidateQuery) {
      setRows(null);
      setMessage(t(
        "查看全部分类时，请先输入商品搜索条件。",
        "Enter an item search before viewing all categories."
      ));
      return;
    }
    let active = true;
    const timer = hostWindow.setTimeout(() => {
      setLoading(true);
      setMessage(t("正在加载商品候选…", "Loading item candidates…"));
      void api.productHistory(candidateQuery)
        .then((result) => {
          if (!active) return;
          setRows(result.rows);
          setMessage("");
        })
        .catch((error: unknown) => {
          if (active) setMessage(errorMessage(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      hostWindow.clearTimeout(timer);
    };
  }, [api, candidateQuery, hostWindow]);

  const aggregates = useMemo<ProductRenameAggregate[]>(() => {
    const grouped = new Map<string, ProductRenameAggregate>();
    for (const row of rows ?? []) {
      const productKey = normalizeProductKey(row.product);
      const categoryKey = aggregation === "category-product" ? row.category_key : null;
      const key = `${categoryKey ?? ""}\u0000${productKey}`;
      const current = grouped.get(key) ?? {
        key,
        category_key: categoryKey,
        category: row.category,
        product: row.product,
        variants: [],
        ids: [],
        months: new Set<string>()
      };
      if (!current.variants.includes(row.product)) current.variants.push(row.product);
      if (!current.product && row.product) current.product = row.product;
      current.ids.push(row.id);
      current.months.add(row.month);
      if (!current.category && row.category) current.category = row.category;
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((left, right) =>
      right.ids.length - left.ids.length
      || left.category.localeCompare(right.category)
      || left.product.localeCompare(right.product)
    );
  }, [aggregation, rows]);

  const selectedIds = useMemo(() => aggregates
    .filter((aggregate) => selectedAggregates.has(aggregate.key))
    .flatMap((aggregate) => aggregate.ids), [aggregates, selectedAggregates]);
  const allSelected = aggregates.length > 0
    && aggregates.every((aggregate) => selectedAggregates.has(aggregate.key));

  const toggleAll = () => {
    setSelectedAggregates(allSelected
      ? new Set()
      : new Set(aggregates.map((aggregate) => aggregate.key)));
    setPreview(null);
  };

  const toggleAggregate = (key: string) => {
    setSelectedAggregates((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setPreview(null);
  };

  const previewRename = async () => {
    if (!selectedIds.length || !targetProduct.trim()) {
      setMessage(t("请选择商品聚合并填写目标商品名称。", "Select item groups and enter a target item name."));
      return;
    }
    setLoading(true);
    setMessage(t("正在生成商品统一预览…", "Preparing the item rename preview…"));
    try {
      setPreview(await api.previewProductRename({
        transaction_ids: selectedIds,
        target_product: targetProduct
      }));
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const applyRename = async () => {
    if (!preview) return;
    const confirmed = await confirmAction(
      t("确认统一商品名称？", "Confirm item name update?"),
      t(
        `将把 ${preview.transaction_count} 条流水中的商品名称统一为“${preview.target_product}”，涉及 ${preview.month_count} 个月份；分类和规则不会自动改变。`,
        `This will rename the item in ${preview.transaction_count} transactions across ${preview.month_count} months to “${preview.target_product}”. Categories and rules will not change automatically.`
      ),
      t("确认写入", "Apply changes")
    );
    if (!confirmed) return;
    setLoading(true);
    setMessage(t("正在统一商品名称…", "Updating item names…"));
    try {
      const result = await api.applyProductRename({
        transaction_ids: preview.transaction_ids,
        target_product: preview.target_product,
        expected_month_revisions: Object.fromEntries(
          preview.months.map((month) => [month.month, month.revision])
        )
      });
      onSaved();
      onDataChanged();
      new Notice(t(`已更新 ${result.updated_count} 条流水中的商品名称。`, `Updated item names in ${result.updated_count} transactions.`));
      setMessage(t(`已更新 ${result.updated_count} 条流水。`, `Updated ${result.updated_count} transactions.`));
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return <div className="asset-track-product-rename-content">
    <p>{t("可以按“分类 + 商品”或“商品”选择多个聚合。这里只修改商品名称，不会自动修改规则或分类。", "Select multiple groups by category + item or by item. Only item names change; rules and categories are not updated automatically.")}</p>
    {message && <p className="asset-track-rule-history-message" role="status">{message}</p>}
    <div className="asset-track-product-rename-options">
      <label>{t("聚合方式", "Group by")}
        <select value={aggregation} onChange={(event) => {
          setAggregation(event.target.value as ProductRenameAggregation);
          setSelectedAggregates(new Set());
          setPreview(null);
        }}>
          <option value="category-product">{t("分类 + 商品", "Category + item")}</option>
          <option value="product">{t("商品", "Item")}</option>
        </select>
      </label>
      <label>{t("分类范围", "Category scope")}
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          {categories
            .filter((category) => category.transaction_type === group.transaction_type)
            .map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
          <option value="__uncategorized__">{t("未分类", "Uncategorized")}</option>
          <option value="__all__">{t("全部分类（需要搜索）", "All categories (search required)")}</option>
        </select>
      </label>
      <label>{t("商品搜索", "Item search")}
        <input
          value={productSearch}
          onChange={(event) => setProductSearch(event.target.value)}
          placeholder={t("输入名称或片段", "Enter a name or fragment")}
        />
      </label>
    </div>
    <div className="asset-track-rule-history-selection-actions">
      <button type="button" disabled={loading || !aggregates.length} onClick={toggleAll}>
        {allSelected ? t("取消全选当前聚合", "Deselect current groups") : t("全选当前聚合", "Select current groups")}
      </button>
      <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedAggregates.size} 个聚合、${selectedIds.length} 条流水`, `${selectedAggregates.size} groups and ${selectedIds.length} transactions selected`)}</span>
    </div>
    <div className="asset-track-table-scroll asset-track-product-rename-scroll">
      {aggregates.length === 0 ? <p className="asset-track-rule-history-empty">{t("没有可编辑的商品聚合。", "No editable item groups found.")}</p> : <table className="asset-track-product-rename-table">
        <thead><tr><StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" /><StaticTableHeader label={t("分类", "Category")} /><StaticTableHeader label={t("原始商品及变体", "Original item and variants")} /><StaticTableHeader label={t("次数", "Occurrences")} className="asset-track-count-column" /><StaticTableHeader label={t("月份数", "Months")} className="asset-track-count-column" /></tr></thead>
        <tbody>{aggregates.map((aggregate) => <tr key={aggregate.key}>
          <td><input className="asset-track-selection-checkbox" type="checkbox" checked={selectedAggregates.has(aggregate.key)} onChange={() => toggleAggregate(aggregate.key)} aria-label={t(`选择${aggregate.category || "未分类"}中的${aggregate.product || "空商品"}`, `Select ${aggregate.product || "empty item"} in ${aggregate.category || "uncategorized"}`)} /></td>
          <td>{aggregate.category || t("未分类", "Uncategorized")}</td>
          <td title={aggregate.variants.join("、")}>{aggregate.product || t("（空商品）", "(empty item)")}{aggregate.variants.length > 1 ? ` · ${aggregate.variants.join("、")}` : ""}</td>
          <td className="asset-track-count-cell">{aggregate.ids.length}</td>
          <td className="asset-track-count-cell">{aggregate.months.size}</td>
        </tr>)}</tbody>
      </table>}
    </div>
    <div className="asset-track-product-rename-form">
      <label>{t("统一为商品名称", "Unified item name")}
        <input value={targetProduct} onChange={(event) => { setTargetProduct(event.target.value); setPreview(null); }} />
      </label>
      <button type="button" className="mod-cta" disabled={loading || !selectedIds.length} onClick={() => void previewRename()}>{t("生成预览", "Preview")}</button>
      <button type="button" disabled={loading} onClick={onClose}>{t("关闭", "Close")}</button>
    </div>
    {preview && <div className="asset-track-backfill-preview" role="status">
      <strong>{t("商品名称预览", "Item name preview")}</strong>
      <p>{t(`将 ${preview.transaction_count} 条流水统一为“${preview.target_product}”，涉及 ${preview.month_count} 个月份。`, `Rename ${preview.transaction_count} transactions to “${preview.target_product}” across ${preview.month_count} months.`)}</p>
      <p>{preview.variants.map((variant) => `${variant.product || t("（空商品）", "(empty item)")} (${variant.occurrences})`).join("、")}</p>
      <p>{preview.months.map((month) => `${month.month} revision ${month.revision} (${month.count})`).join(" · ")}</p>
      <button type="button" className="mod-cta" disabled={loading} onClick={() => void applyRename()}>{t("确认写入", "Apply changes")}</button>
    </div>}
  </div>;
}

export class ProductRenameModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: ProductRenameModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(t("统一商品名称", "Unify item name"));
    this.modalEl.addClass("asset-track-product-rename-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(ProductRenameContent, {
      api: this.options.api,
      categories: this.options.categories,
      group: this.options.group,
      hostWindow,
      confirmAction: this.options.confirmAction,
      onSaved: this.options.onSaved,
      onDataChanged: this.options.onDataChanged,
      onClose: () => this.close()
    }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

export interface RuleCreationModalOptions {
  app: App;
  categories: CategoryDefinition[];
  initial: Pick<SavedRule, "transaction_type" | "counterparty" | "product" | "category_key" | "category">;
  onConfirm: (rule: SavedRule) => void | Promise<void>;
}

function RuleCreationContent({
  categories,
  initial,
  onConfirm,
  onClose
}: Omit<RuleCreationModalOptions, "app"> & { onClose: () => void }) {
  const [transactionType, setTransactionType] = useState(initial.transaction_type);
  const [counterparty, setCounterparty] = useState(initial.counterparty);
  const [product, setProduct] = useState(initial.product);
  const [categoryKey, setCategoryKey] = useState(initial.category_key);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const availableCategories = categories.filter((category) =>
    category.is_active && category.transaction_type === transactionType
  );

  const submit = async () => {
    const nextCounterparty = counterparty.trim();
    const nextProduct = product.trim();
    const category = availableCategories.find((item) => item.category_key === categoryKey);
    if (!nextCounterparty && !nextProduct) {
      setMessage(t("至少填写交易对方或商品中的一项。", "Enter at least a counterparty or an item."));
      return;
    }
    if (!category) {
      setMessage(t("请选择与收支类型匹配的启用分类。", "Choose an active category matching the transaction type."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await onConfirm({
        transaction_type: transactionType,
        counterparty: nextCounterparty,
        product: nextProduct,
        category_key: category.category_key,
        category: category.name
      });
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return <div className="asset-track-rule-create-content">
    <p>{t("确认后会立即保存规则，并刷新冲突面板。", "The rule is saved immediately after confirmation and the conflict panel is refreshed.")}</p>
    {message && <p className="asset-track-rule-history-message" role="alert">{message}</p>}
    <label>{t("收支", "Type")}
      <select disabled={loading} value={transactionType} onChange={(event) => {
        const next = event.target.value as SavedRule["transaction_type"];
        setTransactionType(next);
        setCategoryKey("");
      }}>
        <option value="支出">{businessLabel("支出")}</option>
        <option value="收入">{businessLabel("收入")}</option>
      </select>
    </label>
    <label>{t("交易对方", "Counterparty")}
      <input disabled={loading} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
    </label>
    <label>{t("商品", "Item")}
      <input disabled={loading} value={product} onChange={(event) => setProduct(event.target.value)} />
    </label>
    <label>{t("目标分类", "Target category")}
      <select disabled={loading} value={categoryKey} onChange={(event) => setCategoryKey(event.target.value)}>
        <option value="">{t("请选择分类", "Choose category")}</option>
        {availableCategories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
      </select>
    </label>
    <div className="asset-track-rule-create-actions">
      <button type="button" className="mod-cta" disabled={loading} onClick={() => void submit()}>{loading ? t("正在保存…", "Saving…") : t("确认保存规则", "Save rule")}</button>
      <button type="button" disabled={loading} onClick={onClose}>{t("取消", "Cancel")}</button>
    </div>
  </div>;
}

export class RuleCreationModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: RuleCreationModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(t("创建匹配规则", "Create matching rule"));
    this.modalEl.addClass("asset-track-rule-create-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(RuleCreationContent, {
      categories: this.options.categories,
      initial: this.options.initial,
      onConfirm: this.options.onConfirm,
      onClose: () => this.close()
    }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
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
          ? t("商品回溯详情", "Item history details")
        : t("商品回溯管理", "Item history management")
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
