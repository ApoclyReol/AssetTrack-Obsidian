import {
  findRuleConflicts,
  normalizeProductKey,
  ruleMatchLevel,
  type RuleRow
} from "../domain/rules";
import {
  contentRevision,
  text,
  type Row
} from "./repositoryPrimitives";

function toRuleRow(row: Row): RuleRow & { id: number } {
  const matchScope = text(row.match_scope) as RuleRow["match_scope"];
  return {
    id: Number(row.id),
    transaction_type: text(row.transaction_type),
    match_scope: matchScope,
    counterparty: matchScope === "product" ? "" : text(row.counterparty),
    product: text(row.product),
    category_key: text(row.category_key),
    category: text(row.category),
    category_active: row.category_active === undefined ? undefined : Boolean(row.category_active),
    rewrite_merchant: text(row.rewrite_merchant),
    rewrite_product: text(row.rewrite_product)
  };
}

function ruleIndexKey(transactionType: string, counterparty: string, product: string): string {
  return `${transactionType}\u0000${counterparty}\u0000${product}`;
}

function appendIndexed(groups: Map<string, Row[]>, key: string, row: Row): void {
  const current = groups.get(key);
  if (current) current.push(row);
  else groups.set(key, [row]);
}

function buildTransactionIndex(transactions: Row[]): {
  product: Map<string, Row[]>;
  merchant: Map<string, Row[]>;
  merchantProduct: Map<string, Row[]>;
} {
  const index = {
    product: new Map<string, Row[]>(),
    merchant: new Map<string, Row[]>(),
    merchantProduct: new Map<string, Row[]>()
  };
  transactions.forEach((transaction) => {
    const transactionType = text(transaction.type);
    const counterparty = normalizeProductKey(transaction.counterparty);
    const product = normalizeProductKey(transaction.product);
    if (product) appendIndexed(index.product, ruleIndexKey(transactionType, "", product), transaction);
    if (counterparty) appendIndexed(index.merchant, ruleIndexKey(transactionType, counterparty, ""), transaction);
    if (counterparty && product) {
      appendIndexed(index.merchantProduct, ruleIndexKey(transactionType, counterparty, product), transaction);
    }
  });
  return index;
}

function transactionsForRule(
  index: ReturnType<typeof buildTransactionIndex>,
  rule: RuleRow
): Row[] {
  const level = ruleMatchLevel(rule);
  if (!level) return [];
  const counterparty = normalizeProductKey(rule.counterparty);
  const product = normalizeProductKey(rule.product);
  if (level === "product") {
    return product
      ? index.product.get(ruleIndexKey(rule.transaction_type, "", product)) ?? []
      : [];
  }
  if (level === "merchant") {
    return counterparty
      ? index.merchant.get(ruleIndexKey(rule.transaction_type, counterparty, "")) ?? []
      : [];
  }
  return counterparty && product
    ? index.merchantProduct.get(ruleIndexKey(rule.transaction_type, counterparty, product)) ?? []
    : [];
}

function transactionSummary(transactions: Row[]): {
  occurrences: number;
  monthsCount: number;
  lastMonth: string;
  lastUsedDate: string;
} {
  const months = new Set<string>();
  let lastMonth = "";
  let lastUsedDate = "";
  transactions.forEach((transaction) => {
    const month = text(transaction.month);
    const usedDate = text(transaction.transaction_date);
    if (month) {
      months.add(month);
      if (month > lastMonth) lastMonth = month;
    }
    if (usedDate > lastUsedDate) lastUsedDate = usedDate;
  });
  return {
    occurrences: transactions.length,
    monthsCount: months.size,
    lastMonth,
    lastUsedDate
  };
}

export function buildRuleReport(
  raw: Row[],
  transactions: Row[]
): { revision: number; rows: Row[] } {
  // `category_active` comes from the category join and belongs to the
  // category revision, not the rule definition revision. Keep it out of the
  // hash so the revision matches ruleWorkspaceShell(), which is sent to the
  // editor and later returned with operation previews.
  const revisionRows = raw.map(({ category_active: _categoryActive, ...row }) => row);
  const revision = contentRevision(revisionRows);
  const definitions = raw.map(toRuleRow);
  const transactionIndex = buildTransactionIndex(transactions);
  const duplicateIds = new Map<number, number[]>();
  const conflictIds = new Map<number, number[]>();
  for (const conflict of findRuleConflicts(definitions)) {
    for (const id of conflict.rule_ids) {
      const target = conflict.kind === "duplicate" ? duplicateIds : conflictIds;
      target.set(id, conflict.rule_ids.filter((candidate) => candidate !== id));
    }
  }
  return {
    revision,
    rows: raw.map((row, index) => {
      const definition = definitions[index];
      const summary = transactionSummary(transactionsForRule(transactionIndex, definition));
      const id = Number(row.id);
      return {
        ...row,
        match_scope: definition.match_scope,
        match_level: ruleMatchLevel(definition),
        counterparty: definition.counterparty ?? "",
        rewrite_merchant: definition.rewrite_merchant ?? "",
        rewrite_product: definition.rewrite_product ?? "",
        occurrences: summary.occurrences,
        months_count: summary.monthsCount,
        last_month: summary.lastMonth,
        last_used_date: summary.lastUsedDate,
        duplicate_rule_ids: duplicateIds.get(id) ?? [],
        conflict_rule_ids: conflictIds.get(id) ?? [],
        rule_status: (conflictIds.has(id)
          ? "冲突"
          : duplicateIds.has(id)
            ? "重复"
            : "正常")
      };
    })
  };
}
