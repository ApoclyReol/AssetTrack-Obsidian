import { Notice } from "obsidian";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  CategoryBackfillPreview,
  ProductHistoryTransaction
} from "../../types/history";
import type {
  HistoricalProductStat
} from "../../types/rules";
import type { ReadWindow } from "../../types/readWindows";
import type { HistoryBackfillContentProps, HistoryFilters, HistorySort } from "./ruleHistoryTypes";
import { t } from "../../i18n";
import { normalizeProductKey } from "../../domain/rules";
import { CategoryHistoryMigrationPanel, ProductHistoryDetailPanel } from "./RuleHistoryBackfillPanels";
import { RuleHistoryFilters } from "./RuleHistoryFilters";
import { ProductHealthTable, ProductOverviewTable } from "./RuleHistoryProductTables";
import {
  errorMessage,
  initialFilters,
  queryFromFilters,
  sortGroups
} from "./ruleHistoryPrimitives";

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
  groupBy = "product",
  confirmAction,
  onSaved,
  onDataChanged,
  onOpenDetail,
  onOpenProductRename,
  onOpenCounterpartyRename,
  onGroupBy,
  onCreateRule,
  hideIssueFilter = false,
  onQueryChange,
  onClose
}: HistoryBackfillContentProps) {
  const [filters, setFilters] = useState<HistoryFilters>(() => initialFilters(initialQuery, overview ? "" : "conflict"));
  const [groups, setGroups] = useState<HistoricalProductStat[] | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<HistoricalProductStat | null>(null);
  const [detailRows, setDetailRows] = useState<ProductHistoryTransaction[] | null>(null);
  const [scope, setScope] = useState<ReadWindow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [targetCategoryKey, setTargetCategoryKey] = useState("");
  const [preview, setPreview] = useState<CategoryBackfillPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [sort, setSort] = useState<HistorySort>({ key: "last_date", direction: "desc" });
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const autoLoadTimer = useRef<number | null>(null);
  const skipNextQueryRef = useRef(false);

  const query = useMemo(
    () => queryFromFilters(overview ? { ...filters, issue_filter: "" } : filters, groupBy),
    [filters, groupBy, overview]
  );
  const hasFilter = Object.keys(query).some((key) => key !== "group_by");
  const sortedGroups = useMemo(
    () => sortGroups(groups ?? [], sort),
    [groups, sort]
  );
  const detailView = detailRows ?? [];
  const visibleIds = detailView.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0
    && visibleIds.every((id) => selectedIds.has(id));

  const loadStatsForQuery = useCallback(async (
    requestedQuery: typeof query,
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
      const result = overview && mode === "product" && !Object.keys(requestedQuery).some((key) => key !== "group_by")
        ? await api.productOverview(requestedQuery)
        : categoryMode
          ? await api.productHistory(requestedQuery)
          : await api.productHistoryIndex(requestedQuery);
      if (sequence !== requestSequence.current) return;
      setGroups(result.groups);
      setScope(result.scope ?? null);
      setHasLoadedOnce(true);
      setSelectedGroup(null);
      setDetailRows("rows" in result ? result.rows : null);
      setSelectedIds(new Set());
      setPreview(null);
      setMessage("");
      if (overview && mode === "product" && !requestedQuery.from_date && !requestedQuery.to_date && result.scope) {
        skipNextQueryRef.current = true;
        setFilters((current) => ({
          ...current,
          from_date: result.scope?.from_date ?? current.from_date,
          to_date: result.scope?.to_date ?? current.to_date
        }));
        onQueryChange?.({
          ...requestedQuery,
          from_date: result.scope.from_date,
          to_date: result.scope.to_date
        });
      }
    } catch (error) {
      if (sequence === requestSequence.current) setMessage(errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [api, mode, onQueryChange, overview]);

  const updateFilter = (next: Partial<HistoryFilters>) => {
    const nextFilters = { ...filters, ...next };
    const nextQuery = queryFromFilters(overview ? { ...nextFilters, issue_filter: "" } : nextFilters, groupBy);
    const dynamicLoad = mode === "product" && !detailOnly && hasLoadedOnce;
    requestSequence.current += 1;
    setLoading(false);
    setFilters(nextFilters);
    onQueryChange?.(nextQuery);
    setScope(null);
    setSelectedGroup(null);
    setDetailRows(null);
    setSelectedIds(new Set());
    setMessage("");
    setPreview(null);
    if (autoLoadTimer.current !== null) {
      hostWindow.clearTimeout(autoLoadTimer.current);
      autoLoadTimer.current = null;
    }
    if (dynamicLoad && (overview || Object.keys(nextQuery).some((key) => key !== "group_by"))) {
      autoLoadTimer.current = hostWindow.setTimeout(() => {
        void loadStatsForQuery(nextQuery);
      }, 250);
    } else {
      setGroups(null);
      if (!overview && !Object.keys(nextQuery).some((key) => key !== "group_by")) {
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
    onQueryChange?.(queryFromFilters(overview ? { ...nextFilters, issue_filter: "" } : nextFilters, groupBy));
    setGroups(null);
    setScope(null);
    setHasLoadedOnce(false);
    setSelectedGroup(null);
    setDetailRows(null);
    setSelectedIds(new Set());
    setPreview(null);
    setMessage("");
  };

  const openDetail = useCallback(async (
    group: HistoricalProductStat,
    baseQuery: typeof query = query
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
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setMessage(t("正在加载商品时间线…", "Loading the item timeline…"));
    try {
      const result = await api.productHistory(detailQuery);
      if (sequence !== requestSequence.current) return;
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
      if (sequence === requestSequence.current) setMessage(errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [api, categories, detailOnly, embedded, onOpenDetail, query]);

  useEffect(() => {
    if (mode !== "product" || detailOnly || hasLoadedOnce) return;
    if (skipNextQueryRef.current) {
      skipNextQueryRef.current = false;
      return;
    }
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
    mounted.current = false;
    requestSequence.current += 1;
    if (autoLoadTimer.current !== null) hostWindow.clearTimeout(autoLoadTimer.current);
  }, [hostWindow]);

  const toggleAllVisible = () => {
    requestSequence.current += 1;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
    setPreview(null);
    setLoading(false);
  };

  const toggleSelected = (id: number) => {
    requestSequence.current += 1;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreview(null);
    setLoading(false);
  };

  const categoryGroupTransactionIds = (group: HistoricalProductStat): number[] =>
    (detailRows ?? [])
      .filter((row) => row.type === group.transaction_type
        && normalizeProductKey(row.product) === group.product_key)
      .map((row) => row.id);
  const categoryGroupSelected = (group: HistoricalProductStat): boolean => {
    const ids = categoryGroupTransactionIds(group);
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
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
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setMessage(t("正在生成回溯预览…", "Preparing the backfill preview…"));
    try {
      const result = await api.previewCategoryBackfill({
        transaction_ids: [...selectedIds],
        target_category_key: targetCategoryKey
      });
      if (sequence !== requestSequence.current) return;
      setPreview(result);
      setMessage("");
    } catch (error) {
      if (sequence === requestSequence.current) setMessage(errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  const applyBackfill = async () => {
    if (!preview) return;
    const previewSnapshot = preview;
    const previewSequence = requestSequence.current;
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
    if (previewSequence !== requestSequence.current) {
      setMessage(t("迁移预览已失效，请重新生成预览。", "The migration preview is stale. Generate a new preview."));
      return;
    }
    const sequence = previewSequence + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setMessage(t("正在写入历史分类…", "Applying historical categories…"));
    try {
      const result = await api.applyCategoryBackfill({
        transaction_ids: previewSnapshot.transaction_ids,
        target_category_key: previewSnapshot.target_category_key,
        expected_month_revisions: Object.fromEntries(
          previewSnapshot.months.map((month) => [month.month, month.revision])
        )
      });
      if (!mounted.current || sequence !== requestSequence.current) return;
      onSaved();
      if (!mounted.current) return;
      onDataChanged();
      new Notice(t(`已更新 ${result.updated_count} 条历史流水。`, `Updated ${result.updated_count} historical transactions.`));

      setMessage("");
      if (!embedded) onClose?.();
    } catch (error) {
      if (sequence === requestSequence.current) setMessage(errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  const sourceCategoryKey = initialQuery?.category_key ?? "";
  const sourceCategory = categories.find((category) => category.category_key === sourceCategoryKey);
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
    requestSequence.current += 1;
    const ids = categoryGroupTransactionIds(group);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (categoryGroupSelected(group)) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    setPreview(null);
    setLoading(false);
  };

  const toggleAllCategoryGroups = () => {
    requestSequence.current += 1;
    setSelectedIds((current) => {
      const next = new Set(current);
      const allIds = sortedGroups.flatMap((group) => categoryGroupTransactionIds(group));
      if (allCategoryGroupsSelected) allIds.forEach((id) => next.delete(id));
      else allIds.forEach((id) => next.add(id));
      return next;
    });
    setPreview(null);
    setLoading(false);
  };

  const updateTargetCategory = (categoryKey: string) => {
    requestSequence.current += 1;
    setTargetCategoryKey(categoryKey);
    setPreview(null);
    setLoading(false);
  };

  return <div className="asset-track-rule-history-modal-content">
    {mode === "product" && !detailOnly && (!embedded || overview) && <RuleHistoryFilters
      categories={categories}
      groupBy={groupBy}
      onGroupBy={onGroupBy}
      filters={filters}
      overview={overview}
      hideIssueFilter={hideIssueFilter}
      loading={loading}
      hasFilter={hasFilter}
      onUpdate={updateFilter}
      onReset={resetFilters}
    />}

    {scope && !detailOnly && <p className="asset-track-read-window-note" role="note">{overview
      ? t(`商品总览范围：${scope.from_date} 至 ${scope.to_date}`, `Item overview range: ${scope.from_date} to ${scope.to_date}`)
      : mode === "category"
        ? t(`分类历史范围：近 5 年（${scope.from_date} 至 ${scope.to_date}）`, `Category history range: last 5 years (${scope.from_date} to ${scope.to_date})`)
        : t(`统计范围：近 5 年（${scope.from_date} 至 ${scope.to_date}）`, `Statistics range: last 5 years (${scope.from_date} to ${scope.to_date})`)}</p>}

    {message && <p className="asset-track-rule-history-message" role="status">{message}</p>}

    {mode === "product" && !overview && !detailOnly && !hasFilter && !groups && !selectedGroup && <p className="asset-track-rule-history-empty" role="status">
      {t("请选择至少一个筛选条件。", "Choose at least one filter.")}
    </p>}

    {mode === "category" && !groups && !message && <p className="asset-track-rule-history-empty" role="status">
      {t("正在加载当前分类下的商品…", "Loading items in this category…")}
    </p>}

    {mode === "product" && !detailOnly && !selectedGroup && groups && (overview
      ? <ProductOverviewTable
          groups={sortedGroups}
          sort={sort}
          onSort={setSort}
          onOpenDetail={(group) => { void openDetail(group); }}
          onOpenProductRename={groupBy === "product" ? onOpenProductRename : undefined}
          onOpenCounterpartyRename={groupBy === "counterparty" ? onOpenCounterpartyRename : undefined}
          onCreateRule={onCreateRule}
          groupBy={groupBy}
        />
      : <ProductHealthTable
          groups={sortedGroups}
          sort={sort}
          onSort={setSort}
          onOpenDetail={(group) => { void openDetail(group); }}
          onOpenProductRename={onOpenProductRename}
          onCreateRule={onCreateRule}
        />)}

    {mode === "category" && groups && <CategoryHistoryMigrationPanel
      groups={sortedGroups}
      sourceCategoryName={sourceCategory?.name ?? ""}
      sort={sort}
      targetCategoryKey={targetCategoryKey}
      targetCategories={targetCategories}
      selectedIds={selectedIds}
      loading={loading}
      preview={preview}
      allCategoryGroupsSelected={allCategoryGroupsSelected}
      categoryGroupSelected={categoryGroupSelected}
      onSort={setSort}
      onToggleAll={toggleAllCategoryGroups}
      onToggleGroup={toggleCategoryGroup}
      onTargetCategoryChange={updateTargetCategory}
      onPreview={() => { void previewBackfill(); }}
      onApply={() => { void applyBackfill(); }}
      onClose={onClose}
    />}

    {mode === "product" && selectedGroup && detailRows && <ProductHistoryDetailPanel
      selectedGroup={selectedGroup}
      detailRows={detailView}
      detailOnly={detailOnly}
      selectedIds={selectedIds}
      allVisibleSelected={allVisibleSelected}
      targetCategoryKey={targetCategoryKey}
      targetCategories={targetCategories}
      preview={preview}
      loading={loading}
      onClose={() => onClose?.()}
      onBack={() => {
        requestSequence.current += 1;
        setLoading(false);
        setMessage("");
        setSelectedGroup(null);
        setDetailRows(null);
        setSelectedIds(new Set());
        setPreview(null);
      }}
      onToggleAllVisible={toggleAllVisible}
      onToggleSelected={toggleSelected}
      onTargetCategoryChange={updateTargetCategory}
      onPreview={() => { void previewBackfill(); }}
      onApply={() => { void applyBackfill(); }}
    />}
  </div>;
}
