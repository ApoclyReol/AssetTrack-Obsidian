import type {
  RuleMatchLevel,
  SavedRule
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import { RuleMatcher } from "../domain/rules";

export type TransactionGroupBy = "product" | "counterparty";
export type TransactionKey = number | string;

export interface TransactionCategoryCount {
  category: string;
  count: number;
}

export interface TransactionGroup {
  key: string;
  groupBy: TransactionGroupBy;
  type: string;
  label: string;
  product: string;
  counterparty: string;
  variants: string[];
  products: string[];
  counterparties: string[];
  count: number;
  amount: number;
  firstDate: string;
  lastDate: string;
  categories: string[];
  categoryCounts: TransactionCategoryCount[];
  categoryPurity: number | null;
  uncategorizedCount: number;
  counterpartyCount: number;
  productCount: number;
  ruleIds: number[];
  ruleLevels: RuleMatchLevel[];
  matchedCount: number;
  unmatchedCount: number;
  conflictedCount: number;
  itemRuleCoveredCount: number;
  ruleCoverage: "none" | "partial" | "full";
  indexes: number[];
  transactionKeys: TransactionKey[];
}

export function transactionKey(
  row: Pick<Transaction, "id" | "client_id">
): TransactionKey | null {
  if (typeof row.id === "number" && Number.isFinite(row.id)) return row.id;
  const clientId = row.client_id?.trim();
  return clientId ? clientId : null;
}

export function normalizeTransactionLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}]+/gu, "");
}

export function normalizeProduct(value: string): string {
  return normalizeTransactionLabel(value);
}

export function normalizeCounterparty(value: string): string {
  return normalizeTransactionLabel(value);
}

function hasCategory(type: string): boolean {
  return type === "支出" || type === "收入" || type === "代付";
}

function isClassifiable(type: string): boolean {
  return type === "支出" || type === "收入" || type === "代付";
}

function addUnique(values: string[], value: string, normalized = false): void {
  if (!value) return;
  const candidate = normalized ? normalizeTransactionLabel(value) : value;
  if (!values.some((current) => (normalized ? normalizeTransactionLabel(current) : current) === candidate)) {
    values.push(value);
  }
}

function addCategory(group: TransactionGroup, row: Transaction): void {
  if (!hasCategory(row.type)) return;
  const category = row.category.trim();
  if (!category) {
    group.uncategorizedCount += 1;
    return;
  }
  const current = group.categoryCounts.find((item) => item.category === category);
  if (current) {
    current.count += 1;
  } else {
    group.categoryCounts.push({ category, count: 1 });
    group.categories.push(category);
  }
}

function updateGroupMetrics(group: TransactionGroup): void {
  group.counterpartyCount = group.counterparties.length;
  group.productCount = group.products.length;
  const classifiableCount = group.categoryCounts.reduce(
    (total, item) => total + item.count,
    0
  ) + group.uncategorizedCount;
  group.categoryPurity = classifiableCount === 0
    ? null
    : Math.max(...group.categoryCounts.map((item) => item.count), 0) / classifiableCount;
  const ruleApplicableCount = group.matchedCount + group.unmatchedCount + group.conflictedCount;
  group.ruleCoverage = ruleApplicableCount === 0
    ? "none"
    : group.matchedCount === ruleApplicableCount
      ? "full"
      : group.matchedCount > 0 ? "partial" : "none";
}

function appendToGroup(
  group: TransactionGroup,
  row: Transaction,
  index: number,
  matcher: RuleMatcher
): void {
  group.count += 1;
  group.amount += row.amount;
  group.indexes.push(index);
  group.firstDate = [group.firstDate, row.transaction_date].sort()[0];
  group.lastDate = [group.lastDate, row.transaction_date].sort().at(-1) ?? "";
  addUnique(group.products, row.product, true);
  addUnique(group.counterparties, row.counterparty?.trim() ?? "", true);
  const displayValue = group.groupBy === "product"
    ? row.product
    : row.counterparty?.trim() ?? "";
  addUnique(group.variants, displayValue);
  const key = transactionKey(row);
  if (key !== null && !group.transactionKeys.includes(key)) {
    group.transactionKeys.push(key);
  }
  addCategory(group, row);
  if (isClassifiable(row.type)) {
    const resolution = matcher.resolve(row);
    if (resolution.status === "matched") group.matchedCount += 1;
    else if (resolution.status === "conflict") group.conflictedCount += 1;
    else group.unmatchedCount += 1;
    [...resolution.rule_ids, ...(resolution.covered_rule_ids ?? [])].forEach((id) => {
      if (Number.isFinite(id) && id > 0 && !group.ruleIds.includes(id)) group.ruleIds.push(id);
    });
    if (resolution.level && !group.ruleLevels.includes(resolution.level)) {
      group.ruleLevels.push(resolution.level);
    }
    if (resolution.status === "matched"
      && (resolution.level === "product" || resolution.level === "merchant_product")) {
      group.itemRuleCoveredCount += 1;
    }
  }
  updateGroupMetrics(group);
}

export function transactionKeysForIndexes(
  rows: Transaction[],
  indexes: readonly number[]
): TransactionKey[] {
  const keys: TransactionKey[] = [];
  indexes.forEach((index) => {
    const key = transactionKey(rows[index]);
    if (key !== null && !keys.includes(key)) keys.push(key);
  });
  return keys;
}

export function groupTransactions(
  rows: Transaction[],
  groupBy: TransactionGroupBy = "product",
  indexes: readonly number[] = rows.map((_row, index) => index),
  rules: readonly SavedRule[] = []
): TransactionGroup[] {
  const groups = new Map<string, TransactionGroup>();
  const matcher = new RuleMatcher(rules);
  indexes.forEach((index) => {
    const row = rows[index];
    if (!row) return;
    const value = groupBy === "product"
      ? row.product
      : row.counterparty?.trim() ?? "";
    const normalized = normalizeTransactionLabel(value);
    const key = `${row.type}\u0000${normalized}`;
    const current = groups.get(key);
    if (current) {
      appendToGroup(current, row, index, matcher);
      return;
    }
    const displayValue = groupBy === "product"
      ? row.product
      : row.counterparty?.trim() ?? "";
    const group: TransactionGroup = {
      key,
      groupBy,
      type: row.type,
      label: displayValue,
      product: groupBy === "product" ? row.product : "",
      counterparty: groupBy === "counterparty" ? row.counterparty?.trim() ?? "" : "",
      variants: displayValue ? [displayValue] : [],
      products: [],
      counterparties: [],
      count: 0,
      amount: 0,
      firstDate: row.transaction_date,
      lastDate: row.transaction_date,
      categories: [],
      categoryCounts: [],
      categoryPurity: null,
      uncategorizedCount: 0,
      counterpartyCount: 0,
      productCount: 0,
      ruleIds: [],
      ruleLevels: [],
      matchedCount: 0,
      unmatchedCount: 0,
      conflictedCount: 0,
      itemRuleCoveredCount: 0,
      ruleCoverage: "none",
      indexes: [],
      transactionKeys: []
    };
    appendToGroup(group, row, index, matcher);
    groups.set(key, group);
  });
  return [...groups.values()];
}
