import type { DatabaseSync } from "node:sqlite";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  HistoricalCategoryCount,
  HistoricalProductStat,
  RuleMatchLevel
} from "../types/rules";
import type {
  ProductHistoryIndexResult,
  ProductHistoryQuery,
  ProductHistoryResult
} from "../types/history";
import type {
  Transaction
} from "../types/transactions";
import { normalizeProductKey, RuleMatcher, ruleMatchLevel } from "../domain/rules";
import { roundHalfEven } from "../domain/money";
import {
  createDateReadWindow,
  PRODUCT_OVERVIEW_MONTHS,
  recentMonthReadWindow,
  SYSTEM_CHECK_MONTHS
} from "../domain/readWindows";
import { scalarText } from "../domain/text";
import { RuleReportReadModel } from "./ruleReportReadModel";
import { transactionWindowPredicate } from "./readWindowSql";
import type { ReadWindow, ReadWindowKind } from "../types/readWindows";
import {
  boolean,
  contentRevision,
  RepositoryValidationError,
  rows,
  text,
  type Row
} from "./repositoryPrimitives";

export interface ProductHistoryReadContext {
  categoryDefinitions(db: DatabaseSync): CategoryDefinition[];
  savedMonths(db: DatabaseSync): string[];
}

export class ProductHistoryReadModel {
  constructor(
    private readonly context: ProductHistoryReadContext,
    private readonly ruleReports: RuleReportReadModel
  ) {}

  private historyRows(db: DatabaseSync, query: ProductHistoryQuery, window: ReadWindow): Row[] {
    const windowPredicate = transactionWindowPredicate(window);
    const conditions = ["t.type IN ('支出','收入')", windowPredicate.sql];
    const parameters: string[] = [...windowPredicate.parameters];
    if (query.transaction_type) {
      conditions.push("t.type=?");
      parameters.push(query.transaction_type);
    }
    if (query.category_key !== undefined) {
      if (query.category_key === null) {
        conditions.push("COALESCE(t.category_key,'')=''");
      } else {
        conditions.push("t.category_key=?");
        parameters.push(query.category_key);
      }
    }
    if (query.from_date) {
      conditions.push("t.transaction_date>=?");
      parameters.push(query.from_date);
    }
    if (query.to_date) {
      conditions.push("t.transaction_date<=?");
      parameters.push(query.to_date);
    }
    const productSearch = scalarText(query.product_search).trim();
    if (productSearch) {
      conditions.push("asset_track_normalize_match_key(COALESCE(t.product,'')) LIKE '%' || asset_track_normalize_match_key(?) || '%'");
      parameters.push(productSearch);
    }
    const counterpartySearch = scalarText(query.counterparty_search).trim();
    if (counterpartySearch) {
      conditions.push("asset_track_normalize_match_key(COALESCE(t.counterparty,'')) LIKE '%' || asset_track_normalize_match_key(?) || '%'");
      parameters.push(counterpartySearch);
    }
    const history = rows(db.prepare(`
      SELECT t.id,t.month,t.transaction_date,t.type,t.category_key,t.category,
             t.counterparty,t.product,t.amount,d.is_active AS category_active
      FROM transactions t
      JOIN month_status m ON m.month=t.month AND m.status IN ('saved','locked')
      LEFT JOIN category_definitions d ON d.category_key=t.category_key
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.type,t.product,t.month,t.transaction_date,t.id
    `).all(...parameters));
    const normalizedSearch = normalizeProductKey(productSearch);
    const normalizedCounterpartySearch = normalizeProductKey(counterpartySearch);
    const groupBy = query.group_by ?? "product";
    return history.filter((row) => {
      if (query.transaction_type && text(row.type) !== query.transaction_type) return false;
      if (query.product_key !== undefined
        && normalizeProductKey(groupBy === "counterparty" ? row.counterparty : row.product)
          !== normalizeProductKey(query.product_key)) return false;
      if (query.category_key !== undefined) {
        const key = text(row.category_key);
        if (query.category_key === null ? key : key !== query.category_key) return false;
      }
      if (query.from_date && text(row.transaction_date) < query.from_date) return false;
      if (query.to_date && text(row.transaction_date) > query.to_date) return false;
      if (normalizedSearch && !normalizeProductKey(row.product).includes(normalizedSearch)) return false;
      if (normalizedCounterpartySearch && !normalizeProductKey(row.counterparty).includes(normalizedCounterpartySearch)) return false;
      return true;
    });
  }

  historicalCategoryCounts(
    group: Row[],
    categories: CategoryDefinition[]
  ): HistoricalCategoryCount[] {
    const byKey = new Map(categories.map((category) => [category.category_key, category]));
    const counts = new Map<string, HistoricalCategoryCount>();
    for (const row of group) {
      const categoryKey = text(row.category_key) || null;
      const definition = categoryKey ? byKey.get(categoryKey) : undefined;
      const key = categoryKey ?? "__uncategorized__";
      const current = counts.get(key) ?? {
        category_key: categoryKey,
        category: definition?.name ?? (text(row.category) || "未分类"),
        occurrences: 0,
        is_active: categoryKey ? definition?.is_active ?? false : undefined
      };
      current.occurrences += 1;
      counts.set(key, current);
    }
    return [...counts.values()].sort((left, right) =>
      right.occurrences - left.occurrences
      || left.category.localeCompare(right.category)
    );
  }

  private productCategoryStatus(
    counts: HistoricalCategoryCount[]
  ): HistoricalProductStat["category_status"] {
    const assigned = counts.filter((row) => row.category_key);
    const hasUncategorized = counts.some((row) => !row.category_key);
    const hasInactive = assigned.some((row) => row.is_active === false);
    if (!assigned.length) return "未分类";
    if (assigned.length > 1 || hasUncategorized) return "混合";
    if (hasInactive) return "停用";
    return "正常";
  }

  private productStat(
    group: Row[],
    ruleMatcher: RuleMatcher,
    ruleStatusById: Map<number, string>,
    categories: CategoryDefinition[],
    groupBy: "product" | "counterparty"
  ): HistoricalProductStat {
    const ordered = [...group].sort((left, right) =>
      text(left.month).localeCompare(text(right.month))
      || text(left.transaction_date).localeCompare(text(right.transaction_date))
      || Number(left.id ?? 0) - Number(right.id ?? 0)
    );
    const representative = ordered[0];
    const productVariants = this.frequency(group.map((row) => text(row.product)))
      .map(([value]) => value)
      .filter(Boolean);
    const counterpartyVariants = this.frequency(group.map((row) => text(row.counterparty)))
      .map(([value]) => value)
      .filter(Boolean);
    const variants = groupBy === "counterparty" ? counterpartyVariants : productVariants;
    const counterparties = this.frequency(
      group.map((row) => text(row.counterparty)).filter(Boolean)
    ).map(([value]) => value);
    const categoryCounts = this.historicalCategoryCounts(group, categories);
    const assigned = categoryCounts.filter((row) => row.category_key);
    const recommended = assigned[0];
    const transactions = ordered.map((row) => ({
      id: Number(row.id),
      transaction_date: text(row.transaction_date),
      type: text(row.type),
      category_key: text(row.category_key) || null,
      category: text(row.category),
      counterparty: text(row.counterparty),
      product: text(row.product),
      amount: Number(row.amount ?? 0)
    } satisfies Transaction));
    const matchingRuleIds = new Set<number>();
    const matchingRuleLevels = new Set<RuleMatchLevel>();
    const resolutions = transactions.map((transaction) => {
      const matches = ruleMatcher.matchingRules(transaction);
      for (const rule of matches) {
        const id = Number(rule.id);
        if (Number.isFinite(id) && id > 0) matchingRuleIds.add(id);
        const level = ruleMatchLevel(rule);
        if (level) matchingRuleLevels.add(level);
      }
      return ruleMatcher.resolveWithMatches(transaction, matches);
    });
    const orderedMatchingRuleIds = ruleMatcher.orderedRuleIds(matchingRuleIds);
    const ruleIds = [...new Set([
      ...resolutions.flatMap((resolution) => resolution.rule_ids),
      ...orderedMatchingRuleIds
    ])];
    const matchedOccurrences = resolutions.filter(
      (resolution) => resolution.status === "matched"
    ).length;
    const unmatchedRows = ordered.filter(
      (_row, index) => resolutions[index].status === "none"
    );
    const unmatchedOccurrences = unmatchedRows.length;
    const conflictedOccurrences = resolutions.filter(
      (resolution) => resolution.status === "conflict"
    ).length;
    const higherPriorityCoveredOccurrences = resolutions.filter(
      (resolution) => (resolution.covered_rule_ids?.length ?? 0) > 0
    ).length;
    const ruleCoverage: HistoricalProductStat["rule_coverage"] =
      matchedOccurrences === ordered.length
        ? "full"
        : matchedOccurrences > 0
          ? "partial"
          : "none";
    const hasRuleConflict = resolutions.some((resolution) => resolution.status === "conflict")
      || ruleIds.some((id) => ruleStatusById.get(id) === "冲突");
    const hasRuleDuplicate = ruleIds.some((id) => ruleStatusById.get(id) === "重复");
    const historyRuleMismatch = ordered.some((row, index) => {
      const resolution = resolutions[index];
      return resolution.status === "matched"
        && (resolution.category_key ?? "") !== text(row.category_key);
    });
    const ruleStatus: HistoricalProductStat["rule_status"] = hasRuleConflict
      ? "冲突"
      : hasRuleDuplicate
        ? "重复"
        : ruleIds.length
          ? "已覆盖"
          : "未创建";
    const totalAmount = group.reduce((total, row) => total + Number(row.amount ?? 0), 0);
    const last = ordered.at(-1) ?? representative;
    const unmatchedCategoryCounts = this.historicalCategoryCounts(
      unmatchedRows,
      categories
    );
    const unmatchedAssigned = unmatchedCategoryCounts.filter(
      (row) => row.category_key
    );
    const unmatchedRecommended = unmatchedAssigned[0];
    const stableUnmatchedCategory = unmatchedAssigned.length === 1
      && unmatchedAssigned[0].occurrences === unmatchedRows.length
      && Boolean(unmatchedRecommended?.category_key);
    const unmatchedVariants = this.frequency(
      unmatchedRows.map((row) => text(groupBy === "counterparty" ? row.counterparty : row.product))
    ).map(([value]) => value).filter(Boolean);
    const suggestedProduct = groupBy === "product" ? unmatchedVariants[0] ?? "" : "";
    const suggestedCounterparty = groupBy === "counterparty" ? unmatchedVariants[0] ?? "" : "";
    const ruleSuggestion = !hasRuleConflict
      && unmatchedOccurrences > 0
      && stableUnmatchedCategory
      && (groupBy === "product" ? suggestedProduct : suggestedCounterparty)
      ? {
          transaction_type: text(representative.type) as "支出" | "收入",
          match_scope: groupBy === "counterparty" ? "merchant" as const : "product" as const,
          counterparty: suggestedCounterparty,
          product: suggestedProduct,
          category_key: unmatchedRecommended?.category_key ?? "",
          category: unmatchedRecommended?.category ?? "",
          variants: unmatchedVariants,
          category_counts: unmatchedCategoryCounts,
          category_confidence: roundHalfEven(
            (unmatchedRecommended?.occurrences ?? 0) / unmatchedRows.length,
            4
          ),
          occurrences: unmatchedOccurrences,
          months_count: new Set(
            unmatchedRows.map((row) => text(row.month))
          ).size,
          last_month: text(unmatchedRows.at(-1)?.month)
        }
      : undefined;
    return {
      group_by: groupBy,
      transaction_type: text(representative.type) as "支出" | "收入",
      product_key: normalizeProductKey(groupBy === "counterparty"
        ? representative.counterparty
        : representative.product),
      product: variants[0] ?? "",
      counterparty: counterparties[0] ?? "",
      variants,
      counterparties,
      counterparty_count: counterparties.length,
      category_counts: categoryCounts,
      recommended_category: recommended?.category ?? "",
      recommended_category_key: recommended?.category_key ?? null,
      category_confidence: recommended
        ? roundHalfEven(recommended.occurrences / group.length, 4)
        : 0,
      has_category_conflict: assigned.length > 1,
      category_status: this.productCategoryStatus(categoryCounts),
      occurrences: group.length,
      months_count: new Set(group.map((row) => text(row.month))).size,
      total_amount: roundHalfEven(totalAmount),
      average_amount: roundHalfEven(totalAmount / group.length),
      latest_amount: roundHalfEven(Number(last.amount ?? 0)),
      last_date: text(last.transaction_date),
      first_month: text(ordered[0]?.month),
      last_month: text(last.month),
      matching_rule_count: ruleIds.length,
      matching_rule_ids: ruleIds,
      matching_rule_levels: [...matchingRuleLevels],
      rule_coverage: ruleCoverage,
      matched_occurrences: matchedOccurrences,
      unmatched_occurrences: unmatchedOccurrences,
      conflicted_occurrences: conflictedOccurrences,
      higher_priority_covered_occurrences: higherPriorityCoveredOccurrences,
      rule_suggestion: ruleSuggestion,
      rule_status: ruleStatus,
      history_rule_mismatch: historyRuleMismatch
    };
  }

  private hasProductHistoryFilter(query: ProductHistoryQuery): boolean {
    return Boolean(
      query.transaction_type
      || query.product_key !== undefined
      || query.category_key !== undefined
      || scalarText(query.product_search).trim()
      || scalarText(query.counterparty_search).trim()
      || query.issue_filter
      || query.from_date
      || query.to_date
      || query.min_occurrences !== undefined
    );
  }

  private historyStatMatchesFilter(
    stat: HistoricalProductStat,
    filter: ProductHistoryQuery["issue_filter"]
  ): boolean {
    if (!filter) return true;
    const hasInactive = stat.category_counts.some(
      (category) => Boolean(category.category_key) && category.is_active === false
    );
    const hasUncategorized = stat.category_counts.some((category) => !category.category_key);
    switch (filter) {
      case "conflict": return stat.has_category_conflict;
      case "rule-conflict": return stat.rule_status === "冲突";
      case "duplicate": return stat.rule_status === "重复";
      case "inactive": return hasInactive;
      case "uncategorized": return hasUncategorized;
      case "no-rule": return stat.unmatched_occurrences > 0;
      case "mismatch": return stat.history_rule_mismatch;
    }
  }

  historyGroups(
    db: DatabaseSync,
    query: ProductHistoryQuery,
    defaultWindowKind: ReadWindowKind = "system-check"
  ): {
    ruleData: ReturnType<RuleReportReadModel["normalizedRuleRows"]>;
    categories: CategoryDefinition[];
    history: Row[];
    stats: HistoricalProductStat[];
    scope: ReadWindow | null;
  } {
    const scope = this.resolveWindow(db, query, defaultWindowKind);
    const categories = this.context.categoryDefinitions(db);
    const groupBy = query.group_by ?? "product";
    const history = scope
      ? this.historyRows(db, {
          ...query,
          from_date: scope.from_date,
          to_date: scope.to_date,
          group_by: query.group_by,
          product_key: query.product_key === undefined
            ? undefined
            : normalizeProductKey(query.product_key)
        }, scope)
      : [];
    const ruleData = this.ruleReports.normalizedRuleRows(db, scope, history);
    const groups = new Map<string, Row[]>();
    for (const row of history) {
      const key = [
        text(row.type),
        normalizeProductKey(groupBy === "counterparty" ? row.counterparty : row.product)
      ].join("\u0000");
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const stats = [...groups.values()]
      .map((group) => this.productStat(
        group,
        ruleData.matcher,
        ruleData.statusById,
        categories,
        groupBy
      ))
      .filter((stat) =>
        (query.min_occurrences === undefined || stat.occurrences >= query.min_occurrences)
        && this.historyStatMatchesFilter(stat, query.issue_filter)
      );
    return { ruleData, categories, history, stats, scope };
  }

  productHistoryIndex(db: DatabaseSync, query: ProductHistoryQuery): ProductHistoryIndexResult {
    if (!this.hasProductHistoryFilter(query)) {
      throw new RepositoryValidationError({ code: "history.filter_required" });
    }
    const data = this.historyGroups(db, query);
    return {
      categories_revision: contentRevision(data.categories as unknown as Row[]),
      rules_revision: data.ruleData.data.revision,
      scope: data.scope,
      group_by: query.group_by ?? "product",
      groups: data.stats
    };
  }

  productOverview(db: DatabaseSync, query: ProductHistoryQuery = {}): ProductHistoryIndexResult {
    const data = this.historyGroups(db, query, "analysis");
    return {
      categories_revision: contentRevision(data.categories as unknown as Row[]),
      rules_revision: data.ruleData.data.revision,
      scope: data.scope,
      group_by: query.group_by ?? "product",
      groups: data.stats
    };
  }

  productHistory(db: DatabaseSync, query: ProductHistoryQuery): ProductHistoryResult {
    if (!this.hasProductHistoryFilter(query)) {
      throw new RepositoryValidationError({ code: "history.filter_required" });
    }
    const data = this.historyGroups(db, query);
    const { ruleData, history, stats } = data;
    const groupBy = query.group_by ?? "product";
    const allowedGroups = new Set(stats.map((stat) =>
      `${stat.transaction_type}\u0000${stat.product_key}`
    ));
    const detailRows = history
      .filter((row) => allowedGroups.has(`${text(row.type)}\u0000${normalizeProductKey(groupBy === "counterparty" ? row.counterparty : row.product)}`))
      .map((row) => {
      const transaction: Transaction = {
        id: Number(row.id),
        transaction_date: text(row.transaction_date),
        type: text(row.type),
        category_key: text(row.category_key) || null,
        category: text(row.category),
        counterparty: text(row.counterparty),
        product: text(row.product),
        amount: Number(row.amount ?? 0)
      };
      const ruleMatch = ruleData.matcher.resolve(transaction);
      const categoryActive = row.category_active === null || row.category_active === undefined
        ? null
        : boolean(row.category_active);
      return {
        id: transaction.id ?? 0,
        month: text(row.month),
        transaction_date: transaction.transaction_date,
        type: transaction.type as "支出" | "收入",
        category_key: transaction.category_key ?? null,
        category: transaction.category,
        category_active: categoryActive,
        counterparty: transaction.counterparty ?? "",
        product: transaction.product,
        amount: transaction.amount,
        rule_match: ruleMatch
      };
      });
    return { scope: data.scope, groups: stats, rows: detailRows };
  }

  private resolveWindow(
    db: DatabaseSync,
    query: ProductHistoryQuery,
    defaultWindowKind: ReadWindowKind
  ): ReadWindow | null {
    const hasFrom = Boolean(query.from_date);
    const hasTo = Boolean(query.to_date);
    if (hasFrom !== hasTo) {
      throw new RepositoryValidationError({ code: "history.date_range_incomplete" });
    }
    if (hasFrom && hasTo) {
      const scope = createDateReadWindow("analysis", query.from_date!, query.to_date!);
      if (scope.from_date > scope.to_date) {
        throw new RepositoryValidationError({ code: "history.date_range_invalid" });
      }
      return scope;
    }
    const latestMonth = this.context.savedMonths(db).sort().at(-1);
    return recentMonthReadWindow(
      defaultWindowKind,
      latestMonth,
      defaultWindowKind === "analysis" ? PRODUCT_OVERVIEW_MONTHS : SYSTEM_CHECK_MONTHS
    );
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
