import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import type {
  CategoryDefinition,
  InvestmentAccountBalance
} from "../types/configuration";
import type {
  FixedAsset
} from "../types/month";
import type {
  SavedRule
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import type {
  TransactionBusinessTab
} from "../types/operations";
import { businessLabel, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import {
  transactionBlockNumber,
  transactionBlockNumbers
} from "./analysisModel";
import {
  groupTransactions,
  transactionKey,
  type TransactionGroup,
  type TransactionGroupBy,
  type TransactionKey
} from "./transactionGrouping";
import {
  calculateVirtualRowRange,
  virtualSpacerBlocks
} from "./virtualRows";
import {
  Section,
  SortButton,
  sortRows,
  type SortState
} from "./editorPrimitives";
import { ActionTableHeader } from "./TablePrimitives";

const CATEGORY_TRANSACTION_TYPES = new Set(["支出", "收入"]);
const SUMMARY_SORT_FIELDS = new Set([
  "type",
  "product",
  "counterparty",
  "label",
  "count",
  "amount",
  "category",
  "counterparty_count",
  "product_count",
  "category_purity",
  "uncategorized_count"
]);

function tableRowKey(row: { id?: number; client_id?: string }, index: number): string {
  const key = transactionKey(row);
  return key === null ? `unkeyed-${index}` : String(key);
}

function tableReactKey(row: { id?: number; client_id?: string }, index: number): string {
  const key = transactionKey(row);
  return key === null ? `unkeyed-${index}` : `${typeof key}:${String(key)}`;
}

function transactionTypeUsesCategory(type: string): boolean {
  return CATEGORY_TRANSACTION_TYPES.has(type) || type === "代付";
}

function transactionTypeUsesRules(type: string): boolean {
  return CATEGORY_TRANSACTION_TYPES.has(type);
}

function categoryTypeForTransaction(type: string): string {
  return type === "代付" ? "支出" : type;
}

function summaryCategoryLabels(group: TransactionGroup): string[] {
  if (!transactionTypeUsesCategory(group.type)) return [];
  const labels = group.categoryCounts.map((item) => `${item.category}（${item.count}）`);
  if (group.uncategorizedCount > 0) {
    labels.push(t(`未分类（${group.uncategorizedCount}）`, `Uncategorized (${group.uncategorizedCount})`));
  }
  return labels.length > 0 ? labels : [t("未分类", "Uncategorized")];
}

function summaryCategoryLabel(group: TransactionGroup): string {
  return summaryCategoryLabels(group).join("\n");
}

function summarySortValue(group: TransactionGroup, key: string): unknown {
  if (key === "type") return businessLabel(group.type);
  if (key === "category") return summaryCategoryLabel(group);
  if (key === "product" || key === "counterparty" || key === "label") return group.label;
  if (key === "counterparty_count") return group.counterpartyCount;
  if (key === "product_count") return group.productCount;
  if (key === "category_purity") return group.categoryPurity ?? -1;
  if (key === "uncategorized_count") return group.uncategorizedCount;
  return group[key as keyof TransactionGroup];
}

export interface TransactionRuleControlContext {
  row: Transaction;
  index: number;
  transactionKey: TransactionKey | null;
}

export type TransactionRuleControls = (
  context: TransactionRuleControlContext
) => ReactNode;

export type TransactionRowActions = (
  context: TransactionRuleControlContext
) => ReactNode;

export interface TransactionTableProps {
  title: string;
  month: string;
  rows: Transaction[];
  visibleIndexes: number[];
  categories: CategoryDefinition[];
  investmentAccounts?: InvestmentAccountBalance[];
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  selectedTransactionKeys?: ReadonlySet<TransactionKey>;
  onToggleTransaction?: (key: TransactionKey) => void;
  renderRuleControls?: TransactionRuleControls;
  renderTransactionActions?: TransactionRowActions;
}

export interface TransactionSummaryTableProps {
  rows: Transaction[];
  categories: CategoryDefinition[];
  investmentAccounts?: InvestmentAccountBalance[];
  businessTab?: TransactionBusinessTab;
  rules?: SavedRule[];
  sort: SortState;
  onSort: (sort: SortState) => void;
  expanded: string;
  onExpanded: (key: string) => void;
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
  onDelete: (index: number) => void;
  groupBy?: TransactionGroupBy;
  visibleIndexes?: readonly number[];
  selectedTransactionKeys?: ReadonlySet<TransactionKey>;
  onToggleTransaction?: (key: TransactionKey) => void;
  onToggleGroup?: (keys: readonly TransactionKey[]) => void;
  onCreateRule?: (group: TransactionGroup) => void;
  renderRuleControls?: TransactionRuleControls;
  renderTransactionActions?: TransactionRowActions;
}

export function TransactionTable({
  title,
  rows,
  visibleIndexes,
  categories,
  investmentAccounts = [],
  onUpdate,
  onDelete,
  onAdd,
  selectedTransactionKeys,
  onToggleTransaction,
  renderRuleControls,
  renderTransactionActions
}: TransactionTableProps) {
  const displayTitle = businessLabel(title);
  const [sort, setSort] = useState<SortState>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 600
  });
  const [rowHeight, setRowHeight] = useState(50);
  const virtualTableRef = useRef<HTMLDivElement | null>(null);
  const previousRowCount = useRef(rows.length);
  const pendingFocusKey = useRef<string | null>(null);
  const usesCategory = transactionTypeUsesCategory(title);
  const usesInvestmentAccount = title === "加仓" || title === "提现";
  const businessClass = title === "支出"
    ? " asset-track-grid--outgoing"
    : title === "收入" || title === "代付"
      ? " asset-track-grid--incoming"
      : " asset-track-grid--investment";
  const gridClassName = `asset-track-grid${businessClass}${usesInvestmentAccount || usesCategory
    ? "" : " asset-track-grid--no-category"}`;
  const columns: Array<[string, string]> = usesInvestmentAccount
    ? [
      ["transaction_date", t("日期", "Date")],
      ["account_key", t("账户", "Account")],
      ["amount", t("金额", "Amount")]
    ]
    : [
      ["transaction_date", t("日期", "Date")],
      ["counterparty", t("交易对手", "Counterparty")],
      ...(usesCategory ? [["category", t("分类", "Category")] as [string, string]] : []),
      ["product", t("商品", "Item")],
      ["amount", t("金额", "Amount")]
    ];
  const sorted = useMemo(
    () =>
      sortRows(visibleIndexes, sort, (index, key) => key === "row_number"
        ? transactionBlockNumber(rows, index)
        : rows[index][key as keyof Transaction]),
    [rows, sort, visibleIndexes]
  );
  const blockNumbers = useMemo(
    () => transactionBlockNumbers(rows),
    [rows]
  );
  const range = calculateVirtualRowRange(
    sorted.length,
    viewport.scrollTop,
    viewport.height,
    rowHeight
  );
  const visibleRows = sorted.slice(range.start, range.end);
  useEffect(() => {
    if (rows.length > previousRowCount.current) {
      const newIndex = rows.length - 1;
      if (rows[newIndex]?.type === title) {
        const sortedPosition = sorted.findIndex(({ row }) => row === newIndex);
        if (sortedPosition >= 0) {
          pendingFocusKey.current = tableRowKey(rows[newIndex], newIndex);
          const nextScrollTop = (sortedPosition + 1) * rowHeight;
          const table = virtualTableRef.current;
          if (table) {
            table.scrollTop = nextScrollTop;
            setViewport({
              scrollTop: nextScrollTop,
              height: table.clientHeight
            });
          }
        }
      }
    }
    previousRowCount.current = rows.length;
  }, [rowHeight, rows, sorted, title]);
  useEffect(() => {
    if (!pendingFocusKey.current) return;
    const target = Array.from(virtualTableRef.current?.querySelectorAll("[data-asset-track-row-key]") ?? [])
      .find((element) => element.getAttribute("data-asset-track-row-key") === pendingFocusKey.current);
    const input = target?.querySelector("input, select") as HTMLInputElement | HTMLSelectElement | null;
    if (!input) return;
    input.focus();
    pendingFocusKey.current = null;
  }, [visibleRows, viewport.scrollTop]);
  useEffect(() => {
    const table = virtualTableRef.current;
    if (!table) return;
    const rowsToMeasure = Array.from(
      table.querySelectorAll<HTMLElement>(".asset-track-grid:not(.asset-track-grid-head)")
    );
    const measure = () => {
      const measured = Math.max(
        50,
        ...rowsToMeasure.map((row) => Math.ceil(row.getBoundingClientRect().height))
      );
      setRowHeight((current) => current === measured ? current : measured);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    rowsToMeasure.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [range.start, range.end, sorted, title]);
  return (
    <Section title={t(
      `${title}（${visibleIndexes.length} 行）`,
      `${displayTitle} (${visibleIndexes.length} rows)`
    )}>
      <div
        ref={virtualTableRef}
        className="asset-track-virtual-table"
        style={{ "--asset-track-virtual-row-height": `${rowHeight}px` } as CSSProperties}
        role="table"
        aria-rowcount={sorted.length + 1}
        onScroll={(event) => {
          setViewport({
            scrollTop: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight
          });
        }}
      >
        <div className={`${gridClassName} asset-track-grid-head`}>
          <span className="asset-track-row-number-heading">
            <SortButton field="row_number" label={t("行号", "Row")} sort={sort} onSort={setSort} />
          </span>
          {columns.map(([field, label]) => (
            <SortButton key={field} field={field} label={label} sort={sort} onSort={setSort} />
          ))}
          <button
            type="button"
            className="asset-track-sort asset-track-sort-static asset-track-grid-action-heading"
            aria-label={t("操作", "Actions")}
            aria-disabled="true"
            tabIndex={-1}
          >
            {t("操作", "Actions")}
          </button>
        </div>
        <div className="asset-track-virtual-body">
          {virtualSpacerBlocks(range.start).map((block) => (
            <div
              className={`asset-track-virtual-spacer is-${block}`}
              aria-hidden="true"
              key={`top-${block}`}
            />
          ))}
          {visibleRows.map(({ row: originalIndex }, visibleIndex) => {
            const row = rows[originalIndex];
            const blockNumber = blockNumbers[originalIndex];
            const stableKey = transactionKey(row);
            const options = usesCategory ? categories.filter(
              (category) =>
                category.transaction_type === categoryTypeForTransaction(row.type) &&
                (category.is_active || category.category_key === row.category_key)
            ) : [];
            return (
              <div
                className={gridClassName}
                data-asset-track-row-key={tableRowKey(row, originalIndex)}
                key={tableReactKey(row, originalIndex)}
                role="row"
                aria-rowindex={range.start + visibleIndex + 2}
              >
                <span className="asset-track-row-number">
                  {selectedTransactionKeys && onToggleTransaction && (
                    <input
                      className="asset-track-selection-checkbox"
                      type="checkbox"
                      checked={stableKey !== null && selectedTransactionKeys.has(stableKey)}
                      disabled={stableKey === null}
                      aria-label={t(`选择${title}第 ${blockNumber} 行`, `Select ${displayTitle} row ${blockNumber}`)}
                      onChange={() => {
                        if (stableKey !== null) onToggleTransaction(stableKey);
                      }}
                    />
                  )}
                  {blockNumber}
                </span>
                <input
                  aria-label={t(`${title}第 ${blockNumber} 行日期`, `${displayTitle} row ${blockNumber} date`)}
                  type="date"
                  value={row.transaction_date}
                  onChange={(event) => onUpdate(originalIndex, "transaction_date", event.target.value)}
                />
                {usesInvestmentAccount && (
                  <select
                    aria-label={t(`${title}第 ${blockNumber} 行账户`, `${displayTitle} row ${blockNumber} account`)}
                    value={row.account_key ?? ""}
                    onChange={(event) => onUpdate(originalIndex, "account_key", event.target.value)}
                  >
                    <option value="">{t("请选择账户", "Select account")}</option>
                    {investmentAccounts
                      .filter((account) => account.is_active || account.account_key === row.account_key)
                      .map((account) => (
                        <option key={account.account_key} value={account.account_key}>
                          {account.name ?? account.account_key}
                        </option>
                      ))}
                  </select>
                )}
                {!usesInvestmentAccount && <input
                  aria-label={t(`${title}第 ${blockNumber} 行交易对方`, `${displayTitle} row ${blockNumber} counterparty`)}
                  value={row.counterparty ?? ""}
                  placeholder={t("交易对方", "Counterparty")}
                  onChange={(event) => onUpdate(originalIndex, "counterparty", event.target.value)}
                />}
                {!usesInvestmentAccount && usesCategory && (
                  <select
                    aria-label={t(`${title}第 ${blockNumber} 行分类`, `${displayTitle} row ${blockNumber} category`)}
                    value={row.category_key ?? ""}
                    onChange={(event) => onUpdate(originalIndex, "category_key", event.target.value)}
                  >
                    <option value="">{t("请选择", "Select")}</option>
                    {options.map((category) => (
                      <option key={category.category_key} value={category.category_key}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                )}
                {!usesInvestmentAccount && <input
                  aria-label={t(`${title}第 ${blockNumber} 行商品`, `${displayTitle} row ${blockNumber} item`)}
                  value={row.product}
                  onChange={(event) => onUpdate(originalIndex, "product", event.target.value)}
                />}
                <input
                  aria-label={t(`${title}第 ${blockNumber} 行金额`, `${displayTitle} row ${blockNumber} amount`)}
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.amount}
                  onChange={(event) => onUpdate(originalIndex, "amount", event.target.value)}
                />
                <span className="asset-track-transaction-actions">
                  {usesCategory && renderRuleControls?.({
                    row,
                    index: originalIndex,
                    transactionKey: stableKey
                  })}
                  {renderTransactionActions?.({
                    row,
                    index: originalIndex,
                    transactionKey: stableKey
                  })}
                  <button
                    type="button"
                    aria-label={t(`删除${title}第 ${blockNumber} 行`, `Delete ${displayTitle} row ${blockNumber}`)}
                    onClick={() => onDelete(originalIndex)}
                  >
                    {t("删除", "Delete")}
                  </button>
                </span>
              </div>
            );
          })}
          {virtualSpacerBlocks(sorted.length - range.end).map((block) => (
            <div
              className={`asset-track-virtual-spacer is-${block}`}
              aria-hidden="true"
              key={`bottom-${block}`}
            />
          ))}
        </div>
      </div>
      <button onClick={onAdd}>{t(`新增${title}流水`, `Add ${displayTitle} transaction`)}</button>
    </Section>
  );
}

export function TransactionSummaryTable({
  rows,
  categories,
  businessTab,
  rules = [],
  sort,
  onSort,
  expanded,
  onExpanded,
  onUpdate,
  onDelete,
  groupBy = "product",
  visibleIndexes,
  selectedTransactionKeys,
  onToggleTransaction,
  onToggleGroup,
  onCreateRule,
  renderRuleControls,
  renderTransactionActions
}: TransactionSummaryTableProps) {
  const effectiveSort = sort && SUMMARY_SORT_FIELDS.has(sort.key) ? sort : null;
  const groups = sortRows(
    groupTransactions(rows, groupBy, visibleIndexes, rules),
    effectiveSort,
    summarySortValue
  );
  const hasCategory = groups.some(({ row: group }) => transactionTypeUsesCategory(group.type));
  const summaryClassName = [
    businessTab ? `asset-track-summary-table--${businessTab}` : "",
    hasCategory ? "asset-track-summary-table--has-category" : ""
  ].filter(Boolean).join(" ");
  const groupLabel = groupBy === "product"
    ? t("商品", "Item")
    : t("交易对手", "Counterparty");
  const summaryTitle = groupBy === "product"
    ? t("商品汇总", "Item summary")
    : t("交易对手汇总", "Counterparty summary");
  return (
    <Section title={summaryTitle}>
      <div className="asset-track-table-scroll">
        <table className={`asset-track-summary-table ${summaryClassName}`.trim()}>
          <thead>
            <tr>
              <th scope="col" className="asset-track-type-column">
                <SortButton label={t("类型", "Type")} field="type" sort={effectiveSort} onSort={onSort} />
              </th>
              <th scope="col"><SortButton label={groupLabel} field={groupBy} sort={effectiveSort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-count-column"><SortButton label={t("出现次数", "Occurrences")} field="count" sort={effectiveSort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-amount-column"><SortButton label={t("总金额", "Total amount")} field="amount" sort={effectiveSort} onSort={onSort} /></th>
              {hasCategory && (
                <th scope="col" className="asset-track-summary-category-column">
                  <SortButton label={t("分类", "Category")} field="category" sort={effectiveSort} onSort={onSort} />
                </th>
              )}
              <ActionTableHeader className="asset-track-summary-actions-heading" />
            </tr>
          </thead>
          <tbody>
            {groups.map(({ row: group }) => (
              <Fragment key={group.key}>
                <tr>
                  <td className="asset-track-type-cell">
                    {selectedTransactionKeys && (onToggleTransaction || onToggleGroup) && (
                      <input
                        className="asset-track-selection-checkbox"
                        type="checkbox"
                        checked={group.transactionKeys.length > 0 && group.transactionKeys.every((key) => selectedTransactionKeys.has(key))}
                        disabled={group.transactionKeys.length === 0}
                        aria-label={t(`选择${group.label || "空"}汇总组`, `Select ${group.label || "(empty)"} summary group`)}
                        onChange={() => {
                          if (onToggleGroup) {
                            onToggleGroup(group.transactionKeys);
                          } else {
                            group.transactionKeys.forEach((key) => onToggleTransaction?.(key));
                          }
                        }}
                      />
                    )}
                    {businessLabel(group.type)}
                  </td>
                  <td title={group.variants.join("、")}>{group.label}</td>
                  <td className="asset-track-count-cell">{group.count}</td>
                  <td className="asset-track-amount-cell">{money(
                    group.amount,
                    group.type as "收入" | "支出" | "代付" | "加仓" | "提现"
                  )}</td>
                  {hasCategory && (
                    <td className="asset-track-summary-category-cell">
                      {transactionTypeUsesCategory(group.type) && (
                        <>
                          <span className="asset-track-summary-category-label">
                            {summaryCategoryLabels(group).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
                          </span>
                          <small>
                            {groupBy === "product"
                              ? t(`${group.counterpartyCount} 个交易对手`, `${group.counterpartyCount} counterparties`)
                              : t(`${group.productCount} 个商品`, `${group.productCount} items`)}
                          </small>
                        </>
                      )}
                    </td>
                  )}
                  <td className="asset-track-actions-cell asset-track-summary-actions-cell">
                    <span className="asset-track-transaction-actions">
                      {transactionTypeUsesRules(group.type) && (group.ruleIds.length > 0
                        ? <button
                          type="button"
                          className="asset-track-rule-button"
                          aria-label={t(`规则 #${group.ruleIds.join(",")}`, `Rules #${group.ruleIds.join(",")}`)}
                          onClick={(event) => event.preventDefault()}
                        >{t(`规则 #${group.ruleIds.join(",")}`, `Rules #${group.ruleIds.join(",")}`)}</button>
                        : onCreateRule && <button type="button" onClick={() => onCreateRule(group)}>
                          {t("新建规则", "New rule")}
                        </button>)}
                      <button type="button" onClick={() => onExpanded(expanded === group.key ? "" : group.key)}>
                        {expanded === group.key ? t("收起", "Collapse") : t("展开逐项", "Expand items")}
                      </button>
                    </span>
                  </td>
                </tr>
                {expanded === group.key && (
                  <tr key={`${group.key}:expanded`}>
                    <td colSpan={5 + (hasCategory ? 1 : 0)}>
                      <div className="asset-track-summary-details">
                        <table className={`asset-track-summary-detail-table${hasCategory ? " asset-track-summary-detail-table--has-category" : ""}`}>
                          <colgroup>
                            <col />
                            <col />
                            <col />
                            <col />
                            {hasCategory && <col />}
                            <col />
                          </colgroup>
                          <thead>
                            <tr>
                              <th scope="col">{t("行号", "Row")}</th>
                              <th scope="col" colSpan={3}>
                                <div className="asset-track-summary-detail-content-heading">
                                  <span>{t("交易对手", "Counterparty")}</span>
                                  <span>{t("商品", "Item")}</span>
                                  <span>{t("金额", "Amount")}</span>
                                  <span>{t("日期", "Date")}</span>
                                </div>
                              </th>
                              {hasCategory && <th scope="col">{t("分类", "Category")}</th>}
                              <th scope="col" className="asset-track-summary-actions-heading">{t("操作", "Actions")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.indexes.map((index) => {
                              const item = rows[index];
                              const usesCategory = transactionTypeUsesCategory(item.type);
                              const stableKey = transactionKey(item);
                              const blockNumber = transactionBlockNumber(rows, index);
                              const available = categories.filter(
                                (category) =>
                                  (category.is_active || category.category_key === item.category_key)
                                  && category.transaction_type === categoryTypeForTransaction(item.type)
                              );
                              return (
                                <tr key={tableReactKey(item, index)}>
                                  <td className="asset-track-summary-detail-index">
                                    <span className="asset-track-summary-detail-index-content">
                                      {selectedTransactionKeys && onToggleTransaction && (
                                        <input
                                          className="asset-track-selection-checkbox"
                                          type="checkbox"
                                          checked={stableKey !== null && selectedTransactionKeys.has(stableKey)}
                                          disabled={stableKey === null}
                                          aria-label={t(`选择${item.type}第 ${blockNumber} 行`, `Select ${businessLabel(item.type)} row ${blockNumber}`)}
                                          onChange={() => {
                                            if (stableKey !== null) onToggleTransaction(stableKey);
                                          }}
                                        />
                                      )}
                                      <span>{blockNumber}</span>
                                    </span>
                                  </td>
                                  <td colSpan={3} className="asset-track-summary-detail-content-cell">
                                    <div className="asset-track-summary-detail-content">
                                      <input value={item.counterparty ?? ""} placeholder={t("交易对手", "Counterparty")} onChange={(event) => onUpdate(index, "counterparty", event.target.value)} />
                                      <input value={item.product} aria-label={t("商品", "Item")} onChange={(event) => onUpdate(index, "product", event.target.value)} />
                                      <input className="asset-track-amount-cell" type="number" value={item.amount} aria-label={t("金额", "Amount")} onChange={(event) => onUpdate(index, "amount", event.target.value)} />
                                      <input type="date" value={item.transaction_date} aria-label={t("日期", "Date")} onChange={(event) => onUpdate(index, "transaction_date", event.target.value)} />
                                    </div>
                                  </td>
                                  {hasCategory && <td>
                                    {usesCategory && <select value={item.category_key ?? ""} onChange={(event) => onUpdate(index, "category_key", event.target.value)}>
                                      <option value="">{t("请选择分类", "Select category")}</option>
                                      {available.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
                                    </select>}
                                  </td>}
                                  <td className="asset-track-actions-cell asset-track-summary-actions-cell">
                                    <span className="asset-track-transaction-actions">
                                      {transactionTypeUsesRules(item.type) && renderRuleControls?.({
                                        row: item,
                                        index,
                                        transactionKey: stableKey
                                      })}
                                      {renderTransactionActions?.({
                                        row: item,
                                        index,
                                        transactionKey: stableKey
                                      })}
                                      <button
                                        type="button"
                                        onClick={() => onDelete(index)}
                                      >
                                        {t("删除", "Delete")}
                                      </button>
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function FixedAssetTable({
  rows,
  onUpdate,
  onDelete,
  onAdd,
  hideTitle = false
}: {
  rows: FixedAsset[];
  onUpdate: (index: number, field: keyof FixedAsset, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  hideTitle?: boolean;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const previousRowCount = useRef(rows.length);
  const pendingFocusKey = useRef<string | null>(null);
  const sorted = sortRows(rows, sort, (row, key) => row[key as keyof FixedAsset]);
  useEffect(() => {
    if (rows.length > previousRowCount.current) {
      const newIndex = rows.length - 1;
      pendingFocusKey.current = tableRowKey(rows[newIndex], newIndex);
      const tableScroll = tableScrollRef.current;
      if (tableScroll) tableScroll.scrollTop = tableScroll.scrollHeight;
    }
    previousRowCount.current = rows.length;
  }, [rows]);
  useEffect(() => {
    if (!pendingFocusKey.current) return;
    const target = Array.from(tableScrollRef.current?.querySelectorAll("[data-asset-track-row-key]") ?? [])
      .find((element) => element.getAttribute("data-asset-track-row-key") === pendingFocusKey.current);
    const input = target?.querySelector("input:not(:disabled), select:not(:disabled)") as HTMLInputElement | HTMLSelectElement | null;
    if (!input) return;
    input.focus();
    pendingFocusKey.current = null;
  }, [rows, sorted]);
  return (
    <Section title={hideTitle ? undefined : t(`固定资产（${rows.length} 项）`, `Fixed assets (${rows.length})`)}>
      <div ref={tableScrollRef} className="asset-track-table-scroll">
        <table className="asset-track-fixed-assets-table">
          <thead>
            <tr>
              {[
                ["asset_name", t("名称", "Name")],
                ["category", t("类别", "Category")],
                ["purchase_date", t("购置日", "Purchase date")],
                ["purchase_price", t("购买价", "Purchase price")],
                ["status", t("状态", "Status")],
                ["note", t("备注", "Notes")]
              ].map(([field, label]) => (
                <th key={field} scope="col" className={field === "purchase_date"
                  ? "asset-track-date-column"
                  : field === "purchase_price"
                    ? "asset-track-amount-column"
                    : field === "status"
                      ? "asset-track-status-column"
                      : undefined}>
                  <SortButton field={field} label={label} sort={sort} onSort={setSort} />
                </th>
              ))}
              <ActionTableHeader />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, originalIndex }) => (
              <tr data-asset-track-row-key={tableRowKey(row, originalIndex)} key={row.id ?? row.asset_key ?? row.client_id ?? originalIndex}>
                {(["asset_name", "category", "purchase_date", "purchase_price"] as const).map((field) => (
                  <td key={field} className={field === "purchase_date"
                    ? "asset-track-date-cell"
                    : field === "purchase_price"
                      ? "asset-track-amount-cell"
                      : undefined}>
                    <input
                      type={field === "purchase_price" ? "number" : field === "purchase_date" ? "date" : "text"}
                      value={String(row[field] ?? "")}
                      onChange={(event) => onUpdate(originalIndex, field, event.target.value)}
                    />
                  </td>
                ))}
                <td className="asset-track-status-cell">
                  <select value={row.status} onChange={(event) => onUpdate(originalIndex, "status", event.target.value)}>
                    {["在用", "闲置", "已出售", "已报废"].map((value) => <option key={value} value={value}>{businessLabel(value)}</option>)}
                  </select>
                </td>
                <td><input value={row.note} onChange={(event) => onUpdate(originalIndex, "note", event.target.value)} /></td>
                <td className="asset-track-actions-cell"><button onClick={() => onDelete(originalIndex)}>{t("删除", "Delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={onAdd}>{t("新增资产", "Add asset")}</button>
    </Section>
  );
}
