import type {
  RuleApplicationIssue,
  RuleChainIssue,
  RuleMatchExplanation,
  RuleMatchLevel,
  RuleMatchScope
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import { scalarText } from "./text";

export const RULE_TYPES = new Set(["支出", "收入"]);
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

export interface RuleRow {
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
}

export interface NormalizedRule extends RuleRow {
  transaction_type: "支出" | "收入";
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

export function ruleConditionKey(rule: Pick<RuleRow, "transaction_type" | "match_scope" | "counterparty" | "product">): string | null {
  const scope = inferRuleScope(rule);
  if (!scope || !RULE_TYPES.has(rule.transaction_type)) return null;
  const counterparty = scope === "merchant" || scope === "merchant_product"
    ? comparable(rule.counterparty) : "";
  const product = scope === "product" || scope === "merchant_product"
    ? comparable(rule.product) : "";
  if (scope === "product" && !product) return null;
  if (scope === "merchant" && !counterparty) return null;
  if (scope === "merchant_product" && (!counterparty || !product)) return null;
  return [rule.transaction_type, scope, counterparty, product].join("\u0000");
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
  if (!RULE_TYPES.has(transactionType)) {
    issues.push({ code: "invalid_type", message: "规则收支类型只能是支出或收入" });
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
  if (issues.length || !scope || !RULE_TYPES.has(transactionType)) {
    return { value: null, issues };
  }
  return {
    value: {
      ...source,
      transaction_type: transactionType as "支出" | "收入",
      match_scope: scope,
      counterparty,
      product,
      category_key: scalarText(source.category_key).trim(),
      category: scalarText(source.category).trim(),
      rewrite_merchant: rewriteMerchant,
      rewrite_product: rewriteProduct,
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

function ruleName(level: RuleMatchLevel): string {
  return level === "merchant_product"
    ? "组合规则"
    : level === "product" ? "商品规则" : "交易对手规则";
}

type MatchableTransaction = Pick<Transaction, "type" | "product"> & {
  counterparty?: string;
};

export class RuleMatcher {
  private readonly merchantProduct = new Map<string, IndexedRule[]>();
  private readonly product = new Map<string, IndexedRule[]>();
  private readonly merchant = new Map<string, IndexedRule[]>();
  private readonly orderById = new Map<number, number>();

  constructor(rules: readonly RuleRow[]) {
    rules.forEach((rule, order) => {
      if (rule.category_active === false) return;
      const id = Number(rule.id);
      if (Number.isFinite(id) && id > 0) this.orderById.set(id, order);
      const scope = inferRuleScope(rule);
      const counterparty = comparable(rule.counterparty);
      const product = comparable(rule.product);
      if (!scope) return;
      const indexed = { rule, order } satisfies IndexedRule;
      if (scope === "merchant_product" && counterparty && product) {
        const key = indexKey(rule.transaction_type, counterparty, product);
        this.merchantProduct.set(key, [...(this.merchantProduct.get(key) ?? []), indexed]);
      } else if (scope === "product" && product) {
        const key = indexKey(rule.transaction_type, "", product);
        this.product.set(key, [...(this.product.get(key) ?? []), indexed]);
      } else if (scope === "merchant" && counterparty) {
        const key = indexKey(rule.transaction_type, counterparty, "");
        this.merchant.set(key, [...(this.merchant.get(key) ?? []), indexed]);
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
    if (!RULE_TYPES.has(row.type) || (!counterparty && !product)) return [];
    const matches = [
      ...(counterparty && product
        ? this.merchantProduct.get(indexKey(row.type, counterparty, product)) ?? []
        : []),
      ...(product ? this.product.get(indexKey(row.type, "", product)) ?? [] : []),
      ...(counterparty ? this.merchant.get(indexKey(row.type, counterparty, "")) ?? [] : [])
    ];
    return matches.sort(sortIndexed).map((candidate) => candidate.rule);
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
    const grouped = new Map<RuleMatchLevel, RuleRow[]>();
    for (const candidate of matches) {
      const level = ruleMatchLevel(candidate);
      if (!level) continue;
      grouped.set(level, [...(grouped.get(level) ?? []), candidate]);
    }
    const levels: RuleMatchLevel[] = ["merchant_product", "product", "merchant"];
    for (const level of levels) {
      const candidates = grouped.get(level) ?? [];
      if (!candidates.length) continue;
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
      const lowerRuleIds = levels
        .filter((candidateLevel) => candidateLevel !== level)
        .flatMap((candidateLevel) => grouped.get(candidateLevel) ?? [])
        .map((candidate) => Number(candidate.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      return {
        status: "matched",
        level,
        rule_ids: ruleIds,
        selected_rule_id: Number.isFinite(Number(selected.id)) ? Number(selected.id) : null,
        category_key: selected.category_key ?? null,
        category: selected.category,
        rewrite_merchant: scalarText(selected.rewrite_merchant).trim() || null,
        rewrite_product: scalarText(selected.rewrite_product).trim() || null,
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
  kind: "duplicate" | "same-condition";
  rule_ids: number[];
  condition_key: string;
  description: string;
}> {
  const groups = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const key = ruleConditionKey(rule);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  return [...groups.entries()].flatMap(([conditionKey, group]) => {
    if (group.length < 2) return [];
    const ids = group.map((rule) => Number(rule.id)).filter((id) => Number.isFinite(id) && id > 0);
    const categoryKeys = new Set(group.map((rule) => comparable(rule.category_key) || comparable(rule.category)));
    return [{
      kind: categoryKeys.size > 1 ? "same-condition" as const : "duplicate" as const,
      rule_ids: ids,
      condition_key: conditionKey,
      description: categoryKeys.size > 1 ? "同一精确条件指向多个分类" : "同一精确条件存在重复规则"
    }];
  });
}

export function detectRewriteChains(rules: readonly RuleRow[]): RuleChainIssue[] {
  const matcher = new RuleMatcher(rules);
  const issues: RuleChainIssue[] = [];
  for (const source of rules) {
    const sourceId = Number(source.id);
    const sourceHasId = Number.isFinite(sourceId) && sourceId > 0;
    const scope = inferRuleScope(source);
    if (!scope) continue;
    const baseCounterparty = scope === "merchant" || scope === "merchant_product"
      ? scalarText(source.counterparty).trim() : "";
    const baseProduct = scope === "product" || scope === "merchant_product"
      ? scalarText(source.product).trim() : "";
    const rewriteMerchant = scalarText(source.rewrite_merchant).trim();
    const rewriteProduct = scalarText(source.rewrite_product).trim();
    if (!rewriteMerchant && !rewriteProduct) continue;
    const rewritten = {
      ...({
        transaction_date: "",
        type: source.transaction_type,
        category: source.category,
        category_key: source.category_key ?? null,
        product: rewriteProduct || baseProduct,
        counterparty: rewriteMerchant || baseCounterparty,
        amount: 0
      } satisfies Transaction)
    };
    const targetRules = matcher.matchingRules(rewritten)
      .filter((target) => target !== source && (!sourceHasId || Number(target.id) !== sourceId));
    const targetResolution = matcher.resolveWithMatches(rewritten, targetRules);
    if (targetResolution.status === "none" || !targetResolution.level) continue;
    // Only the highest-priority target level is relevant. Lower levels are
    // covered by the normal one-pass resolver and must not turn a harmless
    // normalization chain into a false conflict.
    const highestPriorityTargets = targetRules.filter((target) =>
      ruleMatchLevel(target) === targetResolution.level
    );
    const targets = highestPriorityTargets
      .map((target) => Number(target.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const sourceCategory = comparable(source.category_key) || comparable(source.category);
    const categoryConflict = highestPriorityTargets.some((target) =>
      (comparable(target.category_key) || comparable(target.category)) !== sourceCategory
    );
    if (!highestPriorityTargets.length) continue;
    const targetLabel = targets.length
      ? [...new Set(targets)].join("、")
      : "新建规则";
    issues.push({
      rule_id: sourceHasId ? sourceId : null,
      target_rule_ids: [...new Set(targets)],
      fields: [
        ...(rewriteMerchant ? ["counterparty" as const] : []),
        ...(rewriteProduct ? ["product" as const] : [])
      ],
      category_conflict: categoryConflict,
      reason: `重写结果会再次命中最高优先级规则 ${targetLabel}${categoryConflict ? "，且目标分类不同" : "，但分类相同"}`
    });
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
      counterparty: resolution.rewrite_merchant || row.counterparty || "",
      product: resolution.rewrite_product || row.product,
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
  return level === "merchant_product" ? 3 : level === "product" ? 2 : level === "merchant" ? 1 : 0;
}
