import type {
  CategoryDefinition
} from "../../types/configuration";
import { businessLabel, t } from "../../i18n";
import { issueLabel } from "./ruleHistoryPrimitives";
import type { HistoryFilters } from "./ruleHistoryTypes";

export interface RuleHistoryFiltersProps {
  categories: CategoryDefinition[];
  groupBy?: "product" | "counterparty";
  onGroupBy?: (groupBy: "product" | "counterparty") => void;
  filters: HistoryFilters;
  overview: boolean;
  hideIssueFilter: boolean;
  loading: boolean;
  hasFilter: boolean;
  onUpdate: (next: Partial<HistoryFilters>) => void;
  onReset: () => void;
}

export function RuleHistoryFilters({
  categories,
  groupBy = "product",
  onGroupBy,
  filters,
  overview,
  hideIssueFilter,
  loading,
  hasFilter,
  onUpdate,
  onReset
}: RuleHistoryFiltersProps) {
  return <div className="asset-track-rule-history-filters">
    <div className="asset-track-rule-history-filter-heading">
      <div className="asset-track-rule-history-filter-heading-main">
        <strong>{overview
          ? t("筛选", "Filter")
          : t("默认显示商品-分类冲突", "Item-category conflicts are shown by default")}</strong>
        {overview && <div className="asset-track-overview-dimension-tabs" role="tablist" aria-label={t("统计口径", "Overview dimension")}>
          {(["product", "counterparty"] as const).map((value) => <button
            key={value}
            type="button"
            role="tab"
            aria-selected={groupBy === value}
            className={groupBy === value ? "is-active" : ""}
            onClick={() => onGroupBy?.(value)}
          >{value === "product" ? t("按商品", "By item") : t("按交易对手", "By counterparty")}</button>)}
        </div>}
      </div>
      {!overview && <span>{t("筛选条件变化后会自动刷新统计。", "Statistics refresh automatically when filters change.")}</span>}
    </div>
    <div className={`asset-track-filter-grid${overview ? " asset-track-filter-grid--overview" : ""}`}>
      <label className="asset-track-rule-history-filter-type">{t("收支", "Type")}
        <select value={filters.transaction_type} onChange={(event) => onUpdate({ transaction_type: event.target.value as HistoryFilters["transaction_type"] })}>
          <option value="">{t("全部", "All")}</option>
          <option value="支出">{businessLabel("支出")}</option>
          <option value="收入">{businessLabel("收入")}</option>
          <option value="代付">{businessLabel("代付")}</option>
        </select>
      </label>
      {!hideIssueFilter && !overview && <label>{t("问题类型", "Issue")}
        <select value={filters.issue_filter} onChange={(event) => onUpdate({ issue_filter: event.target.value as HistoryFilters["issue_filter"] })}>
          <option value="">{t("全部", "All")}</option>
          <optgroup label={t("分类问题", "Category issues")}>
            {(["conflict", "inactive", "uncategorized"] as const).map((filter) => <option key={filter} value={filter}>{issueLabel(filter)}</option>)}
          </optgroup>
          <optgroup label={t("规则问题", "Rule issues")}>
            {(["rule-conflict", "duplicate", "no-rule", "mismatch"] as const).map((filter) => <option key={filter} value={filter}>{issueLabel(filter)}</option>)}
          </optgroup>
        </select>
      </label>}
      <label className="asset-track-rule-history-filter-category">{t("分类", "Category")}
        <select value={filters.category_key} onChange={(event) => onUpdate({ category_key: event.target.value })}>
          <option value="">{t("全部", "All")}</option>
          {categories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
        </select>
      </label>
      <label className="asset-track-rule-history-filter-search">{t("商品搜索", "Item search")}
        <input placeholder={t("搜索商品名", "Search item name")} value={filters.product_search} onChange={(event) => onUpdate({ product_search: event.target.value })} />
      </label>
      {overview && <label className="asset-track-rule-history-filter-search">{t("交易对手搜索", "Counterparty search")}
        <input placeholder={t("搜索交易对手", "Search counterparty")} value={filters.counterparty_search ?? ""} onChange={(event) => onUpdate({ counterparty_search: event.target.value })} />
      </label>}
      <label className="asset-track-rule-history-filter-date">{t("起始日期", "From date")}
        <input type="date" value={filters.from_date} onChange={(event) => onUpdate({ from_date: event.target.value })} />
      </label>
      <label className="asset-track-rule-history-filter-date">{t("结束日期", "To date")}
        <input type="date" value={filters.to_date} onChange={(event) => onUpdate({ to_date: event.target.value })} />
      </label>
      <label className="asset-track-rule-history-filter-count">{t("最少次数", "Minimum occurrences")}
        <input type="number" min="1" value={filters.min_occurrences} onChange={(event) => onUpdate({ min_occurrences: event.target.value })} />
      </label>
    </div>
    <div className="asset-track-rule-history-filter-actions">
      <button type="button" disabled={loading} onClick={onReset}>{t("重置筛选", "Reset filters")}</button>
      {loading && <span role="status">{t("正在更新统计…", "Updating statistics…")}</span>}
      {!overview && !hasFilter && !loading && <span role="status">{t("请选择至少一个筛选条件。", "Choose at least one filter.")}</span>}
    </div>
  </div>;
}
