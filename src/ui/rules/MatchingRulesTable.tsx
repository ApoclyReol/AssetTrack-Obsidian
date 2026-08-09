import { useEffect, useRef } from "react";
import type {
  CategoryDefinition
} from "../../types/configuration";
import type {
  SavedRule
} from "../../types/rules";
import type { ReadWindow } from "../../types/readWindows";
import { businessLabel, t } from "../../i18n";
import { inferRuleScopeFromConditions, ruleCategoryType } from "../../domain/rules";
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

export interface MatchingRulesTableProps {
  rules: SavedRule[];
  categories: CategoryDefinition[];
  sort: SortState;
  onSort: (next: SortState) => void;
  onChange: (rules: SavedRule[]) => void;
  onRemove?: (index: number, rule: SavedRule) => void | Promise<void>;
  showSectionActions: boolean;
  dirty: boolean;
  pageState: OperationState;
  saveState: OperationState;
  onReload: () => Promise<void>;
  onSave: () => Promise<void>;
  readWindow?: ReadWindow | null;
  sectionRef: { current: HTMLElement | null };
}

function inferredScope(rule: Pick<SavedRule, "counterparty" | "product">): SavedRule["match_scope"] | null {
  return inferRuleScopeFromConditions({
    counterparty: rule.counterparty,
    product: rule.product
  });
}

export function MatchingRulesTable({
  rules,
  categories,
  sort,
  onSort,
  onChange,
  onRemove,
  showSectionActions,
  dirty,
  pageState,
  saveState,
  onReload,
  onSave,
  readWindow,
  sectionRef
}: MatchingRulesTableProps) {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingRuleKey = useRef<string | null>(null);

  useEffect(() => {
    if (focusNewTableRow(tableScrollRef.current, pendingRuleKey.current)) {
      pendingRuleKey.current = null;
    }
  }, [rules.length, sort]);

  const updateRule = (index: number, update: (rule: SavedRule) => void) => {
    const next = clone(rules);
    update(next[index]);
    next[index].match_scope = inferredScope(next[index]) ?? undefined;
    onChange(next);
  };

  const ruleView = sortRows(rules, sort, (row, key) => row[key as keyof SavedRule]);

  return <Section sectionRef={sectionRef}>
    {ruleView.length === 0 ? <EmptyState text={t("尚无已保存匹配规则。", "No saved matching rules yet.")} /> : <div ref={tableScrollRef} className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
      <table className="asset-track-rules-table"><caption>{t(
        "匹配优先级：交易对手 + 商品 ＞ 商品 ＞ 交易对手",
        "Match priority: counterparty + item > item > counterparty"
      )}</caption><thead><tr><th scope="col" className="asset-track-count-column">{t("编号", "ID")}</th>{[
        ["transaction_type", t("收支", "Type")], ["counterparty", t("交易对手条件", "Counterparty condition")], ["product", t("商品条件", "Item condition")], ["rewrite_merchant", t("重写交易对手", "Rewrite counterparty")], ["rewrite_product", t("重写商品", "Rewrite item")], ["category", t("分类", "Category")], ["occurrences", t("流水数", "Transactions")], ["last_month", t("最近月份", "Latest month")]
      ].map(([field, label]) => <th key={field} scope="col" className={field === "transaction_type" ? "asset-track-type-column" : field === "category" ? "asset-track-centered-column" : field === "occurrences" ? "asset-track-count-column" : field === "last_month" ? "asset-track-date-column" : undefined}><SortButton field={field} label={label} sort={sort} onSort={onSort} /></th>)}<ActionTableHeader /></tr></thead>
        <tbody>{ruleView.map(({ row, originalIndex: index }) => {
          const rowLabel = row.id ? `#${row.id}` : t(`第 ${index + 1} 条新规则`, `New rule ${index + 1}`);
          return <tr data-asset-track-row-key={String(row.id ?? `new-rule-${index}`)} key={String(row.id ?? index)}>
          <td className="asset-track-count-cell">{row.id ? `#${row.id}` : t("新规则", "New")}</td>
          <td className="asset-track-type-cell"><select aria-label={t(`${rowLabel}收支类型`, `${rowLabel} transaction type`)} value={row.transaction_type} onChange={(event) => updateRule(index, (rule) => { rule.transaction_type = event.target.value as SavedRule["transaction_type"]; rule.category_key = ""; rule.category = ""; })}><option value="支出">{businessLabel("支出")}</option><option value="收入">{businessLabel("收入")}</option><option value="代付">{businessLabel("代付")}</option></select></td>
          <td><input aria-label={t(`${rowLabel}交易对手条件`, `${rowLabel} counterparty condition`)} value={row.counterparty ?? ""} onChange={(event) => updateRule(index, (rule) => { rule.counterparty = event.target.value; })} /></td>
          <td><input aria-label={t(`${rowLabel}商品条件`, `${rowLabel} item condition`)} value={row.product} onChange={(event) => updateRule(index, (rule) => { rule.product = event.target.value; })} /></td>
          <td><input aria-label={t(`${rowLabel}重写交易对手`, `${rowLabel} rewrite counterparty`)} value={row.rewrite_merchant ?? ""} onChange={(event) => updateRule(index, (rule) => { rule.rewrite_merchant = event.target.value; })} /></td>
          <td><input aria-label={t(`${rowLabel}重写商品`, `${rowLabel} rewrite item`)} value={row.rewrite_product ?? ""} onChange={(event) => updateRule(index, (rule) => { rule.rewrite_product = event.target.value; })} /></td>
          <td className="asset-track-centered-cell"><select aria-label={t(`${rowLabel}分类`, `${rowLabel} category`)} value={row.category_key} onChange={(event) => updateRule(index, (rule) => { const category = categories.find((item) => item.category_key === event.target.value); rule.category_key = event.target.value; rule.category = category?.name ?? ""; })}><option value="">{t("请选择", "Select")}</option>{categories.filter((category) => category.transaction_type === ruleCategoryType(row.transaction_type)).map((category) => <option key={category.category_key} value={category.category_key} disabled={!category.is_active}>{category.name}{category.is_active ? "" : ` · ${t("停用", "Inactive")}`}</option>)}</select></td>
          <td className="asset-track-count-cell">{row.occurrences ?? "—"}</td><td className="asset-track-date-cell">{row.last_month ?? "—"}</td>
          <td className="asset-track-actions-cell"><button type="button" onClick={() => void (onRemove
            ? onRemove(index, row)
            : onChange(rules.filter((_, item) => item !== index)))}>{t("删除", "Delete")}</button></td>
        </tr>;
        })}</tbody>
      </table>
    </div>}
    <div className="asset-track-section-actions">
      <button type="button" onClick={() => {
        const category = categories.find((row) => row.is_active && row.transaction_type === "支出");
        pendingRuleKey.current = `new-rule-${rules.length}`;
        onChange([...rules, { transaction_type: "支出", match_scope: undefined, counterparty: "", product: "", rewrite_merchant: "", rewrite_product: "", category_key: category?.category_key ?? "", category: category?.name ?? "" }]);
      }}>{t("新增规则", "Add rule")}</button>
      {showSectionActions && <>
        <button type="button" disabled={pageState.kind === "pending"} onClick={() => void onReload()}>
          {t("放弃并重载", "Discard and reload")}
        </button>
        <button type="button" className="mod-cta" disabled={!dirty || saveState.kind === "pending"} onClick={() => void onSave()}>
          {t("保存规则", "Save rules")}
        </button>
        {readWindow && <span className="asset-track-section-scope-note" role="note">
          {t(`统计范围：近 5 年（${readWindow.from_date} 至 ${readWindow.to_date}）`, `Statistics range: last 5 years (${readWindow.from_date} to ${readWindow.to_date})`)}
        </span>}
      </>}
    </div>
  </Section>;
}
