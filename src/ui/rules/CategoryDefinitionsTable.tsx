import { useEffect, useRef } from "react";
import type {
  CategoryDefinition
} from "../../types/configuration";
import type {
  ProductHistoryQuery
} from "../../types/history";
import type { ReadWindow } from "../../types/readWindows";
import { CATEGORY_COLORS } from "../../domain/categoryColors";
import { businessLabel, t } from "../../i18n";
import { ActionTableHeader } from "../TablePrimitives";
import {
  clone,
  EmptyState,
  Section,
  SortButton,
  sortRows,
  type OperationState,
  type SortState
} from "../editorPrimitives";
import { focusNewTableRow } from "./rulesTablePrimitives";

const CATEGORY_RAINBOW = CATEGORY_COLORS;

export interface CategoryDefinitionsTableProps {
  categories: CategoryDefinition[];
  sort: SortState;
  onSort: (next: SortState) => void;
  onChange: (categories: CategoryDefinition[]) => void;
  onRemove: (category: CategoryDefinition, index: number) => void | Promise<void>;
  onOpenHistory: (query: ProductHistoryQuery) => void;
  showSectionActions: boolean;
  dirty: boolean;
  saveBlocked: boolean;
  pageState: OperationState;
  saveState: OperationState;
  onReload: () => Promise<void>;
  onSave: () => Promise<void>;
  readWindow?: ReadWindow | null;
}

export function CategoryDefinitionsTable({
  categories,
  sort,
  onSort,
  onChange,
  onRemove,
  onOpenHistory,
  showSectionActions,
  dirty,
  saveBlocked,
  pageState,
  saveState,
  onReload,
  onSave,
  readWindow
}: CategoryDefinitionsTableProps) {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingCategoryKey = useRef<string | null>(null);

  useEffect(() => {
    if (focusNewTableRow(tableScrollRef.current, pendingCategoryKey.current)) {
      pendingCategoryKey.current = null;
    }
  }, [categories.length, sort]);

  const updateCategory = (index: number, update: (category: CategoryDefinition) => void) => {
    const next = clone(categories);
    update(next[index]);
    onChange(next);
  };

  const categoryView = sortRows(categories, sort, (row, key) => row[key as keyof CategoryDefinition]);

  return <Section>
    {categoryView.length === 0 ? <EmptyState text={t("尚无分类定义。", "No category definitions yet.")} /> : <div ref={tableScrollRef} className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
      <table className="asset-track-category-table"><thead><tr>{[
        ["name", t("名称", "Name")], ["description", t("定义说明", "Description")], ["transaction_type", t("收支", "Type")], ["necessity", t("必要性", "Necessity")], ["pattern", t("消费频率", "Frequency")], ["is_big_ticket", t("大额", "Large")], ["color", t("颜色", "Color")], ["transaction_count", t("流水数", "Transactions")]
      ].map(([field, label]) => <th key={field} scope="col" className={field === "is_big_ticket" ? "asset-track-checkbox-heading" : field === "color" ? "asset-track-color-column" : ["transaction_type", "necessity", "pattern"].includes(field) ? "asset-track-type-column" : field === "transaction_count" ? "asset-track-count-column" : undefined}><SortButton field={field} label={label} sort={sort} onSort={onSort} /></th>)}<ActionTableHeader /></tr></thead>
        <tbody>{categoryView.map(({ row, originalIndex: index }) => <tr data-asset-track-row-key={row.category_key} key={row.category_key}>
          <td><input value={row.name} onChange={(event) => updateCategory(index, (category) => { category.name = event.target.value; })} /></td>
          <td><input value={row.description ?? ""} onChange={(event) => updateCategory(index, (category) => { category.description = event.target.value; })} /></td>
          <td className="asset-track-type-cell"><select value={row.transaction_type} onChange={(event) => updateCategory(index, (category) => { category.transaction_type = event.target.value as "支出" | "收入"; })}><option value="支出">{businessLabel("支出")}</option><option value="收入">{businessLabel("收入")}</option></select></td>
          <td className="asset-track-type-cell"><select value={row.necessity} onChange={(event) => updateCategory(index, (category) => { category.necessity = event.target.value as CategoryDefinition["necessity"]; })}>{["必要", "可控", "不适用"].map((value) => <option key={value} value={value}>{businessLabel(value)}</option>)}</select></td>
          <td className="asset-track-type-cell"><select value={row.pattern} onChange={(event) => updateCategory(index, (category) => { category.pattern = event.target.value as CategoryDefinition["pattern"]; })}>{["周期", "日常", "偶尔", "不适用"].map((value) => <option key={value} value={value}>{businessLabel(value)}</option>)}</select></td>
          <td className="asset-track-checkbox-cell"><input type="checkbox" checked={row.is_big_ticket} onChange={(event) => updateCategory(index, (category) => { category.is_big_ticket = event.target.checked; })} /></td>
          <td className="asset-track-color-cell"><input type="color" value={row.color} onChange={(event) => updateCategory(index, (category) => { category.color = event.target.value; })} /></td>
          <td className="asset-track-count-cell">{row.transaction_count ?? 0}</td>
          <td className="asset-track-category-actions asset-track-actions-cell">{row.transaction_count ? <button type="button" onClick={() => onOpenHistory({ category_key: row.category_key })}>{t("迁移", "Migrate")}</button> : null}<button type="button" onClick={() => void onRemove(row, index)}>{t("删除", "Delete")}</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="asset-track-section-actions">
      <button type="button" onClick={() => {
        const categoryKey = `cat-user-${crypto.randomUUID()}`;
        pendingCategoryKey.current = categoryKey;
        onChange([...categories, { category_key: categoryKey, name: "", description: "", transaction_type: "支出", necessity: "必要", pattern: "日常", is_big_ticket: false, color: CATEGORY_RAINBOW[categories.length % CATEGORY_RAINBOW.length], is_active: true, sort_order: categories.length }]);
      }}>{t("新增分类", "Add category")}</button>
      {showSectionActions && <>
        <button type="button" disabled={pageState.kind === "pending"} onClick={() => void onReload()}>
          {t("放弃并重载", "Discard and reload")}
        </button>
        <button type="button" className="mod-cta" disabled={saveBlocked || !dirty || saveState.kind === "pending"} onClick={() => void onSave()}>
          {t("保存分类", "Save categories")}
        </button>
        {readWindow && <span className="asset-track-section-scope-note" role="note">
          {t(`统计范围：近 5 年（${readWindow.from_date} 至 ${readWindow.to_date}）`, `Statistics range: last 5 years (${readWindow.from_date} to ${readWindow.to_date})`)}
        </span>}
      </>}
    </div>
  </Section>;
}
