import { CategoryMigrationModal } from "../CategoryMigrationModal";
import { CategoryRemovalModal } from "../CategoryRemovalModal";
import { Menu, Notice, type App } from "obsidian";
import type { ConfigurationEditorPort } from "../../services/ports";
import type {
  AttributeGroup,
  AttributeOption,
  CategoryDefinition
} from "../../types/configuration";
import { CATEGORY_COLORS } from "../../domain/categoryColors";
import { businessLabel, t } from "../../i18n";
import { ActionTableHeader, StaticTableHeader } from "../TablePrimitives";
import {
  clone,
  EmptyState,
  Section,
  SortButton,
  sortRows,
  type OperationState,
  type SortState
} from "../editorPrimitives";
import { CategoryEditorModal } from "../CategoryEditorModal";

const CATEGORY_RAINBOW = CATEGORY_COLORS;

export interface CategoryDefinitionsTableProps {
  app: App;
  api: ConfigurationEditorPort;
  categories: CategoryDefinition[];
  attributeGroups?: AttributeGroup[];
  attributeOptions?: AttributeOption[];
  sort: SortState;
  onSort: (next: SortState) => void;
  onChange: (categories: CategoryDefinition[]) => void;
  onRemove: (category: CategoryDefinition, index: number) => void | Promise<void>;
  onSavedHistory: () => void;
  onDataChanged: () => void;
  onOpenRules: () => void;
  showSectionActions: boolean;
  dirty: boolean;
  historyBlocked?: boolean;
  saveBlocked: boolean;
  pageState: OperationState;
  saveState: OperationState;
  onReload: () => Promise<void>;
  onSave: () => Promise<void>;
}

export function CategoryDefinitionsTable({
  app,
  api,
  categories,
  attributeGroups = [],
  attributeOptions = [],
  sort,
  onSort,
  onChange,
  onRemove,
  onSavedHistory,
  onDataChanged,
  onOpenRules,
  showSectionActions,
  dirty,
  historyBlocked = false,
  saveBlocked,
  pageState,
  saveState,
  onReload,
  onSave
}: CategoryDefinitionsTableProps) {
  const updateCategory = (index: number, update: (category: CategoryDefinition) => void) => {
    const next = clone(categories);
    update(next[index]);
    onChange(next);
  };

  const openHistory = (category: CategoryDefinition, remove: boolean) => {
    if (dirty || historyBlocked || editingBusy) {
      new Notice(t("请先保存或放弃当前分类修改。", "Save or discard category changes first.")); return;
    }
    const options = { app, api, category, categories, onSaved: onSavedHistory, onDataChanged };
    if (remove) new CategoryRemovalModal(options).open(); else new CategoryMigrationModal(options).open();
  };
  const editingBusy = saveBlocked || saveState.kind === "pending";
  const categoryView = sortRows(categories, sort, (row, key) => row[key as keyof CategoryDefinition]);

  return <Section>
    {categoryView.length === 0 ? <EmptyState text={t("尚无分类定义。", "No category definitions yet.")} /> : <div className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
      <table className="asset-track-category-table"><thead><tr>{[
        ["name", t("名称", "Name")], ["description", t("定义说明", "Description")], ["transaction_type", t("收支", "Type")], ["color", t("颜色", "Color")]
      ].map(([field, label]) => <th key={field} scope="col" className={field === "color" ? "asset-track-color-column" : field === "transaction_type" ? "asset-track-type-column" : undefined}><SortButton field={field} label={label} sort={sort} onSort={onSort} /></th>)}<StaticTableHeader label={t("属性", "Attributes")} /><ActionTableHeader /></tr></thead>
        <tbody>{categoryView.map(({ row, originalIndex: index }) => {
          const rowName = typeof row.name === "string" ? row.name : "";
          const rowLabel = rowName.trim()
            || t(`第 ${index + 1} 行分类`, `Category row ${index + 1}`);
          const editingDisabled = saveBlocked || saveState.kind === "pending";
          return <tr data-asset-track-row-key={row.category_key} key={row.category_key}>
          <td><input
            className="asset-track-category-inline-input"
            type="text"
            value={row.name}
            placeholder={t("分类名称", "Category name")}
            aria-label={t(`${rowLabel}名称`, `${rowLabel} name`)}
            disabled={editingDisabled}
            onChange={(event) => updateCategory(index, (category) => { category.name = event.target.value; })}
          /></td>
          <td><input
            className="asset-track-category-inline-input"
            type="text"
            value={row.description ?? ""}
            placeholder={t("定义说明", "Description")}
            aria-label={t(`${rowLabel}定义说明`, `${rowLabel} description`)}
            disabled={editingDisabled}
            onChange={(event) => updateCategory(index, (category) => { category.description = event.target.value; })}
          /></td>
          <td className="asset-track-type-cell"><select
            value={row.transaction_type}
            aria-label={t(`${rowLabel}收支`, `${rowLabel} type`)}
            disabled={editingDisabled}
            onChange={(event) => updateCategory(index, (category) => { category.transaction_type = event.target.value as CategoryDefinition["transaction_type"]; })}
          >
            <option value="支出">{businessLabel("支出")}</option>
            <option value="收入">{businessLabel("收入")}</option>
          </select></td>
          <td className="asset-track-color-cell"><input
            className="asset-track-category-color-input"
            type="color"
            value={row.color || CATEGORY_RAINBOW[0]}
            aria-label={t(`${rowLabel}颜色`, `${rowLabel} color`)}
            disabled={editingDisabled}
            onChange={(event) => updateCategory(index, (category) => { category.color = event.target.value; })}
          /></td>
          <td><div className="asset-track-taxonomy-chips">{(row.attribute_keys ?? []).map((key) => {
            const option = attributeOptions.find((item) => item.attribute_key === key);
            const groupName = attributeGroups.find((group) => group.group_key === option?.group_key)?.name;
            const optionName = typeof option?.name === "string" ? option.name.trim() : "";
            const keyText = typeof key === "string" ? key.trim() : "";
            return <span className="asset-track-taxonomy-chip" key={key} title={typeof groupName === "string" && groupName.trim() ? groupName.trim() : undefined}>{optionName || keyText || t("未命名", "Unnamed")}</span>;
          })}</div></td>
          <td className="asset-track-category-actions asset-track-actions-cell"><div className="asset-track-category-action-group"><button type="button" onClick={() => new CategoryEditorModal({
            app, api, category: row, categories,
            groups: attributeGroups, options: attributeOptions,
            onApply: (next) => updateCategory(index, (category) => { Object.assign(category, next); }),
            onRemove: () => { void onRemove(row, index); },
            onSavedHistory, onDataChanged, onOpenRules
          }).open()}><span className="asset-track-action-full">{t("编辑属性", "Edit attributes")}</span><span className="asset-track-action-short">{t("属性", "Attributes")}</span></button>
          <button type="button" disabled={editingDisabled} onClick={() => openHistory(row, false)}><span className="asset-track-action-full">{t("迁移流水", "Migrate transactions")}</span><span className="asset-track-action-short">{t("迁移", "Migrate")}</span></button>
          <button type="button" disabled={editingDisabled} aria-label={t(`${rowLabel}更多操作`, `More actions for ${rowLabel}`)} onClick={event => {
            new Menu().addItem(item => item.setTitle(t("删除分类", "Delete category")).setIcon("trash-2")
              .onClick(() => openHistory(row, true))).showAtMouseEvent(event.nativeEvent);
          }}>···</button></div></td>
        </tr>;
        })}</tbody>
      </table>
    </div>}
    <div className="asset-track-section-actions">
      <button type="button" onClick={() => {
        const categoryKey = `cat-user-${crypto.randomUUID()}`;
        const next: CategoryDefinition = { category_key: categoryKey, name: "", description: "", transaction_type: "支出", necessity: "不适用", pattern: "不适用", is_big_ticket: false, color: CATEGORY_RAINBOW[categories.length % CATEGORY_RAINBOW.length], is_active: true, sort_order: categories.length, attribute_keys: [] };
        new CategoryEditorModal({ app, api, category: next, categories: [...categories, next],
          isNew: true,
          groups: attributeGroups, options: attributeOptions,
          onApply: (category) => onChange([...categories, category]),
          onRemove: () => undefined, onSavedHistory, onDataChanged, onOpenRules
        }).open();
      }}>{t("新增分类", "Add category")}</button>
      {showSectionActions && <>
        <button type="button" disabled={pageState.kind === "pending"} onClick={() => void onReload()}>
          {t("放弃并重载", "Discard and reload")}
        </button>
        <button type="button" className="mod-cta" disabled={saveBlocked || !dirty || saveState.kind === "pending"} onClick={() => void onSave()}>
          {t("保存分类", "Save categories")}
        </button>
      </>}
    </div>
  </Section>;
}
