import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CategoryDefinition
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
import type {
  TransactionBusinessTab,
  TransactionViewMode
} from "../../types/operations";
import { t } from "../../i18n";
import { transactionTypesForTab } from "../../domain/transactionOperations";
import { transactionIndexes } from "../analysisModel";
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
import type { SortState } from "../editorPrimitives";

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
  month: string;
  draft: MonthWorkspace;
  categories: CategoryDefinition[];
  rules?: SavedRule[];
  summarySort: SortState;
  expandedGroup: string;
  onSummarySort: (sort: SortState) => void;
  onExpandedGroupChange: (key: string) => void;
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
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
}

function appendUnique(keys: TransactionKey[], next: TransactionKey[]): void {
  next.forEach((key) => {
    if (!keys.includes(key)) keys.push(key);
  });
}

export function MonthEditorTransactionsSection({
  month,
  draft,
  categories,
  rules = [],
  summarySort,
  expandedGroup,
  onSummarySort,
  onExpandedGroupChange,
  onUpdate,
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
  showBusinessTabs = true
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
    () => draft.transactions.flatMap((row, index) => activeTypeSet.has(row.type) ? [index] : []),
    [activeTypeSet, draft.transactions]
  );
  const groupBy: TransactionGroupBy = activeViewMode === "counterparty"
    ? "counterparty"
    : "product";
  const currentViewTransactionKeys = useMemo(() => {
    if (activeViewMode === "detail") {
      return transactionKeysForIndexes(draft.transactions, activeIndexes);
    }
    const keys: TransactionKey[] = [];
    groupTransactions(draft.transactions, groupBy, activeIndexes).forEach((group) => {
      appendUnique(keys, group.transactionKeys);
    });
    return keys;
  }, [activeIndexes, activeViewMode, draft.transactions, groupBy]);
  const effectiveSelectedKeys = selectedTransactionKeys ?? localSelectedTransactionKeys;
  const selectedCount = currentViewTransactionKeys.filter((key) => effectiveSelectedKeys.has(key)).length;
  const allCurrentViewSelected = currentViewTransactionKeys.length > 0
    && selectedCount === currentViewTransactionKeys.length;

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
      {(!isInvestmentTab || showBusinessTabs) && <section className="asset-track-view-switcher" aria-label={t("流水展示", "Transaction display")}>
        <div className="asset-track-transaction-toolbar-row asset-track-transaction-toolbar-row--primary">
          <div className="asset-track-transaction-display">
            <strong>{t("流水展示", "Transaction display")}</strong>
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
          </div>
          {!isInvestmentTab && <div className="asset-track-transaction-batch-actions asset-track-transaction-batch-actions--primary">
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
            </div>}
        </div>
        {!isInvestmentTab && <div className="asset-track-transaction-toolbar-row asset-track-transaction-toolbar-row--secondary">
          <div className="asset-track-transaction-view-tabs" role="tablist" aria-label={t("流水视图", "Transaction view")}>
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
          </div>
          <div className="asset-track-transaction-batch-actions asset-track-transaction-batch-actions--secondary">
            {renderBatchActions?.({
              businessTab: activeBusinessTab,
              viewMode: activeViewMode,
              selectedTransactionKeys: effectiveSelectedKeys,
              currentViewTransactionKeys
            })}
          </div>
        </div>}
        {!isInvestmentTab && <span className="asset-track-transaction-toolbar-hint">
          {t(
            "汇总只影响查看和选择，保存时仍保留每笔流水。",
            "Grouping only changes viewing and selection. Every transaction is preserved when saved."
          )}
        </span>}
      </section>}
      {(isInvestmentTab || activeViewMode === "detail") && <div className={isInvestmentTab ? "asset-track-investment-tables" : undefined}>
        {activeTypes.map((type) => (
          <TransactionTable
            key={type}
            title={type}
            month={month}
            rows={draft.transactions}
            visibleIndexes={transactionIndexes(draft.transactions, type)}
            categories={categories}
            investmentAccounts={draft.investment_accounts}
            selectedTransactionKeys={isInvestmentTab ? undefined : effectiveSelectedKeys}
            onToggleTransaction={isInvestmentTab ? undefined : toggleTransaction}
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
          rows={draft.transactions}
          visibleIndexes={activeIndexes}
          businessTab={activeBusinessTab}
          categories={categories}
          investmentAccounts={draft.investment_accounts}
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
          onDelete={onDelete}
        />
      )}
    </>
  );
}
