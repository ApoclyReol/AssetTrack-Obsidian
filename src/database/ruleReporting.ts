import { normalizeProductKey, ruleMatchLevel, rulesEquivalent, rulesOverlap, type RuleRow } from "../domain/rules";
import {
  contentRevision,
  exactRuleIndexKey,
  ruleIndexKey,
  text,
  type Row
} from "./repositoryPrimitives";

export function buildRuleReport(
  raw: Row[],
  transactions: Row[]
): { revision: number; rows: Row[] } {
  const revision = contentRevision(raw);
  const definitions = raw.map((row) => ({
    id: Number(row.id),
    transaction_type: text(row.transaction_type),
    counterparty: text(row.counterparty),
    product: text(row.product),
    category_key: text(row.category_key),
    category: text(row.category)
  } satisfies RuleRow & { id: number }));
  const duplicateIds = new Map<number, number[]>();
  const conflictIds = new Map<number, number[]>();
  for (let leftIndex = 0; leftIndex < definitions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < definitions.length; rightIndex += 1) {
      const left = definitions[leftIndex];
      const right = definitions[rightIndex];
      const leftCategory = normalizeProductKey(left.category_key) || normalizeProductKey(left.category);
      const rightCategory = normalizeProductKey(right.category_key) || normalizeProductKey(right.category);
      if (rulesEquivalent(left, right) && leftCategory === rightCategory) {
        duplicateIds.set(left.id, [...(duplicateIds.get(left.id) ?? []), right.id]);
        duplicateIds.set(right.id, [...(duplicateIds.get(right.id) ?? []), left.id]);
      }
      const leftLevel = ruleMatchLevel(left);
      const rightLevel = ruleMatchLevel(right);
      const samePrecision = leftLevel !== null && leftLevel === rightLevel;
      const exactOverBroad =
        (leftLevel === "exact" && rightLevel !== null && rightLevel !== "exact")
        || (rightLevel === "exact" && leftLevel !== null && leftLevel !== "exact");
      if (
        rulesOverlap(left, right)
        && (samePrecision || exactOverBroad)
        && leftCategory !== rightCategory
      ) {
        conflictIds.set(left.id, [...(conflictIds.get(left.id) ?? []), right.id]);
        conflictIds.set(right.id, [...(conflictIds.get(right.id) ?? []), left.id]);
      }
    }
  }

  type RuleOccurrenceSummary = {
    occurrences: number;
    months: Set<string>;
    lastMonth: string;
  };
  const byType = new Map<string, RuleOccurrenceSummary>();
  const byCounterparty = new Map<string, RuleOccurrenceSummary>();
  const byProduct = new Map<string, RuleOccurrenceSummary>();
  const byExact = new Map<string, RuleOccurrenceSummary>();
  const addOccurrence = (
    target: Map<string, RuleOccurrenceSummary>,
    key: string,
    month: string
  ): void => {
    const summary = target.get(key) ?? { occurrences: 0, months: new Set<string>(), lastMonth: "" };
    summary.occurrences += 1;
    summary.months.add(month);
    if (month > summary.lastMonth) summary.lastMonth = month;
    target.set(key, summary);
  };
  for (const transaction of transactions) {
    const type = text(transaction.type);
    const counterparty = normalizeProductKey(transaction.counterparty);
    const product = normalizeProductKey(transaction.product);
    const month = text(transaction.month);
    addOccurrence(byType, type, month);
    if (counterparty) addOccurrence(byCounterparty, ruleIndexKey(type, counterparty), month);
    if (product) addOccurrence(byProduct, ruleIndexKey(type, product), month);
    if (counterparty && product) addOccurrence(byExact, exactRuleIndexKey(type, counterparty, product), month);
  }
  const summaryFor = (rule: RuleRow): RuleOccurrenceSummary => {
    const level = ruleMatchLevel(rule);
    const counterparty = normalizeProductKey(rule.counterparty);
    const product = normalizeProductKey(rule.product);
    const summary = level === "exact"
      ? byExact.get(exactRuleIndexKey(rule.transaction_type, counterparty, product))
      : level === "product"
        ? byProduct.get(ruleIndexKey(rule.transaction_type, product))
        : level === "counterparty"
          ? byCounterparty.get(ruleIndexKey(rule.transaction_type, counterparty))
          : byType.get(rule.transaction_type);
    return summary ?? { occurrences: 0, months: new Set<string>(), lastMonth: "" };
  };
  return {
    revision,
    rows: raw.map((row) => {
      const summary = summaryFor(row as unknown as RuleRow);
      return {
        ...row,
        match_level: ruleMatchLevel(row as unknown as RuleRow),
        occurrences: summary.occurrences,
        months_count: summary.months.size,
        last_month: summary.lastMonth,
        duplicate_rule_ids: duplicateIds.get(Number(row.id)) ?? [],
        conflict_rule_ids: conflictIds.get(Number(row.id)) ?? [],
        rule_status: (conflictIds.has(Number(row.id))
          ? "冲突"
          : duplicateIds.has(Number(row.id))
            ? "重复"
            : "正常")
      };
    })
  };
}
