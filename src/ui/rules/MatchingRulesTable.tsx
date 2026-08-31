import { Fragment, useEffect, useRef, useState } from "react";
import type {
  CategoryDefinition
} from "../../types/configuration";
import type {
  RuleMatchScope,
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
import {
  DEFAULT_RULE_SORT,
  EMPTY_RULE_LIST_FILTERS,
  matchesRule,
  ruleGroupKey,
  ruleListStatus,
  ruleScope,
  ruleSortValue,
  type RuleGroupBy,
  type RuleListFilters,
  type RuleListStatus
} from "./ruleListModel";

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

const RULE_COLUMN_COUNT = 11;

function statusLabel(status: RuleListStatus): string {
  return {
    正常: t("正常", "Active"),
    重复: t("重复", "Duplicate"),
    冲突: t("冲突", "Conflict"),
    分类已停用: t("分类已停用", "Category inactive")
  }[status];
}

function statusClass(status: RuleListStatus): string {
  return {
    正常: "normal",
    重复: "duplicate",
    冲突: "conflict",
    分类已停用: "inactive"
  }[status];
}

function scopeLabel(scope: RuleMatchScope | null): string {
  if (scope === "merchant_product") return t("交易对手 + 商品", "Counterparty + item");
  if (scope === "product") return t("仅商品", "Item only");
  if (scope === "merchant") return t("仅交易对手", "Counterparty only");
  return t("未设置", "Not set");
}

function groupLabel(rule: SavedRule, groupBy: RuleGroupBy): string {
  switch (groupBy) {
    case "status":
      return statusLabel(ruleListStatus(rule));
    case "transaction_type":
      return businessLabel(rule.transaction_type);
    case "match_scope":
      return scopeLabel(ruleScope(rule));
    case "category":
      return rule.category.trim() || t("未选择分类", "No category");
    default:
      return "";
  }
}

function sortOptionValue(sort: { key: string; direction: "asc" | "desc" } | null): string {
  return `${sort?.key ?? DEFAULT_RULE_SORT.key}:${sort?.direction ?? DEFAULT_RULE_SORT.direction}`;
}

function isDefaultView(filters: RuleListFilters, groupBy: RuleGroupBy, sort: SortState): boolean {
  return !filters.query.trim()
    && !filters.transactionType
    && !filters.status
    && !filters.scope
    && !filters.categoryKey
    && groupBy === "none"
    && sortOptionValue(sort) === sortOptionValue(DEFAULT_RULE_SORT);
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
  const [filters, setFilters] = useState<RuleListFilters>(EMPTY_RULE_LIST_FILTERS);
  const [groupBy, setGroupBy] = useState<RuleGroupBy>("none");

  useEffect(() => {
    if (focusNewTableRow(tableScrollRef.current, pendingRuleKey.current)) {
      pendingRuleKey.current = null;
    }
  }, [rules.length, sort, filters, groupBy]);

  const updateRule = (index: number, update: (rule: SavedRule) => void) => {
    const next = clone(rules);
    update(next[index]);
    next[index].match_scope = inferredScope(next[index]) ?? undefined;
    onChange(next);
  };

  const effectiveSort = sort ?? DEFAULT_RULE_SORT;
  const ruleView = sortRows(rules, effectiveSort, ruleSortValue)
    .filter(({ row }) => matchesRule(row, filters));
  const groupedRuleView = (() => {
    const grouped = new Map<string, Array<{ row: SavedRule; originalIndex: number }>>();
    for (const item of ruleView) {
      const key = ruleGroupKey(item.row, groupBy);
      const current = grouped.get(key) ?? [];
      current.push(item);
      grouped.set(key, current);
    }
    return Array.from(grouped, ([key, rows]) => ({ key, rows }));
  })();

  const sortOptions = [
    ["occurrences:desc", t("流水数（多到少）", "Transactions (high to low)")],
    ["occurrences:asc", t("流水数（少到多）", "Transactions (low to high)")],
    ["last_used_date:desc", t("最近使用（新到旧）", "Latest used (newest first)")],
    ["last_used_date:asc", t("最近使用（旧到新）", "Latest used (oldest first)")],
    ["status:asc", t("状态（先看问题）", "Status (issues first)")],
    ["category:asc", t("分类（A-Z）", "Category (A-Z)")],
    ["match_scope:asc", t("作用域（先具体）", "Scope (most specific first)")],
    ["transaction_type:asc", t("收支类型", "Transaction type")],
    ["id:asc", t("编号", "ID")]
  ] as const;
  const activeSortValue = sortOptionValue(effectiveSort);
  const activeSortOption = sortOptions.some(([value]) => value === activeSortValue)
    ? activeSortValue
    : "custom";
  const hasFilters = Boolean(
    filters.query.trim()
    || filters.transactionType
    || filters.status
    || filters.scope
    || filters.categoryKey
  );

  const updateFilter = <K extends keyof RuleListFilters>(key: K, value: RuleListFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const resetView = () => {
    setFilters(EMPTY_RULE_LIST_FILTERS);
    setGroupBy("none");
    onSort({ ...DEFAULT_RULE_SORT });
  };

  const appendRule = () => {
    const category = categories.find((row) => row.is_active && row.transaction_type === "支出");
    pendingRuleKey.current = `new-rule-${rules.length}`;
    setFilters(EMPTY_RULE_LIST_FILTERS);
    setGroupBy("none");
    onSort({ ...DEFAULT_RULE_SORT });
    onChange([...rules, { transaction_type: "支出", match_scope: undefined, counterparty: "", product: "", rewrite_merchant: "", rewrite_product: "", category_key: category?.category_key ?? "", category: category?.name ?? "" }]);
  };

  const renderRuleRow = ({ row, originalIndex: index }: { row: SavedRule; originalIndex: number }) => {
    const rowLabel = row.id ? `#${row.id}` : t(`第 ${index + 1} 条新规则`, `New rule ${index + 1}`);
    const status = ruleListStatus(row);
    return <tr data-asset-track-row-key={String(row.id ?? `new-rule-${index}`)} key={String(row.id ?? index)}>
      <td className="asset-track-count-cell">{row.id ? `#${row.id}` : t("新规则", "New")}</td>
      <td className="asset-track-rule-status-cell">
        <span className={`asset-track-rule-status is-${statusClass(status)}`}>{statusLabel(status)}</span>
        <small>{scopeLabel(ruleScope(row))}</small>
      </td>
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
  };

  return <Section sectionRef={sectionRef}>
    <div className="asset-track-rules-toolbar" role="region" aria-label={t("规则筛选、分组与排序", "Rule filters, grouping and sorting")}>
      <div className="asset-track-rules-toolbar-heading">
        <strong>{t("规则浏览", "Browse rules")}</strong>
        <span className="asset-track-rules-toolbar-summary" role="status">
          {t(`显示 ${ruleView.length} / ${rules.length} 条规则`, `${ruleView.length} of ${rules.length} rules shown`)}
        </span>
      </div>
      <div className="asset-track-filter-grid asset-track-rules-filter-grid">
        <label>
          {t("搜索", "Search")}
          <input type="search" placeholder={t("条件、重写或分类", "Conditions, rewrites or category")} value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} />
        </label>
        <label>
          {t("分组", "Group by")}
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as RuleGroupBy)}>
            <option value="none">{t("不分组", "No grouping")}</option>
            <option value="status">{t("状态", "Status")}</option>
            <option value="transaction_type">{t("收支", "Type")}</option>
            <option value="match_scope">{t("作用域", "Scope")}</option>
            <option value="category">{t("分类", "Category")}</option>
          </select>
        </label>
        <label>
          {t("排序", "Sort")}
          <select value={activeSortOption} onChange={(event) => {
            const [key, direction] = event.target.value.split(":");
            if (direction === "asc" || direction === "desc") onSort({ key, direction });
          }}>
            {activeSortOption === "custom" && <option value="custom">{t("按当前表头", "Current table column")}</option>}
            {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="asset-track-rules-sort-direction" aria-label={t(`切换排序方向（当前${effectiveSort.direction === "asc" ? "升序" : "降序"}）`, `Toggle sort direction (currently ${effectiveSort.direction === "asc" ? "ascending" : "descending"})`)} onClick={() => onSort({ key: effectiveSort.key, direction: effectiveSort.direction === "asc" ? "desc" : "asc" })}>
          {effectiveSort.direction === "asc" ? t("升序 ↑", "Ascending ↑") : t("降序 ↓", "Descending ↓")}
        </button>
        <button type="button" disabled={isDefaultView(filters, groupBy, sort)} onClick={resetView}>{t("重置视图", "Reset view")}</button>
      </div>
      <div className="asset-track-filter-grid asset-track-rules-filter-grid asset-track-rules-advanced-filter-grid">
        <label>
          {t("收支", "Type")}
          <select value={filters.transactionType} onChange={(event) => updateFilter("transactionType", event.target.value as RuleListFilters["transactionType"])}>
            <option value="">{t("全部收支", "All types")}</option>
            <option value="支出">{businessLabel("支出")}</option>
            <option value="收入">{businessLabel("收入")}</option>
            <option value="代付">{businessLabel("代付")}</option>
          </select>
        </label>
        <label>
          {t("状态", "Status")}
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value as RuleListFilters["status"])}>
            <option value="">{t("全部状态", "All statuses")}</option>
            <option value="正常">{statusLabel("正常")}</option>
            <option value="重复">{statusLabel("重复")}</option>
            <option value="冲突">{statusLabel("冲突")}</option>
            <option value="分类已停用">{statusLabel("分类已停用")}</option>
          </select>
        </label>
        <label>
          {t("作用域", "Scope")}
          <select value={filters.scope} onChange={(event) => updateFilter("scope", event.target.value as RuleListFilters["scope"])}>
            <option value="">{t("全部作用域", "All scopes")}</option>
            <option value="merchant_product">{scopeLabel("merchant_product")}</option>
            <option value="product">{scopeLabel("product")}</option>
            <option value="merchant">{scopeLabel("merchant")}</option>
          </select>
        </label>
        <label>
          {t("分类", "Category")}
          <select value={filters.categoryKey} onChange={(event) => updateFilter("categoryKey", event.target.value)}>
            <option value="">{t("全部分类", "All categories")}</option>
            {categories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
          </select>
        </label>
      </div>
      {hasFilters && <p className="asset-track-rules-filter-note" role="note">{t("筛选只改变当前浏览，不会修改规则。", "Filters only change this view; they do not modify rules.")}</p>}
    </div>
    {ruleView.length === 0 ? <EmptyState text={rules.length === 0 ? t("尚无已保存匹配规则。", "No saved matching rules yet.") : t("没有符合当前筛选条件的规则。", "No rules match the current filters.")} /> : <div ref={tableScrollRef} className="asset-track-table-scroll asset-track-responsive-scroll asset-track-rule-table-scroll">
      <table className="asset-track-rules-table"><caption>{t(
        "匹配优先级：交易对手 + 商品 ＞ 商品 ＞ 交易对手",
        "Match priority: counterparty + item > item > counterparty"
      )}</caption><thead><tr><th scope="col" className="asset-track-count-column">{t("编号", "ID")}</th>{[
        ["status", t("状态", "Status")], ["transaction_type", t("收支", "Type")], ["counterparty", t("交易对手条件", "Counterparty condition")], ["product", t("商品条件", "Item condition")], ["rewrite_merchant", t("重写交易对手", "Rewrite counterparty")], ["rewrite_product", t("重写商品", "Rewrite item")], ["category", t("分类", "Category")], ["occurrences", t("流水数", "Transactions")], ["last_month", t("最近月份", "Latest month")]
      ].map(([field, label]) => <th key={field} scope="col" className={field === "transaction_type" ? "asset-track-type-column" : field === "status" ? "asset-track-status-column" : field === "category" ? "asset-track-centered-column" : field === "occurrences" ? "asset-track-count-column" : field === "last_month" ? "asset-track-date-column" : undefined}><SortButton field={field} label={label} sort={effectiveSort} onSort={onSort} /></th>)}<ActionTableHeader /></tr></thead>
        <tbody>{groupedRuleView.map((group) => <Fragment key={group.key}>
          {groupBy !== "none" && <tr className="asset-track-rule-group-row"><th scope="rowgroup" colSpan={RULE_COLUMN_COUNT}><span>{groupLabel(group.rows[0].row, groupBy)}</span><small>{t(`${group.rows.length} 条规则`, `${group.rows.length} rules`)}</small></th></tr>}
          {group.rows.map(renderRuleRow)}
        </Fragment>)}</tbody>
      </table>
    </div>}
    <div className="asset-track-section-actions">
      <button type="button" onClick={appendRule}>{t("新增规则", "Add rule")}</button>
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
