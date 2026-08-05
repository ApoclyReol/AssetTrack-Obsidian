import type { DatabaseSync } from "node:sqlite";
import type {
  CategoryDefinition,
  RuleConflictGroup,
  SavedRule,
  Transaction
} from "../types";
import {
  applyRulesWithIssues,
  normalizeProductKey,
  RuleMatcher,
  RULE_TYPES,
  type RuleRow
} from "../domain/rules";
import { roundHalfEven } from "../domain/money";
import { buildRuleReport } from "./ruleReporting";
import {
  contentRevision,
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
    const raw = rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all());
    const transactions = rows(db.prepare(`
      SELECT month,type,counterparty,product FROM transactions
      WHERE type IN ('支出','收入')
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
      counterparty: "",
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category)
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
      category: text(row.category)
    }));
    const result = applyRulesWithIssues(input, resolvedRules);
    return {
      base_revision: this.context.getRevision(month, db),
      rules_revision: ruleReport.revision,
      proposed_rows: result.proposed_rows,
      issues: result.issues as unknown as Array<Record<string, unknown>>
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
    const conditions = new Map<string, RuleRow[]>();
    for (const rule of ruleData.rows) {
      const product = normalizeProductKey(rule.product);
      if (!product) continue;
      const key = `${rule.transaction_type}\u0000${product}`;
      conditions.set(key, [...(conditions.get(key) ?? []), rule]);
    }
    for (const componentRows of conditions.values()) {
      if (componentRows.length < 2) continue;
      const categoryKeys = new Set(componentRows.map((rule) =>
        normalizeProductKey(rule.category_key) || normalizeProductKey(rule.category)
      ));
      const kind: RuleConflictGroup["kind"] = categoryKeys.size > 1
        ? "same-condition"
        : "duplicate";
      const component = componentRows
        .map((rule) => Number(rule.id))
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
        conflict_key: `${kind}:${component.join(",")}`,
        kind,
        rule_ids: component,
        rules: componentRules,
        affected_transaction_count: affected.length,
        affected_months: [...new Set(affected.map((row) => text(row.month)))].sort(),
        description: kind === "duplicate"
          ? "同一商品存在多个相同分类的规则"
          : "同一商品对应多个分类规则"
      });
    }
    return groups.sort((left, right) =>
      left.kind.localeCompare(right.kind)
      || right.affected_transaction_count - left.affected_transaction_count
      || left.conflict_key.localeCompare(right.conflict_key)
    );
  }

  rawRuleDefinitions(db: DatabaseSync): SavedRule[] {
    return rows(db.prepare("SELECT * FROM auto_rules ORDER BY id").all()).map((row) => ({
      id: Number(row.id),
      transaction_type: text(row.transaction_type) as "支出" | "收入",
      product: text(row.product),
      category_key: text(row.category_key),
      category: text(row.category)
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
        SELECT month,type,category,product FROM transactions
        WHERE month<>? AND type IN ('支出','收入')
          AND TRIM(COALESCE(product,''))<>''
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
