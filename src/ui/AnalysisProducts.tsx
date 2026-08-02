import { useEffect, useMemo, useState } from "react";
import type { HistoricalProductStat, ProductHistoryIndexResult } from "../types";
import type { AssetTrackService } from "../services/AssetTrackService";
import { businessLabel, displayError, getLocale, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { Empty, type LoadState } from "./AnalysisPrimitives";

type ProductOverviewSortKey =
  | "product"
  | "transaction_type"
  | "category"
  | "counterparty_count"
  | "occurrences"
  | "months_count"
  | "total_amount"
  | "average_amount"
  | "last_date";

type ProductOverviewSort = {
  key: ProductOverviewSortKey;
  direction: "asc" | "desc";
};

function productCategoryStatusLabel(
  value: HistoricalProductStat["category_status"]
): string {
  return {
    正常: t("正常", "Normal"),
    停用: t("停用", "Inactive"),
    未分类: t("未分类", "Uncategorized"),
    混合: t("混合", "Mixed")
  }[value];
}
function productCategorySummary(group: HistoricalProductStat): string {
  return group.category_counts.map((category) =>
    `${category.category || t("未分类", "Uncategorized")} (${category.occurrences})`
  ).join("、") || t("无历史分类", "No historical category");
}

function productOverviewSortValue(
  group: HistoricalProductStat,
  key: ProductOverviewSortKey
): string | number {
  switch (key) {
    case "category": return productCategorySummary(group);
    case "product": return group.product || t("（空商品）", "(empty item)");
    case "transaction_type": return group.transaction_type;
    case "counterparty_count": return group.counterparty_count;
    case "occurrences": return group.occurrences;
    case "months_count": return group.months_count;
    case "total_amount": return group.total_amount;
    case "average_amount": return group.average_amount;
    case "last_date": return group.last_date;
  }
}

function ProductOverviewSortButton({
  field,
  label,
  sort,
  onSort
}: {
  field: ProductOverviewSortKey;
  label: string;
  sort: ProductOverviewSort;
  onSort: (next: ProductOverviewSort) => void;
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

export function ProductOverviewAnalysis({
  api,
  dataVersion
}: {
  api: AssetTrackService;
  dataVersion: number;
}) {
  const [state, setState] = useState<LoadState<ProductHistoryIndexResult>>({ kind: "loading" });
  const [transactionType, setTransactionType] = useState<"" | "支出" | "收入">("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProductOverviewSort>({
    key: "total_amount",
    direction: "desc"
  });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void api.productOverview()
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((error) => active && setState({
        kind: "error",
        message: displayError(error)
      }));
    return () => { active = false; };
  }, [api, dataVersion]);

  const groups = state.kind === "ready" ? state.data.groups : [];
  const visibleGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(getLocale());
    return groups.filter((group) => {
      if (transactionType && group.transaction_type !== transactionType) return false;
      if (!normalizedSearch) return true;
      return [group.product, group.counterparty, ...group.variants]
        .join(" ")
        .toLocaleLowerCase(getLocale())
        .includes(normalizedSearch);
    });
  }, [groups, search, transactionType]);
  const sortedGroups = useMemo(() => [...visibleGroups].sort((left, right) => {
    const leftValue = productOverviewSortValue(left, sort.key);
    const rightValue = productOverviewSortValue(right, sort.key);
    const compared = typeof leftValue === "number" || typeof rightValue === "number"
      ? Number(leftValue) - Number(rightValue)
      : String(leftValue).localeCompare(String(rightValue), getLocale(), {
          numeric: true,
          sensitivity: "base"
        });
    return sort.direction === "asc" ? compared : -compared;
  }), [sort, visibleGroups]);

  if (state.kind === "loading") return <Empty text={t("正在加载商品总览…", "Loading item overview…")} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div>
          <h2>{t("商品总览", "Item overview")}</h2>
          <span>{t("集中查看历史商品的分类、流水和金额统计", "Review historical item categories, transactions, and amounts in one place")}</span>
        </div>
      </div>
      <div className="asset-track-analysis-toolbar">
        <label className="asset-track-analysis-filter">
          <span>{t("收支", "Type")}</span>
          <select value={transactionType} onChange={(event) => setTransactionType(event.target.value as "" | "支出" | "收入")}>
            <option value="">{t("全部", "All")}</option>
            <option value="支出">{businessLabel("支出")}</option>
            <option value="收入">{businessLabel("收入")}</option>
          </select>
        </label>
        <label className="asset-track-analysis-filter asset-track-analysis-search">
          <span>{t("商品搜索", "Item search")}</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <span className="asset-track-analysis-filter-status" role="status">
          {t(`显示 ${visibleGroups.length} / ${groups.length} 个商品`, `${visibleGroups.length} of ${groups.length} items`)}
        </span>
      </div>
      {sortedGroups.length === 0 ? <Empty text={groups.length ? t("没有符合当前筛选条件的商品。", "No items match the current filters.") : t("暂无历史商品。", "No historical items are available.")} /> : (
        <div className="asset-track-table-scroll asset-track-analysis-product-overview-scroll">
          <table className="asset-track-analysis-product-overview-table">
            <thead><tr>
              <th scope="col"><ProductOverviewSortButton field="product" label={t("商品", "Item")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-type-column"><ProductOverviewSortButton field="transaction_type" label={t("收支", "Type")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-centered-column"><ProductOverviewSortButton field="category" label={t("所属分类", "Category")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-count-column"><ProductOverviewSortButton field="counterparty_count" label={t("交易对方数", "Counterparties")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-count-column"><ProductOverviewSortButton field="occurrences" label={t("流水数", "Transactions")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-count-column"><ProductOverviewSortButton field="months_count" label={t("月份数", "Months")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-amount-column"><ProductOverviewSortButton field="total_amount" label={t("总金额", "Total amount")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-amount-column"><ProductOverviewSortButton field="average_amount" label={t("平均单次", "Average")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-date-column"><ProductOverviewSortButton field="last_date" label={t("最近日期", "Latest date")} sort={sort} onSort={setSort} /></th>
            </tr></thead>
            <tbody>{sortedGroups.map((group) => {
              const category = productCategorySummary(group);
              return <tr key={`${group.transaction_type}\u0000${group.product_key}`}>
                <td title={group.variants.join("、")}>{group.product || t("（空商品）", "(empty item)")}</td>
                <td className="asset-track-type-cell">{businessLabel(group.transaction_type)}</td>
                <td className="asset-track-centered-cell"><div className="asset-track-history-status-stack"><span>{category}</span><small>{productCategoryStatusLabel(group.category_status)}</small></div></td>
                <td className="asset-track-count-cell">{group.counterparty_count}</td>
                <td className="asset-track-count-cell">{group.occurrences}</td>
                <td className="asset-track-count-cell">{group.months_count}</td>
                <td className="asset-track-amount-cell">{money(group.total_amount, group.transaction_type)}</td>
                <td className="asset-track-amount-cell">{money(group.average_amount, group.transaction_type)}</td>
                <td className="asset-track-date-cell">{group.last_date || "—"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
