import type {
  RuleAmountFields,
  RuleApplicationIssue,
  RuleChainIssue,
  RuleMatchExplanation,
  RuleMatchLevel,
  RuleMatchScope,
  RuleTransactionType
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import { EMPTY_RULE_AMOUNT, amountRangesOverlap, matchesRuleAmount, ruleAmountBounds, ruleAmountSpecificity } from "./ruleAmounts";
export { amountMinor, matchesRuleAmount } from "./ruleAmounts";
import { scalarText } from "./text";
import { rewriteRuleFields } from "./ruleRewrites";

export const RULE_TYPES = new Set<RuleTransactionType>(["支出", "收入", "代付"]);
export const RULE_SCOPES = new Set<RuleMatchScope>([
  "product",
  "merchant",
  "merchant_product"
]);

/** Normalize exact-match fields without turning them into fuzzy search. */
export function normalizeRuleKey(value: unknown): string {
  return scalarText(value)
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, " ")
    .replace(/[|｜]+/g, "|");
}

/** Kept as a compatibility alias for callers that still use product terminology. */
export const normalizeProductKey = normalizeRuleKey;

export interface RuleRow extends RuleAmountFields {
  id?: number;
  transaction_type: string;
  match_scope?: RuleMatchScope;
  counterparty?: string;
  product?: string;
  category_key?: string;
  category: string;
  category_active?: boolean;
  rewrite_merchant?: string;
  rewrite_product?: string;
  rewrite_empty_mode?: "preserve" | "clear";
}

export interface NormalizedRule extends RuleRow {
  transaction_type: RuleTransactionType;
  match_scope: RuleMatchScope;
  counterparty: string;
  product: string;
  category_key: string;
  rewrite_merchant: string;
  rewrite_product: string;
  counterparty_key: string;
  product_key: string;
}

export interface RuleDefinitionIssue {
  code:
    | "invalid_amount"
    | "invalid_rewrite_mode"
    | "invalid_type"
    | "invalid_scope"
    | "missing_condition"
    | "condition_not_allowed"
    | "empty_rewrite"
    | "missing_category";
  message: string;
}

function comparable(value: unknown): string {
  return normalizeRuleKey(value);
}

export function ruleCategoryType(type: string): "支出" | "收入" | null {
  if (type === "代付") return "支出";
  if (type === "支出" || type === "收入") return type;
  return null;
}

/**
 * Existing persisted rules keep their explicit scope for compatibility. New
 * UI edits use inferRuleScopeFromConditions so the scope is still derived
 * from the two visible matching fields rather than chosen independently.
 */
export function inferRuleScope(rule: Pick<RuleRow, "match_scope" | "counterparty" | "product">): RuleMatchScope | null {
  if (rule.match_scope && RULE_SCOPES.has(rule.match_scope)) return rule.match_scope;
  if (comparable(rule.product)) return "product";
  if (comparable(rule.counterparty)) return "merchant";
  return null;
}

export function inferRuleScopeFromConditions(
  rule: Pick<RuleRow, "counterparty" | "product">
): RuleMatchScope | null {
  const hasCounterparty = Boolean(comparable(rule.counterparty));
  const hasProduct = Boolean(comparable(rule.product));
  if (hasCounterparty && hasProduct) return "merchant_product";
  if (hasProduct) return "product";
  if (hasCounterparty) return "merchant";
  return null;
}

export function ruleMatchLevel(
  rule: Pick<RuleRow, "match_scope" | "counterparty" | "product">
): RuleMatchLevel | null {
  return inferRuleScope(rule);
}

export function ruleConditionKey(rule: Pick<RuleRow, "transaction_type" | "match_scope" | "counterparty" | "product"> & RuleAmountFields): string | null {
  const scope = inferRuleScope(rule);
  if (!scope || !RULE_TYPES.has(rule.transaction_type as RuleTransactionType)) return null;
  const counterparty = scope === "merchant" || scope === "merchant_product"
    ? comparable(rule.counterparty) : "";
  const product = scope === "product" || scope === "merchant_product"
    ? comparable(rule.product) : "";
  if (scope === "product" && !product) return null;
  if (scope === "merchant" && !counterparty) return null;
  if (scope === "merchant_product" && (!counterparty || !product)) return null;
  const amount = ruleAmountBounds(rule);
  if (!amount) return null;
  return [rule.transaction_type, scope, counterparty, product, amount.min, amount.max ?? "*"].join("\u0000");
}

export function normalizeRuleDefinition(source: Partial<RuleRow>): {
  value: NormalizedRule | null;
  issues: RuleDefinitionIssue[];
} {
  const transactionType = scalarText(source.transaction_type).trim();
  const counterparty = scalarText(source.counterparty).trim();
  const product = scalarText(source.product).trim();
  const scope = source.match_scope && RULE_SCOPES.has(source.match_scope)
    ? source.match_scope
    : null;
  const rewriteMerchant = scalarText(source.rewrite_merchant).trim();
  const rewriteProduct = scalarText(source.rewrite_product).trim();
  const issues: RuleDefinitionIssue[] = [];
  if (!ruleAmountBounds(source)) {
    issues.push({ code: "invalid_amount", message: "金额条件须使用非负整数分，区间不能为空且上下限须有效" });
  }
  if (source.rewrite_empty_mode != null && !["preserve", "clear"].includes(source.rewrite_empty_mode)) {
    issues.push({ code: "invalid_rewrite_mode", message: "重写留空行为只能是保留原值或清空原值" });
  }
  if (!RULE_TYPES.has(transactionType as RuleTransactionType)) {
    issues.push({ code: "invalid_type", message: "规则收支类型只能是支出、收入或代付" });
  }
  if (!scope) {
    issues.push({ code: "invalid_scope", message: "规则匹配范围无效" });
  }
  if (!scalarText(source.category_key).trim() && !scalarText(source.category).trim()) {
    issues.push({ code: "missing_category", message: "规则必须选择目标分类" });
  }
  if (scope === "product" && !product) {
    issues.push({ code: "missing_condition", message: "商品规则必须填写商品" });
  }
  if (scope === "merchant" && !counterparty) {
    issues.push({ code: "missing_condition", message: "交易对手规则必须填写交易对手" });
  }
  if (scope === "merchant_product" && (!counterparty || !product)) {
    issues.push({ code: "missing_condition", message: "组合规则必须同时填写交易对手和商品" });
  }
  if (scope === "product" && counterparty) {
    issues.push({ code: "condition_not_allowed", message: "仅商品规则不能填写交易对手条件" });
  }
  if (scope === "merchant" && product) {
    issues.push({ code: "condition_not_allowed", message: "仅交易对手规则不能填写商品条件" });
  }
  if (issues.length || !scope || !RULE_TYPES.has(transactionType as RuleTransactionType)) {
    return { value: null, issues };
  }
  return {
    value: {
      ...source,
      transaction_type: transactionType as RuleTransactionType,
      match_scope: scope,
      match_amount_minor: source.match_amount_minor ?? null,
      match_amount_min_minor: source.match_amount_min_minor ?? null,
      match_amount_max_minor: source.match_amount_max_minor ?? null,
      match_amount_min_exclusive: Boolean(source.match_amount_min_exclusive),
      match_amount_max_exclusive: Boolean(source.match_amount_max_exclusive),
      counterparty,
      product,
      category_key: scalarText(source.category_key).trim(),
      category: scalarText(source.category).trim(),
      rewrite_merchant: rewriteMerchant,
      rewrite_product: rewriteProduct,
      rewrite_empty_mode: source.rewrite_empty_mode ?? "preserve",
      counterparty_key: comparable(counterparty),
      product_key: comparable(product)
    },
    issues: []
  };
}

interface IndexedRule {
  rule: RuleRow;
  order: number;
}

function indexKey(type: string, counterparty: string, product: string): string {
  return `${type}\u0000${counterparty}\u0000${product}`;
}

function sortIndexed(left: IndexedRule, right: IndexedRule): number {
  return left.order - right.order;
}

function appendToGroup<K, V>(groups: Map<K, V[]>, key: K, value: V): void {
  const existing = groups.get(key);
  if (existing) {
    existing.push(value);
  } else {
    groups.set(key, [value]);
  }
}

function ruleName(level: RuleMatchLevel): string {
  return level === "merchant_product"
    ? "组合规则"
    : level === "product" ? "商品规则" : "交易对手规则";
}

type MatchableTransaction = Pick<Transaction, "type" | "product"> & {
  counterparty?: string;
  amount?: number;
};

function ruleTypeForTransaction(type: string): string {
  return RULE_TYPES.has(type as RuleTransactionType) ? type : "";
}

export class RuleMatcher {
  private readonly merchantProduct = new Map<string, IndexedRule[]>();
  private readonly product = new Map<string, IndexedRule[]>();
  private readonly merchant = new Map<string, IndexedRule[]>();
  private readonly orderById = new Map<number, number>();

  constructor(rules: readonly RuleRow[]) {
    rules.forEach((rule, order) => {
      if ((rule.category_active != null && !rule.category_active)) return;
      const id = Number(rule.id);
      if (Number.isFinite(id) && id > 0) this.orderById.set(id, order);
      const scope = inferRuleScope(rule);
      const counterparty = comparable(rule.counterparty);
      const product = comparable(rule.product);
      if (!scope) return;
      const indexed = { rule, order } satisfies IndexedRule;
      if (scope === "merchant_product" && counterparty && product) {
        const key = indexKey(rule.transaction_type, counterparty, product);
        appendToGroup(this.merchantProduct, key, indexed);
      } else if (scope === "product" && product) {
        const key = indexKey(rule.transaction_type, "", product);
        appendToGroup(this.product, key, indexed);
      } else if (scope === "merchant" && counterparty) {
        const key = indexKey(rule.transaction_type, counterparty, "");
        appendToGroup(this.merchant, key, indexed);
      }
    });
  }

  orderedRuleIds(ids: Iterable<number>): number[] {
    return [...ids].sort((left, right) =>
      (this.orderById.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (this.orderById.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  matchingRules(row: MatchableTransaction): RuleRow[] {
    const counterparty = comparable(row.counterparty);
    const product = comparable(row.product);
    const transactionType = ruleTypeForTransaction(row.type);
    if (!RULE_TYPES.has(transactionType as RuleTransactionType) || (!counterparty && !product)) return [];
    const matches = [
      ...(counterparty && product
        ? this.merchantProduct.get(indexKey(transactionType, counterparty, product)) ?? []
        : []),
      ...(product ? this.product.get(indexKey(transactionType, "", product)) ?? [] : []),
      ...(counterparty ? this.merchant.get(indexKey(transactionType, counterparty, "")) ?? [] : [])
    ];
    return matches.sort(sortIndexed).map((candidate) => candidate.rule)
      .filter((rule) => matchesRuleAmount(rule, row.amount));
  }

  resolve(row: Transaction): RuleMatchExplanation {
    return this.resolveWithMatches(row, this.matchingRules(row));
  }

  /**
   * Resolve a row from a previously indexed match list. Read models that need
   * both the matched rule IDs and the final winner can avoid doing the indexed
   * lookup twice for every historical transaction.
   */
  resolveWithMatches(row: Transaction, matches: readonly RuleRow[]): RuleMatchExplanation {
    const priorities = [...new Set(matches.map(rulePriority))].sort((a, b) => b - a);
    for (const priority of priorities) {
      const candidates = matches.filter((rule) => rulePriority(rule) === priority);
      const level = ruleMatchLevel(candidates[0]);
      if (!level) continue;
      const ruleIds = candidates
        .map((candidate) => Number(candidate.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      const categories = new Set(candidates.map((candidate) =>
        comparable(candidate.category_key) || comparable(candidate.category)
      ));
      if (candidates.length > 1) {
        return {
          status: "conflict",
          level,
          rule_ids: ruleIds,
          reason: categories.size > 1
            ? `${ruleName(level)}命中了不同分类`
            : `${ruleName(level)}存在重复规则`
        };
      }
      const selected = candidates[0];
      const lowerRuleIds = matches.filter((rule) => rulePriority(rule) < priority)
        .sort((a, b) => rulePriority(b) - rulePriority(a))
        .map((rule) => Number(rule.id)).filter((id) => Number.isFinite(id) && id > 0);
      return {
        status: "matched",
        level,
        rule_ids: ruleIds,
        selected_rule_id: Number.isFinite(Number(selected.id)) ? Number(selected.id) : null,
        category_key: selected.category_key ?? null,
        category: selected.category,
        rewrite_merchant: scalarText(selected.rewrite_merchant).trim() || null,
        rewrite_product: scalarText(selected.rewrite_product).trim() || null,
        rewrite_empty_mode: selected.rewrite_empty_mode ?? "preserve",
        covered_rule_ids: lowerRuleIds,
        reason: `${ruleName(level)}确定命中${lowerRuleIds.length ? `，覆盖 ${lowerRuleIds.join("、")} ` : ""}`
      };
    }
    return {
      status: "none",
      rule_ids: [],
      selected_rule_id: null,
      reason: "没有匹配规则"
    };
  }
}

export function rulesEquivalent(left: RuleRow, right: RuleRow): boolean {
  const leftKey = ruleConditionKey(left);
  const rightKey = ruleConditionKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function findRuleConflicts(rules: readonly RuleRow[]): Array<{
  kind: "duplicate" | "same-condition" | "amount-overlap";
  rule_ids: number[];
  condition_key: string;
  description: string;
  overlap_min_minor?: number;
  overlap_max_minor?: number | null;
  rule_rows?: number[];
}> {
  const groups = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const key = ruleConditionKey(rule);
    if (!key) continue;
    appendToGroup(groups, key, rule);
  }
  const duplicates = [...groups.entries()].flatMap(([conditionKey, group]) => {
    if (group.length < 2) return [];
    const ids = group.map((rule) => Number(rule.id)).filter((id) => Number.isFinite(id) && id > 0);
    const categoryKeys = new Set(group.map((rule) => comparable(rule.category_key) || comparable(rule.category)));
    return [{
      kind: categoryKeys.size > 1 ? "same-condition" as const : "duplicate" as const,
      rule_ids: ids,
      rule_rows: group.map((rule) => rules.indexOf(rule) + 1),
      condition_key: conditionKey,
      description: categoryKeys.size > 1 ? "同一精确条件指向多个分类" : "同一精确条件存在重复规则"
    }];
  });
  const overlaps: ReturnType<typeof findRuleConflicts> = [];
  const byText = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    if (ruleAmountSpecificity(rule) !== 1) continue;
    const key = ruleConditionKey({ ...rule, ...EMPTY_RULE_AMOUNT });
    if (key) appendToGroup(byText, key, rule);
  }
  for (const [textKey, candidates] of byText) {
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]; const b = candidates[j];
        if (ruleConditionKey(a) === ruleConditionKey(b) || !amountRangesOverlap(a, b)) continue;
        const left = ruleAmountBounds(a)!; const right = ruleAmountBounds(b)!;
        const min = Math.max(left.min, right.min);
        const max = Math.min(left.max ?? Infinity, right.max ?? Infinity);
        overlaps.push({ kind: "amount-overlap", condition_key: textKey,
          rule_ids: [a.id, b.id].filter((id): id is number => id != null),
          overlap_min_minor: min, overlap_max_minor: Number.isFinite(max) ? max : null,
          rule_rows: [rules.indexOf(a) + 1, rules.indexOf(b) + 1],
          description: `第 ${rules.indexOf(a) + 1}、${rules.indexOf(b) + 1} 条规则的金额区间重叠：${(min / 100).toFixed(2)} 至 ${Number.isFinite(max) ? (max / 100).toFixed(2) : "无上限"}` });
      }
    }
  }
  return [...duplicates, ...overlaps];
}

export function detectRewriteChains(rules: readonly RuleRow[]): RuleChainIssue[] {
  const matcher = new RuleMatcher(rules);
  const issues: RuleChainIssue[] = [];
  for (const source of rules) {
    const scope = inferRuleScope(source);
    if (!scope || (!source.rewrite_merchant && !source.rewrite_product)) continue;
    const sourceBounds = ruleAmountBounds(source);
    if (!sourceBounds) continue;
    const prices = new Set([sourceBounds.min]);
    for (const rule of rules) {
      const bounds = ruleAmountBounds(rule);
      if (!bounds) continue;
      for (const boundary of [bounds.min, bounds.max == null ? null : bounds.max + 1]) {
        if (boundary != null && Number.isSafeInteger(boundary) && boundary >= sourceBounds.min
          && (sourceBounds.max == null || boundary <= sourceBounds.max)) prices.add(boundary);
      }
    }
    const targets = new Map<RuleRow, boolean>();
    for (const price of prices) {
      const row: Transaction = {
        transaction_date: "", type: source.transaction_type, category: source.category,
        ...rewriteRuleFields(source, { product: scope !== "merchant" ? source.product ?? "" : "",
          counterparty: scope !== "product" ? source.counterparty ?? "" : "" }),
        amount: price / 100
      };
      const candidates = matcher.matchingRules(row)
        .filter((target) => target !== source && (source.id == null || target.id !== source.id));
      const max = Math.max(0, ...candidates.map(rulePriority));
      candidates.filter((target) => rulePriority(target) === max).forEach((target) => {
        targets.set(target, (comparable(target.category_key) || comparable(target.category))
          !== (comparable(source.category_key) || comparable(source.category)));
      });
    }
    if (!targets.size) continue;
    const ids = [...targets.keys()].flatMap((rule) => rule.id ? [rule.id] : []);
    issues.push({ rule_id: source.id ?? null, rule_row: rules.indexOf(source) + 1,
      target_rule_rows: [...targets.keys()].map((rule) => rules.indexOf(rule) + 1), target_rule_ids: ids,
      fields: [...(source.rewrite_merchant ? ["counterparty" as const] : []), ...(source.rewrite_product ? ["product" as const] : [])],
      category_conflict: [...targets.values()].some(Boolean),
      reason: `重写结果会再次命中最高优先级规则 ${ids.join("、") || "新建规则"}` });
  }
  return issues;
}

export function resolveRule(row: Transaction, rules: RuleRow[]): RuleMatchExplanation {
  return new RuleMatcher(rules).resolve(row);
}

export function applyRulesWithIssues(
  rows: Transaction[],
  rules: RuleRow[]
): { proposed_rows: Transaction[]; issues: RuleApplicationIssue[] } {
  const matcher = new RuleMatcher(rules);
  const issues: RuleApplicationIssue[] = [];
  const proposed_rows = rows.map((row, rowIndex) => {
    const resolution = matcher.resolve(row);
    if (resolution.status === "conflict") {
      issues.push({
        row_index: rowIndex,
        row_id: row.id,
        rule_ids: resolution.rule_ids,
        reason: resolution.reason,
        level: resolution.level
      });
      return { ...row };
    }
    if (resolution.status !== "matched") return { ...row };
    return {
      ...row,
      ...rewriteRuleFields(resolution, row),
      category_key: resolution.category_key ?? null,
      category: resolution.category ?? ""
    };
  });
  return { proposed_rows, issues };
}

export function applyRules(rows: Transaction[], rules: RuleRow[]): Transaction[] {
  return applyRulesWithIssues(rows, rules).proposed_rows;
}

export function rulePriority(rule: RuleRow): number {
  const level = ruleMatchLevel(rule);
  return (ruleAmountSpecificity(rule) * 3) + (level === "merchant_product" ? 3 : level === "product" ? 2 : level === "merchant" ? 1 : 0);
}
