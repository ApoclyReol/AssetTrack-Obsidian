import type {
  HistoricalProductStat,
  ProductHistoryIssueFilter,
  ProductHistoryQuery
} from "../../types";
import { AssetTrackError } from "../../services/AssetTrackService";
import { displayError, t } from "../../i18n";
import { scalarText } from "../../domain/text";
import type { HistoryFilters, HistorySort } from "./ruleHistoryTypes";

export function queryFromFilters(filters: HistoryFilters): ProductHistoryQuery {
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

export function historyGroupKey(transactionType: string, productKey: string): string {
  return `${transactionType}\u0000${productKey}`;
}

export function initialFilters(
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

export function categorySummary(
  counts: HistoricalProductStat["category_counts"]
): string {
  return counts.map((count) =>
    `${count.category || t("未分类", "Uncategorized")} (${count.occurrences})`
  ).join("\n") || t("无历史分类", "No historical category");
}

export function categoryStatusLabel(value: HistoricalProductStat["category_status"]): string {
  return {
    正常: t("正常", "Normal"),
    停用: t("停用", "Inactive"),
    未分类: t("未分类", "Uncategorized"),
    混合: t("混合", "Mixed")
  }[value];
}

export function statusStack(primary: string, secondary: string) {
  return <div className="asset-track-history-status-stack">
    <span>{primary}</span>
    <small>{secondary}</small>
  </div>;
}

export function healthLabels(group: HistoricalProductStat): string[] {
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

export function ruleStatusLabel(value: HistoricalProductStat["rule_status"]): string {
  return {
    正常: t("正常", "Normal"),
    重复: t("重复", "Duplicate"),
    冲突: t("冲突", "Conflict"),
    未创建: t("未创建", "Not created"),
    已覆盖: t("已覆盖", "Covered")
  }[value];
}

export function ruleCoverageLabel(value: HistoricalProductStat["rule_coverage"]): string {
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

export function sortGroups(
  groups: HistoricalProductStat[],
  sort: HistorySort
): HistoricalProductStat[] {
  return [...groups].sort((left, right) => {
    const compared = compareValues(left[sort.key as keyof HistoricalProductStat], right[sort.key as keyof HistoricalProductStat]);
    return sort.direction === "asc" ? compared : -compared;
  });
}

export function issueLabel(filter: ProductHistoryIssueFilter): string {
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

export function errorMessage(error: unknown): string {
  if (error instanceof AssetTrackError && error.code === "revision_conflict") {
    return t("数据已被其他窗口修改，请重新加载。", "The data changed in another window. Reload and try again.");
  }
  return displayError(error);
}

export function HistorySortButton({
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
