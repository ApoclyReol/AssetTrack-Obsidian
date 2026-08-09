import type {
  CategoryBackfillPreview,
  ProductHistoryTransaction
} from "../../types/history";
import type {
  CategoryDefinition
} from "../../types/configuration";
import type {
  HistoricalProductStat
} from "../../types/rules";
import { businessLabel, t } from "../../i18n";
import { money } from "../../domain/moneyFormat";
import { StaticTableHeader } from "../TablePrimitives";
import {
  categorySummary,
  HistorySortButton,
  historyGroupKey
} from "./ruleHistoryPrimitives";
import type { HistorySort } from "./ruleHistoryTypes";

export interface CategoryHistoryMigrationPanelProps {
  groups: HistoricalProductStat[];
  sourceCategoryName: string;
  sort: HistorySort;
  targetCategoryKey: string;
  targetCategories: CategoryDefinition[];
  selectedIds: Set<number>;
  loading: boolean;
  preview: CategoryBackfillPreview | null;
  allCategoryGroupsSelected: boolean;
  categoryGroupSelected: (group: HistoricalProductStat) => boolean;
  onSort: (next: HistorySort) => void;
  onToggleAll: () => void;
  onToggleGroup: (group: HistoricalProductStat) => void;
  onTargetCategoryChange: (categoryKey: string) => void;
  onPreview: () => void;
  onApply: () => void;
  onClose?: () => void;
}

export function CategoryHistoryMigrationPanel({
  groups,
  sourceCategoryName,
  sort,
  targetCategoryKey,
  targetCategories,
  selectedIds,
  loading,
  preview,
  allCategoryGroupsSelected,
  categoryGroupSelected,
  onSort,
  onToggleAll,
  onToggleGroup,
  onTargetCategoryChange,
  onPreview,
  onApply,
  onClose
}: CategoryHistoryMigrationPanelProps) {
  const selectedGroupCount = groups.filter((group) => categoryGroupSelected(group)).length;

  return <div className="asset-track-rule-history-category-migration">
    <div className="asset-track-rule-history-detail-header">
      <div>
        <h3>{t(`分类“${sourceCategoryName}”的历史商品`, `Historical items in “${sourceCategoryName}”`)}</h3>
        <p>{t("直接选择需要迁移的商品，再指定统一的目标分类。不会按多数分类自动迁移。", "Select the items to migrate and choose one target category. No majority-based migration is automatic.")}</p>
      </div>
      {onClose && <button type="button" onClick={onClose}>{t("关闭", "Close")}</button>}
    </div>
    <div className="asset-track-rule-history-category-actions">
      <button type="button" disabled={loading || !groups.length} onClick={onToggleAll}>
        {allCategoryGroupsSelected ? t("取消全选商品", "Deselect all items") : t("全选商品", "Select all items")}
      </button>
      <span className="asset-track-selected-count" role="status">
        {t(`已选择 ${selectedGroupCount} 个商品`, `${selectedGroupCount} items selected`)}
      </span>
    </div>
    <div className="asset-track-table-scroll asset-track-history-category-scroll">
      {groups.length === 0 ? <p className="asset-track-rule-history-empty">{t("该分类没有可迁移的历史商品。", "This category has no historical items to migrate.")}</p> : <table className="asset-track-history-category-table"><thead><tr>
        <StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" />
        <th scope="col" className="asset-track-date-column"><HistorySortButton field="last_date" label={t("最近日期", "Latest date")} sort={sort} onSort={onSort} /></th>
        <th scope="col"><HistorySortButton field="product" label={t("商品", "Item")} sort={sort} onSort={onSort} /></th>
        <StaticTableHeader label={t("交易对方", "Counterparties")} />
        <th scope="col" className="asset-track-count-column"><HistorySortButton field="occurrences" label={t("次数", "Occurrences")} sort={sort} onSort={onSort} /></th>
        <th scope="col" className="asset-track-count-column"><HistorySortButton field="months_count" label={t("月份数", "Months")} sort={sort} onSort={onSort} /></th>
        <th scope="col" className="asset-track-amount-column"><HistorySortButton field="total_amount" label={t("总金额", "Total amount")} sort={sort} onSort={onSort} /></th>
      </tr></thead><tbody>{groups.map((group) => <tr key={historyGroupKey(group.transaction_type, group.product_key)}>
        <td><input
          className="asset-track-selection-checkbox"
          type="checkbox"
          disabled={loading}
          checked={categoryGroupSelected(group)}
          onChange={() => onToggleGroup(group)}
          aria-label={t(`选择商品 ${group.product || "空商品"}`, `Select item ${group.product || "empty item"}`)}
        /></td>
        <td className="asset-track-date-cell">{group.last_date || "—"}</td>
        <td title={group.variants.join("、")}>{group.product || t("（空商品）", "(empty item)")}</td>
        <td>{group.counterparties.join("、") || t("（空）", "(empty)")}</td>
        <td className="asset-track-count-cell">{group.occurrences}</td><td className="asset-track-count-cell">{group.months_count}</td><td className="asset-track-amount-cell">{money(group.total_amount, group.transaction_type)}</td>
      </tr>)}</tbody></table>}
    </div>
    <div className="asset-track-backfill-actions asset-track-rule-history-target">
      <label>{t("选中商品的目标分类", "Target category for selected items")}
        <select value={targetCategoryKey} disabled={loading} onChange={(event) => onTargetCategoryChange(event.target.value)}>
          <option value="">{t("请选择", "Select")}</option>
          {targetCategories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
        </select>
      </label>
      <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedIds.size} 条流水`, `${selectedIds.size} transactions selected`)}</span>
      <button type="button" className="mod-cta" disabled={loading} onClick={onPreview}>{t("生成迁移预览", "Preview migration")}</button>
    </div>
    {preview && <div className="asset-track-backfill-preview" role="status">
      <strong>{t("迁移预览", "Migration preview")}</strong>
      <p>{t(`将 ${preview.transaction_count} 条流水迁移到“${preview.target_category}”，涉及 ${preview.month_count} 个月份。`, `Move ${preview.transaction_count} transactions to “${preview.target_category}” across ${preview.month_count} months.`)}</p>
      <p>{t("原分类：", "Old categories: ")}{categorySummary(preview.old_categories)}</p>
      <p>{preview.months.map((month) => `${month.month} revision ${month.revision} (${month.count})`).join(" · ")}</p>
      <button type="button" className="mod-cta" disabled={loading} onClick={onApply}>{t("确认写入", "Apply changes")}</button>
    </div>}
  </div>;
}

export interface ProductHistoryDetailPanelProps {
  selectedGroup: HistoricalProductStat;
  detailRows: ProductHistoryTransaction[];
  detailOnly: boolean;
  selectedIds: Set<number>;
  allVisibleSelected: boolean;
  targetCategoryKey: string;
  targetCategories: CategoryDefinition[];
  preview: CategoryBackfillPreview | null;
  loading: boolean;
  onClose: () => void;
  onBack: () => void;
  onToggleAllVisible: () => void;
  onToggleSelected: (id: number) => void;
  onTargetCategoryChange: (categoryKey: string) => void;
  onPreview: () => void;
  onApply: () => void;
}

export function ProductHistoryDetailPanel({
  selectedGroup,
  detailRows,
  detailOnly,
  selectedIds,
  allVisibleSelected,
  targetCategoryKey,
  targetCategories,
  preview,
  loading,
  onClose,
  onBack,
  onToggleAllVisible,
  onToggleSelected,
  onTargetCategoryChange,
  onPreview,
  onApply
}: ProductHistoryDetailPanelProps) {
  const isCounterpartyGroup = selectedGroup.group_by === "counterparty";
  const groupLabel = isCounterpartyGroup
    ? t("交易对手", "Counterparty")
    : t("商品", "Item");
  return <div className="asset-track-rule-history-detail">
    <div className="asset-track-rule-history-detail-header">
      <div>
        <h3>{selectedGroup.product || (isCounterpartyGroup ? t("（空交易对手）", "(empty counterparty)") : t("（空商品）", "(empty item)"))} · {businessLabel(selectedGroup.transaction_type)}</h3>
        <p>{selectedGroup.rule_status === "冲突"
          ? t("当前规则存在冲突，请先处理规则后再修改历史分类。", "These rules conflict. Resolve them before editing historical categories.")
          : t("请选择需要修改分类的流水，再指定目标分类。", "Select transactions whose category should change, then choose the target category.")}</p>
      </div>
      <button type="button" onClick={detailOnly ? onClose : onBack}>{detailOnly ? t("关闭", "Close") : t(`返回${groupLabel}列表`, `Back to ${groupLabel.toLocaleLowerCase()} list`)}</button>
    </div>
    <div className="asset-track-rule-history-selection-actions">
      <button type="button" disabled={loading || !detailRows.length} onClick={onToggleAllVisible}>
        {allVisibleSelected ? t("取消全选流水", "Deselect all transactions") : t("全选流水", "Select all transactions")}
      </button>
      <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedIds.size} 条`, `${selectedIds.size} selected`)}</span>
    </div>
    <div className="asset-track-table-scroll asset-track-history-detail-scroll">
      <table className="asset-track-history-detail-table"><thead><tr>
        <StaticTableHeader label={t("日期", "Date")} className="asset-track-date-column" /><StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" /><StaticTableHeader label={t("交易对手", "Counterparty")} /><StaticTableHeader label={t("商品", "Item")} /><StaticTableHeader label={t("原分类", "Original category")} /><StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" /><StaticTableHeader label={t("规则解释", "Rule explanation")} />
      </tr></thead><tbody>{detailRows.map((row) => <tr key={row.id}>
        <td className="asset-track-date-cell">{row.transaction_date}</td>
        <td><input type="checkbox" disabled={loading} checked={selectedIds.has(row.id)} onChange={() => onToggleSelected(row.id)} aria-label={t(`选择 ${row.transaction_date} ${row.counterparty || "流水"}`, `Select ${row.transaction_date} ${row.counterparty || "transaction"}`)} /></td>
        <td>{row.counterparty || t("（空）", "(empty)")}</td><td>{row.product || t("（空商品）", "(empty item)")}</td><td>{row.category || t("未分类", "Uncategorized")}</td><td className="asset-track-amount-cell">{money(row.amount, row.type)}</td>
        <td>{row.rule_match.status === "conflict"
          ? `${t("规则冲突", "Rule conflict")}（${row.rule_match.rule_ids.length}）`
          : row.rule_match.status === "matched"
            ? t("已命中规则", "Rule matched")
            : t("未命中规则", "No matching rule")}</td>
      </tr>)}</tbody></table>
    </div>
    <div className="asset-track-backfill-actions asset-track-rule-history-target">
      <label>{t("目标分类", "Target category")}
        <select value={targetCategoryKey} disabled={loading} onChange={(event) => onTargetCategoryChange(event.target.value)}>
          <option value="">{t("请选择", "Select")}</option>
          {targetCategories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
        </select>
      </label>
      <button type="button" className="mod-cta" disabled={loading || selectedGroup.rule_status === "冲突"} onClick={onPreview}>{t("修改分类", "Edit category")}</button>
      {preview && <button type="button" className="mod-warning" disabled={loading} onClick={onApply}>{t(`确认修改 ${preview.transaction_count} 条`, `Confirm ${preview.transaction_count} edits`)}</button>}
    </div>
  </div>;
}
