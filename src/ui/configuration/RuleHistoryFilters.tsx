import type { CategoryDefinition } from "../../types";
import { businessLabel, t } from "../../i18n";
import { issueLabel } from "./ruleHistoryPrimitives";
import type { HistoryFilters } from "./ruleHistoryTypes";

export interface RuleHistoryFiltersProps {
  categories: CategoryDefinition[];
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
      <strong>{overview
        ? t("筛选商品总览", "Filter item overview")
        : t("默认显示商品-分类冲突", "Item-category conflicts are shown by default")}</strong>
      <span>{overview
        ? t("可按收支、分类、商品和时间筛选。", "Filter by type, category, item, and time.")
        : t("筛选条件变化后会自动刷新统计。", "Statistics refresh automatically when filters change.")}</span>
    </div>
    <div className={`asset-track-filter-grid${overview ? " asset-track-filter-grid--overview" : ""}`}>
      <label className="asset-track-rule-history-filter-type">{t("收支", "Type")}
        <select value={filters.transaction_type} onChange={(event) => onUpdate({ transaction_type: event.target.value as HistoryFilters["transaction_type"] })}>
          <option value="">{t("全部", "All")}</option>
          <option value="支出">{businessLabel("支出")}</option>
          <option value="收入">{businessLabel("收入")}</option>
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
      <label className="asset-track-rule-history-filter-year">{t("起始年份", "From year")}
        <input type="number" min="2000" max="2100" placeholder={t("例如 2026", "e.g. 2026")} value={filters.from_month.slice(0, 4)} onChange={(event) => onUpdate({ from_month: event.target.value ? `${event.target.value}-01` : "" })} />
      </label>
      <label className="asset-track-rule-history-filter-year">{t("结束年份", "To year")}
        <input type="number" min="2000" max="2100" placeholder={t("例如 2026", "e.g. 2026")} value={filters.to_month.slice(0, 4)} onChange={(event) => onUpdate({ to_month: event.target.value ? `${event.target.value}-12` : "" })} />
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
