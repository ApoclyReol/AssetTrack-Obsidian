import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { App } from "obsidian";
import type {
  CategoryDefinition,
  TagDefinition
} from "../../types/configuration";
import type {
  MonthWorkspace
} from "../../types/month";
import type {
  SavedRule
} from "../../types/rules";
import type {
  Transaction
} from "../../types/transactions";
import type { TransactionAnalysisDrilldown } from "../../types/analysis";
import type {
  CsvRawRow
} from "../../types/csv";
import type {
  TransactionBusinessTab,
  TransactionViewMode
} from "../../types/operations";
import { t } from "../../i18n";
import { transactionTypesForTab } from "../../domain/transactionOperations";
import {
  TransactionSummaryTable,
  TransactionTable,
  type TransactionRuleControlContext
} from "../TransactionTables";
import {
  groupTransactions,
  transactionKeysForIndexes,
  type TransactionGroup,
  type TransactionGroupBy,
  type TransactionKey
} from "../transactionGrouping";
import {
  type SortState
} from "../editorPrimitives";

export const TRANSACTION_BUSINESS_TABS: Array<{
  value: TransactionBusinessTab;
  label: string;
  englishLabel: string;
}> = [
  { value: "outgoing", label: "出账", englishLabel: "Outgoing" },
  { value: "incoming", label: "入账", englishLabel: "Incoming" },
  { value: "investment", label: "理财", englishLabel: "Investment" }
];

export interface TransactionBatchActionsContext {
  businessTab: TransactionBusinessTab;
  viewMode: TransactionViewMode;
  selectedTransactionKeys: ReadonlySet<TransactionKey>;
  currentViewTransactionKeys: readonly TransactionKey[];
}

export interface MonthEditorRuleControlContext extends TransactionRuleControlContext {
  businessTab: TransactionBusinessTab;
}

export type MonthEditorRuleControls = (
  context: MonthEditorRuleControlContext
) => ReactNode;

export interface MonthEditorTransactionActionsContext extends TransactionRuleControlContext {
  businessTab: TransactionBusinessTab;
}

export type MonthEditorTransactionActions = (
  context: MonthEditorTransactionActionsContext
) => ReactNode;

export interface MonthEditorTransactionsSectionProps {
  app?: App;
  month: string;
  draft: MonthWorkspace;
  categories: CategoryDefinition[];
  tags?: TagDefinition[];
  loadTags?: () => Promise<TagDefinition[]>;
  transactionDrilldown?: TransactionAnalysisDrilldown | null;
  onClearTransactionDrilldown?: () => void;
  issues?: Array<Record<string, unknown>>;
  rules?: SavedRule[];
  summarySort: SortState;
  expandedGroup: string;
  onSummarySort: (sort: SortState) => void;
  onExpandedGroupChange: (key: string) => void;
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
  onUpdateGroup?: (indexes: readonly number[], field: keyof Transaction, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: (title: string) => void;
  businessTab?: TransactionBusinessTab;
  onBusinessTabChange?: (tab: TransactionBusinessTab) => void;
  viewMode: TransactionViewMode;
  onViewModeChange: (mode: TransactionViewMode) => void;
  selectedTransactionKeys?: ReadonlySet<TransactionKey>;
  onSelectedTransactionKeysChange?: (keys: Set<TransactionKey>) => void;
  renderBatchActions?: (context: TransactionBatchActionsContext) => ReactNode;
  onCreateRule?: (group: TransactionGroup) => void;
  renderRuleControls?: MonthEditorRuleControls;
  renderTransactionActions?: MonthEditorTransactionActions;
  showBusinessTabs?: boolean;
  sourceRows?: readonly CsvRawRow[];
  onViewSourceRow?: (row: Transaction, sourceRow: CsvRawRow) => void;
}

export function MonthEditorTransactionsSection({
  app,
  month,
  draft,
  categories,
  tags = [],
  loadTags,
  transactionDrilldown,
  onClearTransactionDrilldown,
  issues = [],
  rules = [],
  summarySort,
  expandedGroup,
  onSummarySort,
  onExpandedGroupChange,
  onUpdate,
  onUpdateGroup,
  onDelete,
  onAdd,
  businessTab,
  onBusinessTabChange,
  viewMode,
  onViewModeChange,
  selectedTransactionKeys,
  onSelectedTransactionKeysChange,
  renderBatchActions,
  onCreateRule,
  renderRuleControls,
  renderTransactionActions,
  showBusinessTabs = true,
  sourceRows = [],
  onViewSourceRow
}: MonthEditorTransactionsSectionProps) {
  const [localBusinessTab, setLocalBusinessTab] = useState<TransactionBusinessTab>(
    businessTab ?? "outgoing"
  );
  const [localSelectedTransactionKeys, setLocalSelectedTransactionKeys] = useState<Set<TransactionKey>>(
    () => new Set()
  );
  const previousMonth = useRef(month);

  useEffect(() => {
    if (businessTab !== undefined) setLocalBusinessTab(businessTab);
  }, [businessTab]);

  useEffect(() => {
    if (previousMonth.current !== month && selectedTransactionKeys === undefined) {
      setLocalSelectedTransactionKeys(new Set());
    }
    previousMonth.current = month;
  }, [month, selectedTransactionKeys]);

  const activeBusinessTab = businessTab ?? localBusinessTab;
  const activeViewMode = viewMode;
  const isInvestmentTab = activeBusinessTab === "investment";
  const activeTypes = useMemo(
    () => transactionTypesForTab(activeBusinessTab),
    [activeBusinessTab]
  );
  const activeTypeSet = useMemo(() => new Set(activeTypes), [activeTypes]);
  const activeIndexes = useMemo(
    () => draft.transactions.flatMap((row, index) => {
      if (!activeTypeSet.has(row.type)) return [];
      if (!transactionDrilldown) return [index];
      if (transactionDrilldown.dimension === "tag") {
        return row.tag_keys?.includes(transactionDrilldown.key) ? [index] : [];
      }
      if (transactionDrilldown.dimension === "category") {
        return row.category_key === transactionDrilldown.key || row.category === transactionDrilldown.key
          ? [index] : [];
      }
      const category = categories.find((item) => item.category_key === row.category_key)
        ?? categories.find((item) => item.name === row.category);
      return category?.attribute_keys?.includes(transactionDrilldown.key) ? [index] : [];
    }),
    [activeTypeSet, categories, draft.transactions, transactionDrilldown]
  );
  const groupBy: TransactionGroupBy = activeViewMode === "counterparty"
    ? "counterparty"
    : "product";
  const summaryGroups = useMemo(
    () => activeViewMode === "detail"
      ? []
      : groupTransactions(draft.transactions, groupBy, activeIndexes, rules),
    [activeIndexes, activeViewMode, draft.transactions, groupBy, rules]
  );
  const currentViewTransactionKeys = useMemo(() => {
    if (activeViewMode === "detail") {
      return transactionKeysForIndexes(draft.transactions, activeIndexes);
    }
    const keys = new Set<TransactionKey>();
    summaryGroups.forEach((group) => {
      group.transactionKeys.forEach((key) => keys.add(key));
    });
    return [...keys];
  }, [activeIndexes, activeViewMode, draft.transactions, summaryGroups]);
  const effectiveSelectedKeys = selectedTransactionKeys ?? localSelectedTransactionKeys;
  const selectedCount = currentViewTransactionKeys.filter((key) => effectiveSelectedKeys.has(key)).length;
  const allCurrentViewSelected = currentViewTransactionKeys.length > 0
    && selectedCount === currentViewTransactionKeys.length;
  const effectiveShowSecondaryFields = true;

  const commitSelection = (next: Set<TransactionKey>): void => {
    if (selectedTransactionKeys === undefined) setLocalSelectedTransactionKeys(next);
    onSelectedTransactionKeysChange?.(next);
  };

  const toggleTransaction = (key: TransactionKey): void => {
    const next = new Set(effectiveSelectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    commitSelection(next);
  };

  const toggleTransactionKeys = (keys: readonly TransactionKey[]): void => {
    const next = new Set(effectiveSelectedKeys);
    const allSelected = keys.length > 0 && keys.every((key) => next.has(key));
    keys.forEach((key) => {
      if (allSelected) next.delete(key);
      else next.add(key);
    });
    commitSelection(next);
  };

  const changeBusinessTab = (next: TransactionBusinessTab): void => {
    if (businessTab === undefined) setLocalBusinessTab(next);
    onBusinessTabChange?.(next);
  };

  const changeViewMode = (next: TransactionViewMode): void => {
    onViewModeChange(next);
  };

  const tableRuleControls = renderRuleControls
    ? (context: TransactionRuleControlContext) => renderRuleControls({
      ...context,
      businessTab: activeBusinessTab
    })
    : undefined;
  const tableTransactionActions = renderTransactionActions
    ? (context: TransactionRuleControlContext) => renderTransactionActions({
      ...context,
      businessTab: activeBusinessTab
    })
    : undefined;

  return (
    <>
      <section className="asset-track-view-switcher" aria-label={t("流水展示", "Transaction display")}>
        {(showBusinessTabs || transactionDrilldown) && <div className="asset-track-transaction-toolbar-row asset-track-transaction-toolbar-row--primary">
          <div className="asset-track-transaction-display">
            {transactionDrilldown && <span className="asset-track-transaction-filter" role="status">
              {t(`已筛选：${transactionDrilldown.label}`, `Filtered: ${transactionDrilldown.label}`)}
              {onClearTransactionDrilldown && <button
                type="button"
                className="asset-track-analysis-drilldown"
                onClick={onClearTransactionDrilldown}
              >{t("清除", "Clear")}</button>}
            </span>}
            {showBusinessTabs && <div
              className="asset-track-transaction-business-tabs"
              role="tablist"
              aria-label={t("流水业务类型", "Transaction business type")}
            >
              {TRANSACTION_BUSINESS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  className={activeBusinessTab === tab.value ? "is-active" : ""}
                  aria-selected={activeBusinessTab === tab.value}
                  onClick={() => changeBusinessTab(tab.value)}
                >
                  {t(tab.label, tab.englishLabel)}
                </button>
              ))}
            </div>}
            {showBusinessTabs && (
              <span className="asset-track-transaction-tab-description">
                {activeBusinessTab === "outgoing"
                  ? t("出账及分类", "Outgoing and categories")
                  : activeBusinessTab === "incoming"
                    ? t("入账及代付", "Incoming and paid-on-behalf")
                    : t("理财流水", "Investment flows")}
              </span>
            )}
          </div>
        </div>}
        <div className="asset-track-transaction-toolbar-row asset-track-transaction-toolbar-row--secondary">
          {!isInvestmentTab && <div className="asset-track-transaction-view-tabs" role="tablist" aria-label={t("流水视图", "Transaction view")}>
          <button
            type="button"
            role="tab"
            className={activeViewMode === "detail" ? "is-active" : ""}
            aria-selected={activeViewMode === "detail"}
            onClick={() => changeViewMode("detail")}
          >
            {t("逐项", "Individual")}
          </button>
          <button
            type="button"
            role="tab"
            className={activeViewMode === "product" ? "is-active" : ""}
            aria-selected={activeViewMode === "product"}
            onClick={() => changeViewMode("product")}
          >
            {t("按商品汇总", "Group by item")}
          </button>
          <button
            type="button"
            role="tab"
            className={activeViewMode === "counterparty" ? "is-active" : ""}
            aria-selected={activeViewMode === "counterparty"}
            onClick={() => changeViewMode("counterparty")}
          >
            {t("按交易对手汇总", "Group by counterparty")}
          </button>
          </div>}
          <div className="asset-track-transaction-batch-actions asset-track-transaction-batch-actions--secondary">
            <button
              type="button"
              disabled={currentViewTransactionKeys.length === 0}
              aria-pressed={allCurrentViewSelected}
              onClick={() => toggleTransactionKeys(currentViewTransactionKeys)}
            >
              {allCurrentViewSelected
                ? t("全不选当前视图", "Deselect all in current view")
                : t("全选当前视图", "Select all in current view")}
            </button>
            <span role="status">
              {t(`已选择 ${selectedCount} 条流水`, `${selectedCount} transactions selected`)}
            </span>
            {renderBatchActions?.({
              businessTab: activeBusinessTab,
              viewMode: activeViewMode,
              selectedTransactionKeys: effectiveSelectedKeys,
              currentViewTransactionKeys
            })}
          </div>
        </div>
      </section>
      {(isInvestmentTab || activeViewMode === "detail") && <div className={isInvestmentTab ? "asset-track-investment-tables" : undefined}>
        {activeTypes.map((type) => (
          <TransactionTable
            app={app}
            key={type}
            title={type}
            rows={draft.transactions}
            visibleIndexes={activeIndexes.filter((index) => draft.transactions[index]?.type === type)}
            categories={categories}
            tags={tags}
            loadTags={loadTags}
            issues={issues}
            showSecondaryFields={effectiveShowSecondaryFields}
            sourceRows={sourceRows}
            onViewSourceRow={onViewSourceRow}
            investmentAccounts={draft.investment_accounts}
            selectedTransactionKeys={effectiveSelectedKeys}
            onToggleTransaction={toggleTransaction}
            renderRuleControls={tableRuleControls}
            renderTransactionActions={tableTransactionActions}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAdd={() => onAdd(type)}
          />
        ))}
      </div>}
      {!isInvestmentTab && activeViewMode !== "detail" && (
        <TransactionSummaryTable
          app={app}
          rows={draft.transactions}
          visibleIndexes={activeIndexes}
          groups={summaryGroups}
          businessTab={activeBusinessTab}
          categories={categories}
          tags={tags}
          loadTags={loadTags}
          issues={issues}
          rules={rules}
          groupBy={groupBy}
          selectedTransactionKeys={effectiveSelectedKeys}
          onToggleTransaction={toggleTransaction}
          onToggleGroup={toggleTransactionKeys}
          onCreateRule={onCreateRule}
          renderRuleControls={tableRuleControls}
          renderTransactionActions={tableTransactionActions}
          sort={summarySort}
          onSort={onSummarySort}
          expanded={expandedGroup}
          onExpanded={onExpandedGroupChange}
          onUpdate={onUpdate}
          onUpdateGroup={onUpdateGroup}
          onDelete={onDelete}
        />
      )}
    </>
  );
}
