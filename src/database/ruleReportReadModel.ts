import type { DatabaseSync } from "node:sqlite";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  RuleConflictGroup,
  RuleImpactPreview,
  SavedRule
} from "../types/rules";
import type {
  Transaction
} from "../types/transactions";
import {
  applyRulesWithIssues,
  detectRewriteChains,
  findRuleConflicts,
  ruleConditionKey,
  normalizeProductKey,
  normalizeRuleDefinition,
  RuleMatcher,
  ruleMatchLevel,
  RULE_TYPES,
  type RuleRow
} from "../domain/rules";
import { roundHalfEven } from "../domain/money";
import { buildRuleReport } from "./ruleReporting";
import {
  contentRevision,
  RepositoryValidationError,
  rows,
  text,
  transactionFromRow,
  type Row
} from "./repositoryPrimitives";

export interface RuleReportReadContext {
  categoryRows(db: DatabaseSync): CategoryDefinition[];
  categories(db: DatabaseSync): { revision: number; rows: CategoryDefinition[] };
  getRevision(month: string, db: DatabaseSync): number;
}

export class RuleReportReadModel {
  constructor(private readonly context: RuleReportReadContext) {}

  rules(db: DatabaseSync): { revision: number; rows: Row[] } {
    const raw = rows(db.prepare(`
      SELECT r.*,d.is_active AS category_active
      FROM auto_rules r
      LEFT JOIN category_definitions d ON d.category_key=r.category_key
      ORDER BY r.id
    `).all());
    const transactions = rows(db.prepare(`
      SELECT t.month,t.transaction_date,t.type,t.counterparty,t.product FROM transactions t
      JOIN month_status m ON m.month=t.month AND m.status='saved'
      WHERE t.type IN ('支出','收入')
    `).all());
    return buildRuleReport(raw, transactions);
  }

  normalizedRuleRows(db: DatabaseSync): {
    data: ReturnType<RuleReportReadModel["rules"]>;
    rows: RuleRow[];
    matcher: RuleMatcher;
    statusById: Map<number, string>;
  } {
    const data = this.rules(db);
    const ruleRows = data.rows.map((row) => ({
      id: Number(row.id),
      transaction_type: text(row.transaction_type),
      match_scope: text(row.match_scope) as RuleRow["match_scope"],
      counterparty: text(row.counterparty),
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category),
      category_active: row.category_active === undefined ? undefined : Boolean(row.category_active),
      rewrite_merchant: text(row.rewrite_merchant),
      rewrite_product: text(row.rewrite_product)
    } satisfies RuleRow));
    return {
      data,
      rows: ruleRows,
      matcher: new RuleMatcher(ruleRows),
      statusById: new Map(data.rows.map((row) => [Number(row.id), text(row.rule_status)]))
    };
  }

  rulesPreview(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): {
    base_revision: number;
    rules_revision: number;
    proposed_rows: Transaction[];
    issues: Array<Record<string, unknown>>;
  } {
    const ruleReport = this.rules(db);
    const resolvedRules = ruleReport.rows.map((row) => ({
      id: Number(row.id),
      transaction_type: text(row.transaction_type),
      counterparty: text(row.counterparty),
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category),
      category_active: row.category_active === undefined ? undefined : Boolean(row.category_active),
      match_scope: text(row.match_scope) as RuleRow["match_scope"],
      rewrite_merchant: text(row.rewrite_merchant),
      rewrite_product: text(row.rewrite_product)
    }));
    const result = applyRulesWithIssues(input, resolvedRules);
    return {
      base_revision: this.context.getRevision(month, db),
      rules_revision: ruleReport.revision,
      proposed_rows: result.proposed_rows,
      issues: result.issues as unknown as Array<Record<string, unknown>>
    };
  }

  ruleImpactPreview(db: DatabaseSync, rule: RuleRow): RuleImpactPreview {
    const ruleData = this.normalizedRuleRows(db);
    const categories = this.context.categoryRows(db);
    const category = categories.find((item) => item.category_key === text(rule.category_key));
    const normalized = normalizeRuleDefinition({
      ...rule,
      category_key: category?.category_key ?? rule.category_key,
      category: category?.name ?? rule.category
    });
    if (!normalized.value) {
      throw new RepositoryValidationError({
        code: "rule.impact_invalid",
        params: { issues: normalized.issues }
      });
    }
    if (!category) {
      throw new RepositoryValidationError({ code: "rule.impact_category_missing" });
    }
    if (category.transaction_type !== normalized.value.transaction_type) {
      throw new RepositoryValidationError({ code: "rule.impact_category_type_mismatch" });
    }
    if (!category.is_active) {
      throw new RepositoryValidationError({ code: "rule.impact_category_inactive" });
    }
    const candidate = normalized.value;
    const candidateId = Number(candidate.id);
    const candidateSet = [
      ...ruleData.rows.filter((current) => Number(current.id) !== candidateId),
      candidate
    ];
    const conflicts = findRuleConflicts(candidateSet);
    if (conflicts.length) {
      const conflict = conflicts[0];
      throw new RepositoryValidationError({
        code: "rule.impact_conflict",
        params: { description: conflict.description, rule_ids: conflict.rule_ids }
      });
    }
    const chains = detectRewriteChains(candidateSet);
    if (chains.length) {
      const chain = chains[0];
      throw new RepositoryValidationError({
        code: "rule.impact_rewrite_chain",
        params: { reason: chain.reason, rule_id: chain.rule_id ?? null }
      });
    }
    const conditionKey = ruleConditionKey(candidate);
    if (!conditionKey) {
      return {
        transaction_count: 0,
        months: [],
        category_counts: [],
        existing_rule_ids: [],
        higher_priority_rule_count: 0
      };
    }
    const historyRows = rows(db.prepare(`
      SELECT t.month,t.type,t.counterparty,t.product,t.category_key,t.category
      FROM transactions t
      JOIN month_status m ON m.month=t.month AND m.status='saved'
      WHERE t.type IN ('支出','收入')
      ORDER BY t.month,t.id
    `).all());
    const affected = historyRows.filter((row) => ruleConditionKey({
      transaction_type: text(row.type),
      match_scope: candidate.match_scope,
      counterparty: text(row.counterparty),
      product: text(row.product)
    }) === conditionKey);
    const counts = new Map<string, { category_key: string | null; category: string; occurrences: number }>();
    affected.forEach((row) => {
      const key = text(row.category_key) || "__uncategorized__";
      const current = counts.get(key) ?? {
        category_key: text(row.category_key) || null,
        category: text(row.category) || "未分类",
        occurrences: 0
      };
      current.occurrences += 1;
      counts.set(key, current);
    });
    const priority: Record<string, number> = { merchant_product: 3, product: 2, merchant: 1 };
    const candidateLevel = priority[candidate.match_scope] ?? 0;
    const higherPriority = affected.filter((row) => ruleData.matcher.matchingRules({
      type: text(row.type),
      counterparty: text(row.counterparty),
      product: text(row.product)
    }).some((candidate) => {
      const level = ruleMatchLevel(candidate);
      return level && (priority[level] ?? 0) > candidateLevel;
    })).length;
    return {
      transaction_count: affected.length,
      months: [...new Set(affected.map((row) => text(row.month)))].sort(),
      category_counts: [...counts.values()].map((row) => row),
      existing_rule_ids: ruleData.rows
        .filter((candidate) => Number(candidate.id) !== candidateId)
        .filter((candidate) => ruleConditionKey(candidate) === conditionKey)
        .map((candidate) => Number(candidate.id))
        .filter((id) => Number.isFinite(id) && id > 0),
      higher_priority_rule_count: higherPriority
    };
  }

  ruleConflictGroups(
    db: DatabaseSync,
    history: Row[]
  ): RuleConflictGroup[] {
    const ruleData = this.normalizedRuleRows(db);
    const savedRules = ruleData.data.rows as unknown as SavedRule[];
    const savedById = new Map(savedRules.map((rule) => [Number(rule.id), rule]));
    const groups: RuleConflictGroup[] = [];
    for (const conflict of findRuleConflicts(ruleData.rows)) {
      const component = conflict.rule_ids
        .filter((id) => Number.isFinite(id) && id > 0)
        .sort((left, right) => left - right);
      const componentRules = component
        .map((id) => savedById.get(id))
        .filter((rule): rule is SavedRule => Boolean(rule));
      const componentRuleIds = new Set(component);
      const affected = history.filter((row) => ruleData.matcher.matchingRules(
        transactionFromRow(row)
      ).some((rule) => componentRuleIds.has(Number(rule.id))));
      groups.push({
        conflict_key: `${conflict.kind}:${component.join(",")}`,
        kind: conflict.kind,
        rule_ids: component,
        rules: componentRules,
        affected_transaction_count: affected.length,
        affected_months: [...new Set(affected.map((row) => text(row.month)))].sort(),
        description: conflict.description
      });
    }
    for (const chain of detectRewriteChains(ruleData.rows)) {
      if (chain.rule_id === null) continue;
      const component = [chain.rule_id, ...chain.target_rule_ids]
        .filter((id, index, values) => values.indexOf(id) === index)
        .sort((left, right) => left - right);
      const componentRuleIds = new Set(component);
      const affected = history.filter((row) => ruleData.matcher.matchingRules(
        transactionFromRow(row)
      ).some((rule) => componentRuleIds.has(Number(rule.id))));
      groups.push({
        conflict_key: `rewrite-chain:${component.join(",")}`,
        kind: "rewrite-chain",
        rule_ids: component,
        rules: component.map((id) => savedById.get(id)).filter((rule): rule is SavedRule => Boolean(rule)),
        affected_transaction_count: affected.length,
        affected_months: [...new Set(affected.map((row) => text(row.month)))].sort(),
        description: chain.reason
      });
    }
    return groups.sort((left, right) =>
      left.kind.localeCompare(right.kind)
      || right.affected_transaction_count - left.affected_transaction_count
      || left.conflict_key.localeCompare(right.conflict_key)
    );
  }

  rawRuleDefinitions(db: DatabaseSync): SavedRule[] {
    return rows(db.prepare(`
      SELECT r.*,d.is_active AS category_active
      FROM auto_rules r
      LEFT JOIN category_definitions d ON d.category_key=r.category_key
      ORDER BY r.id
    `).all()).map((row) => ({
      id: Number(row.id),
      transaction_type: text(row.transaction_type) as "支出" | "收入",
      match_scope: text(row.match_scope) as "product" | "merchant" | "merchant_product",
      counterparty: text(row.match_scope) === "product" ? "" : text(row.counterparty),
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category),
      category_active: row.category_active === undefined ? undefined : Boolean(row.category_active),
      rewrite_merchant: text(row.rewrite_merchant),
      rewrite_product: text(row.rewrite_product)
    }));
  }

  ruleWorkspaceShell(db: DatabaseSync) {
    const categoryData = this.context.categories(db);
    const rawRules = rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all());
    return {
      categories_revision: categoryData.revision,
      rules_revision: contentRevision(rawRules),
      categories: categoryData.rows,
      rules: this.rawRuleDefinitions(db)
    };
  }

  ruleCandidates(
    db: DatabaseSync,
    month: string,
    draftRows: Transaction[],
    minOccurrences = 2
  ) {
    const requestedThreshold = Number(minOccurrences);
    const threshold = Number.isFinite(requestedThreshold)
      ? Math.max(1, Math.min(10_000, Math.trunc(requestedThreshold)))
      : 2;
    const ruleData = this.rules(db);
    const combined = [
      ...rows(db.prepare(`
        SELECT t.month,t.type,t.category,t.product FROM transactions t
        JOIN month_status m ON m.month=t.month AND m.status='saved'
        WHERE t.month<>? AND t.type IN ('支出','收入')
          AND TRIM(COALESCE(t.product,''))<>''
      `).all(month)),
      ...draftRows.filter(
        (row) =>
          RULE_TYPES.has(row.type)
          && text(row.product)
      ).map((row) => ({ month, ...row }))
    ];
    const grouped = new Map<string, Row[]>();
    combined.forEach((row) => {
      const key = [
        text(row.type),
        normalizeProductKey(row.product)
      ].join("\u0000");
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    });
    const metadata = new Map(this.context.categoryRows(db).map((row) => [row.name, row]));
    const result: Array<{
      transaction_type: "支出" | "收入";
      product: string;
      variants: string[];
      category: string;
      category_confidence: number;
      has_category_conflict: boolean;
      occurrences: number;
      months_count: number;
      last_month: string;
    }> = [];
    for (const [key, group] of grouped) {
      if (group.length < threshold) continue;
      const type = key.split("\u0000", 1)[0] as "支出" | "收入";
      const representative = group[0];
      if (ruleData.rows.some((rule) =>
        text(rule.transaction_type) === type
        && normalizeProductKey(rule.product)
          === normalizeProductKey(representative.product)
      )) {
        continue;
      }
      const variants = this.frequency(group.map((row) => text(row.product)));
      const categoryValues = group.map((row) => text(row.category)).filter(
        (category) => metadata.get(category)?.transaction_type === type
      );
      const categories = this.frequency(categoryValues);
      const category = categories[0]?.[0] ?? "";
      result.push({
        transaction_type: type,
        product: variants[0]?.[0] ?? "",
        variants: variants.map(([value]) => value).filter(Boolean),
        category,
        category_confidence: category
          ? roundHalfEven((categories[0]?.[1] ?? 0) / group.length, 4)
          : 0,
        has_category_conflict: categories.length > 1,
        occurrences: group.length,
        months_count: new Set(group.map((row) => text(row.month) || month)).size,
        last_month: group.map((row) => text(row.month) || month).sort().at(-1)!
      });
    }
    result.sort((left, right) =>
      right.occurrences - left.occurrences
      || left.transaction_type.localeCompare(right.transaction_type)
      || left.product.localeCompare(right.product)
    );
    return {
      month,
      rules_revision: ruleData.revision,
      min_occurrences: threshold,
      rows: result
    };
  }

  private frequency(values: string[]): Array<[string, number]> {
    const counts = new Map<string, { count: number; first: number }>();
    values.forEach((value, index) => {
      const existing = counts.get(value) ?? { count: 0, first: index };
      existing.count += 1;
      counts.set(value, existing);
    });
    return [...counts].sort((left, right) =>
      right[1].count - left[1].count || left[1].first - right[1].first
    ).map(([value, stats]) => [value, stats.count]);
  }
}
