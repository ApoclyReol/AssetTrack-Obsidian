import type { HistoricalProductStat } from "../../types";
import { businessLabel, t } from "../../i18n";
import { ActionTableHeader, StaticTableHeader } from "../TablePrimitives";
import { EmptyState } from "../editorPrimitives";
import {
  categoryStatusLabel,
  categorySummary,
  healthLabels,
  HistorySortButton,
  ruleCoverageLabel,
  ruleStatusLabel,
  statusStack
} from "./ruleHistoryPrimitives";
import type { HistorySort } from "./ruleHistoryTypes";

export interface ProductHistoryTableProps {
  groups: HistoricalProductStat[];
  sort: HistorySort;
  onSort: (next: HistorySort) => void;
  onOpenDetail: (group: HistoricalProductStat) => void;
  onOpenProductRename?: (group: HistoricalProductStat) => void;
  onCreateRule?: (group: HistoricalProductStat) => void;
}

interface ProductGroupTableProps extends ProductHistoryTableProps {
  overview: boolean;
}

function ProductGroupTable({
  groups,
  overview,
  sort,
  onSort,
  onOpenDetail,
  onOpenProductRename,
  onCreateRule
}: ProductGroupTableProps) {
  return groups.length === 0
    ? <EmptyState text={overview
      ? t("暂无商品记录。", "No item records yet.")
      : t("暂无商品-分类冲突。", "No item-category conflicts.")} />
    : <div className="asset-track-table-scroll asset-track-history-group-scroll"><table className={`asset-track-history-group-table${overview ? " asset-track-history-group-table--overview" : " asset-track-history-group-table--health"}`}>
      <thead><tr>
        <th scope="col" className="asset-track-date-column"><HistorySortButton field="last_date" label={t("最近日期", "Latest date")} sort={sort} onSort={onSort} /></th>
        <th scope="col" className="asset-track-type-column"><HistorySortButton field="transaction_type" label={t("收支", "Type")} sort={sort} onSort={onSort} /></th>
        <th scope="col"><HistorySortButton field="product" label={t("商品", "Item")} sort={sort} onSort={onSort} /></th>
        <StaticTableHeader label={t("所属分类", "Category")} className="asset-track-centered-column" />
        <StaticTableHeader label={t("所属规则", "Rule")} className="asset-track-centered-column" />
        <StaticTableHeader label={t("健康状态", "Health")} className="asset-track-centered-column" />
        <th scope="col" className="asset-track-count-column"><HistorySortButton field="occurrences" label={t("流水数", "Transactions")} sort={sort} onSort={onSort} /></th>
        <ActionTableHeader />
      </tr></thead>
      <tbody>{groups.map((group) => {
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
            {onCreateRule && group.rule_status === "未创建" && <button type="button" onClick={() => onCreateRule(group)}>{t("创建规则", "Create rule")}</button>}
            <button type="button" onClick={() => onOpenDetail(group)}>{t("编辑分类", "Edit category")}</button>
          </td>
        </tr>;
      })}</tbody>
    </table></div>;
}

export function ProductHealthTable(props: ProductHistoryTableProps) {
  return <ProductGroupTable {...props} overview={false} />;
}

export function ProductOverviewTable(props: ProductHistoryTableProps) {
  return <ProductGroupTable {...props} overview />;
}
