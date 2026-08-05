import { useEffect, useRef } from "react";
import type { CategoryDefinition, SavedRule } from "../../types";
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

export interface MatchingRulesTableProps {
  rules: SavedRule[];
  categories: CategoryDefinition[];
  sort: SortState;
  onSort: (next: SortState) => void;
  onChange: (rules: SavedRule[]) => void;
  showSectionActions: boolean;
  dirty: boolean;
  pageState: OperationState;
  saveState: OperationState;
  onReload: () => Promise<void>;
  onSave: () => Promise<void>;
  sectionRef: { current: HTMLElement | null };
}

function ruleStatusLabel(value: unknown): string {
  return ({
    正常: t("正常", "Normal"),
    重复: t("重复", "Duplicate"),
    冲突: t("冲突", "Conflict"),
    未创建: t("未创建", "Not created"),
    已覆盖: t("已覆盖", "Covered")
  }[String(value)] ?? t("加载中…", "Loading…"));
}

export function MatchingRulesTable({
  rules,
  categories,
  sort,
  onSort,
  onChange,
  showSectionActions,
  dirty,
  pageState,
  saveState,
  onReload,
  onSave,
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
    onChange(next);
  };

  const ruleView = sortRows(rules, sort, (row, key) => row[key as keyof SavedRule]);

  return <Section sectionRef={sectionRef}>
    {ruleView.length === 0 ? <EmptyState text={t("尚无已保存匹配规则。", "No saved matching rules yet.")} /> : <div ref={tableScrollRef} className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
      <table className="asset-track-rules-table"><thead><tr>{[
        ["transaction_type", t("收支", "Type")], ["product", t("商品", "Item")], ["category", t("分类", "Category")], ["rule_status", t("规则状态", "Rule status")], ["occurrences", t("流水数", "Transactions")], ["last_month", t("最近月份", "Latest month")]
      ].map(([field, label]) => <th key={field} scope="col" className={field === "transaction_type" ? "asset-track-type-column" : field === "category" || field === "rule_status" ? "asset-track-centered-column" : field === "occurrences" ? "asset-track-count-column" : field === "last_month" ? "asset-track-date-column" : undefined}><SortButton field={field} label={label} sort={sort} onSort={onSort} /></th>)}<ActionTableHeader /></tr></thead>
        <tbody>{ruleView.map(({ row, originalIndex: index }) => <tr data-asset-track-row-key={String(row.id ?? `new-rule-${index}`)} key={String(row.id ?? index)}>
          <td className="asset-track-type-cell"><select value={row.transaction_type} onChange={(event) => updateRule(index, (rule) => { rule.transaction_type = event.target.value as "支出" | "收入"; rule.category_key = ""; rule.category = ""; })}><option value="支出">{businessLabel("支出")}</option><option value="收入">{businessLabel("收入")}</option></select></td>
          <td><input value={row.product} onChange={(event) => updateRule(index, (rule) => { rule.product = event.target.value; })} /></td>
          <td className="asset-track-centered-cell"><select value={row.category_key} onChange={(event) => updateRule(index, (rule) => { const category = categories.find((item) => item.category_key === event.target.value); rule.category_key = event.target.value; rule.category = category?.name ?? ""; })}><option value="">{t("请选择", "Select")}</option>{categories.filter((category) => category.transaction_type === row.transaction_type).map((category) => <option key={category.category_key} value={category.category_key} disabled={!category.is_active}>{category.name}{category.is_active ? "" : ` · ${t("停用", "Inactive")}`}</option>)}</select></td>
          <td className="asset-track-status-cell asset-track-centered-cell">{ruleStatusLabel(row.rule_status)}{row.conflict_rule_ids?.length ? ` · ${row.conflict_rule_ids.length}` : ""}</td><td className="asset-track-count-cell">{row.occurrences ?? "—"}</td><td className="asset-track-date-cell">{row.last_month ?? "—"}</td>
          <td className="asset-track-actions-cell"><button type="button" onClick={() => onChange(rules.filter((_, item) => item !== index))}>{t("删除", "Delete")}</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="asset-track-section-actions">
      <button type="button" onClick={() => {
        const category = categories.find((row) => row.is_active && row.transaction_type === "支出");
        pendingRuleKey.current = `new-rule-${rules.length}`;
        onChange([...rules, { transaction_type: "支出", product: "", category_key: category?.category_key ?? "", category: category?.name ?? "" }]);
      }}>{t("新增规则", "Add rule")}</button>
      {showSectionActions && <>
        <button type="button" disabled={pageState.kind === "pending"} onClick={() => void onReload()}>
          {t("放弃并重载", "Discard and reload")}
        </button>
        <button type="button" className="mod-cta" disabled={!dirty || saveState.kind === "pending"} onClick={() => void onSave()}>
          {t("保存规则", "Save rules")}
        </button>
      </>}
    </div>
  </Section>;
}
