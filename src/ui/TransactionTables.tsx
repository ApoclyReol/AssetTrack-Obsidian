import { Fragment, useMemo, useState } from "react";
import type {
  CategoryDefinition,
  FixedAsset,
  Transaction
} from "../types";
import { businessLabel, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import {
  transactionBlockNumber,
  transactionBlockNumbers
} from "./analysisModel";
import {
  groupTransactions,
  type TransactionGroup
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
import { ActionTableHeader, StaticTableHeader } from "./TablePrimitives";

export function TransactionTable({
  title,
  rows,
  visibleIndexes,
  categories,
  onUpdate,
  onDelete,
  onAdd
}: {
  title: string;
  month: string;
  rows: Transaction[];
  visibleIndexes: number[];
  categories: CategoryDefinition[];
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  const displayTitle = businessLabel(title);
  const [sort, setSort] = useState<SortState>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 600
  });
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
    viewport.height
  );
  const visibleRows = sorted.slice(range.start, range.end);
  return (
    <Section title={t(
      `${title}（${visibleIndexes.length} 行）`,
      `${displayTitle} (${visibleIndexes.length} rows)`
    )}>
      <div
        className="asset-track-virtual-table"
        role="table"
        aria-rowcount={sorted.length + 1}
        onScroll={(event) => {
          setViewport({
            scrollTop: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight
          });
        }}
      >
        <div className="asset-track-grid asset-track-grid-head">
          <span className="asset-track-row-number-heading">
            <SortButton field="row_number" label={t("行号", "Row")} sort={sort} onSort={setSort} />
          </span>
          {[
            ["transaction_date", t("日期", "Date")],
            ["counterparty", t("交易对方", "Counterparty")],
            ["category", t("分类", "Category")],
            ["product", t("商品", "Item")],
            ["amount", t("金额", "Amount")]
          ].map(([field, label]) => (
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
            const special = ["代付", "加仓", "提现"].includes(row.type);
            const options = categories.filter(
              (category) =>
                category.transaction_type === row.type &&
                (category.is_active || category.category_key === row.category_key)
            );
            return (
              <div
                className="asset-track-grid"
                key={row.id ?? row.client_id ?? originalIndex}
                role="row"
                aria-rowindex={range.start + visibleIndex + 2}
              >
                <span className="asset-track-row-number">{blockNumber}</span>
                <input
                  aria-label={t(`${title}第 ${blockNumber} 行日期`, `${displayTitle} row ${blockNumber} date`)}
                  value={row.transaction_date}
                  onChange={(event) => onUpdate(originalIndex, "transaction_date", event.target.value)}
                />
                <input
                  aria-label={t(`${title}第 ${blockNumber} 行交易对方`, `${displayTitle} row ${blockNumber} counterparty`)}
                  value={row.counterparty ?? ""}
                  placeholder={t("交易对方", "Counterparty")}
                  onChange={(event) => onUpdate(originalIndex, "counterparty", event.target.value)}
                />
                <select
                  aria-label={t(`${title}第 ${blockNumber} 行分类`, `${displayTitle} row ${blockNumber} category`)}
                  disabled={special}
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
                <input
                  aria-label={t(`${title}第 ${blockNumber} 行商品`, `${displayTitle} row ${blockNumber} item`)}
                  value={row.product}
                  onChange={(event) => onUpdate(originalIndex, "product", event.target.value)}
                />
                <input
                  aria-label={t(`${title}第 ${blockNumber} 行金额`, `${displayTitle} row ${blockNumber} amount`)}
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.amount}
                  onChange={(event) => onUpdate(originalIndex, "amount", event.target.value)}
                />
                <button
                  aria-label={t(`删除${title}第 ${blockNumber} 行`, `Delete ${displayTitle} row ${blockNumber}`)}
                  onClick={() => onDelete(originalIndex)}
                >
                  {t("删除", "Delete")}
                </button>
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
  sort,
  onSort,
  expanded,
  onExpanded,
  onUpdate
}: {
  rows: Transaction[];
  categories: CategoryDefinition[];
  sort: SortState;
  onSort: (sort: SortState) => void;
  expanded: string;
  onExpanded: (key: string) => void;
  onUpdate: (index: number, field: keyof Transaction, value: string) => void;
}) {
  const groups = sortRows(groupTransactions(rows), sort, (group, key) =>
    group[key as keyof TransactionGroup]
  );
  return (
    <Section title={t("商品汇总", "Item summary")}>
      <div className="asset-track-table-scroll">
        <table className="asset-track-summary-table">
          <thead>
            <tr>
              <StaticTableHeader label={t("收支", "Type")} className="asset-track-type-column" />
              <th scope="col"><SortButton label={t("商品", "Item")} field="product" sort={sort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-count-column"><SortButton label={t("出现次数", "Occurrences")} field="count" sort={sort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-amount-column"><SortButton label={t("总金额", "Total amount")} field="amount" sort={sort} onSort={onSort} /></th>
              <th scope="col" className="asset-track-date-column"><SortButton label={t("最近日期", "Latest date")} field="lastDate" sort={sort} onSort={onSort} /></th>
              <StaticTableHeader label={t("分类", "Category")} />
              <ActionTableHeader />
            </tr>
          </thead>
          <tbody>
            {groups.map(({ row: group }) => (
              <Fragment key={group.key}>
                <tr>
                  <td className="asset-track-type-cell">{businessLabel(group.type)}</td>
                  <td title={group.variants.join("、")}>{group.product}</td>
                  <td className="asset-track-count-cell">{group.count}</td>
                  <td className="asset-track-amount-cell">{money(
                    group.amount,
                    group.type as "收入" | "支出" | "代付" | "加仓" | "提现"
                  )}</td>
                  <td className="asset-track-date-cell">
                    {group.firstDate === group.lastDate
                      ? group.lastDate
                      : `${group.firstDate} ～ ${group.lastDate}`}
                  </td>
                  <td>
                    {group.categories.length === 0
                      ? t("未分类", "Uncategorized")
                      : group.categories.length === 1
                        ? group.categories[0]
                        : t(
                            `${group.categories.length} 个分类（有冲突）`,
                            `${group.categories.length} categories (conflict)`
                          )}
                  </td>
                  <td className="asset-track-actions-cell">
                    <button onClick={() => onExpanded(expanded === group.key ? "" : group.key)}>
                      {expanded === group.key ? t("收起", "Collapse") : t("展开逐项", "Expand items")}
                    </button>
                  </td>
                </tr>
                {expanded === group.key && (
                  <tr key={`${group.key}:expanded`}>
                    <td colSpan={7}>
                      <div className="asset-track-summary-details">
                        {group.indexes.map((index) => {
                          const item = rows[index];
                          const available = categories.filter(
                            (category) => category.is_active && category.transaction_type === item.type
                          );
                          return (
                            <div key={item.id ?? item.client_id ?? index}>
                              <input type="date" value={item.transaction_date} onChange={(event) => onUpdate(index, "transaction_date", event.target.value)} />
                              <input value={item.counterparty ?? ""} placeholder={t("交易对方", "Counterparty")} onChange={(event) => onUpdate(index, "counterparty", event.target.value)} />
                              <input value={item.product} onChange={(event) => onUpdate(index, "product", event.target.value)} />
                              <input type="number" value={item.amount} onChange={(event) => onUpdate(index, "amount", event.target.value)} />
                              {["支出", "收入"].includes(item.type) ? (
                                <select value={item.category_key ?? ""} onChange={(event) => onUpdate(index, "category_key", event.target.value)}>
                                  <option value="">{t("请选择分类", "Select category")}</option>
                                  {available.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
                                </select>
                              ) : <span>{t("无需分类", "No category required")}</span>}
                            </div>
                          );
                        })}
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
  onAdd
}: {
  rows: FixedAsset[];
  onUpdate: (index: number, field: keyof FixedAsset, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const sorted = sortRows(rows, sort, (row, key) => row[key as keyof FixedAsset]);
  return (
    <Section title={t(`固定资产（${rows.length} 项）`, `Fixed assets (${rows.length})`)}>
      <div className="asset-track-table-scroll">
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
              <tr key={row.id ?? row.asset_key ?? row.client_id ?? originalIndex}>
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
