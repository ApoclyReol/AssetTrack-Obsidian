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

function matches(rule: RuleRow, transaction: Row): boolean {
  if (rule.transaction_type !== text(transaction.type)) return false;
  const level = ruleMatchLevel(rule);
  if (!level) return false;
  const counterparty = normalizeProductKey(transaction.counterparty);
  const product = normalizeProductKey(transaction.product);
  if (level === "product") return Boolean(product) && product === normalizeProductKey(rule.product);
  if (level === "merchant") return Boolean(counterparty) && counterparty === normalizeProductKey(rule.counterparty);
  return Boolean(counterparty && product)
    && counterparty === normalizeProductKey(rule.counterparty)
    && product === normalizeProductKey(rule.product);
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
      const matchingTransactions = transactions.filter((transaction) => matches(definition, transaction));
      const summary = {
        occurrences: matchingTransactions.length,
        months: new Set(matchingTransactions.map((transaction) => text(transaction.month))),
        lastMonth: matchingTransactions.map((transaction) => text(transaction.month)).sort().at(-1) ?? "",
        lastUsedDate: matchingTransactions.map((transaction) => text(transaction.transaction_date)).sort().at(-1) ?? ""
      };
      const id = Number(row.id);
      return {
        ...row,
        match_scope: definition.match_scope,
        match_level: ruleMatchLevel(definition),
        counterparty: definition.counterparty ?? "",
        rewrite_merchant: definition.rewrite_merchant ?? "",
        rewrite_product: definition.rewrite_product ?? "",
        occurrences: summary.occurrences,
        months_count: summary.months.size,
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
