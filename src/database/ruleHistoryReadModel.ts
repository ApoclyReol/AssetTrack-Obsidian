import type { DatabaseSync } from "node:sqlite";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  HistoricalCategoryCount,
  RuleCandidate,
  RuleConflictGroup,
  RuleImpactPreview,
  RuleHealthSummary,
  HistoricalProductStat,
  RuleWorkspaceAnalytics,
  RuleWorkspaceShell,
  SavedRule
} from "../types/rules";
import type {
  ProductHistoryIndexResult,
  ProductHistoryQuery,
  ProductHistoryResult
} from "../types/history";
import type {
  Transaction
} from "../types/transactions";
import { contentRevision, text, type Row } from "./repositoryPrimitives";
import {
  RuleReportReadModel,
  type RuleReportReadContext
} from "./ruleReportReadModel";
import { ProductHistoryReadModel } from "./productHistoryReadModel";

export type RuleHistoryReadContext = RuleReportReadContext;

export class RuleHistoryReadModel {
  private readonly reports: RuleReportReadModel;
  private readonly products: ProductHistoryReadModel;

  constructor(context: RuleHistoryReadContext) {
    this.reports = new RuleReportReadModel(context);
    this.products = new ProductHistoryReadModel(
      { categoryRows: (db) => context.categoryRows(db) },
      this.reports
    );
  }

  rules(db: DatabaseSync): { revision: number; rows: Row[] } {
    return this.reports.rules(db);
  }

  normalizedRuleRows(db: DatabaseSync): ReturnType<RuleReportReadModel["normalizedRuleRows"]> {
    return this.reports.normalizedRuleRows(db);
  }

  rulesPreview(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): ReturnType<RuleReportReadModel["rulesPreview"]> {
    return this.reports.rulesPreview(db, month, input);
  }

  ruleImpactPreview(db: DatabaseSync, rule: Parameters<RuleReportReadModel["ruleImpactPreview"]>[1]): RuleImpactPreview {
    return this.reports.ruleImpactPreview(db, rule);
  }

  historicalCategoryCounts(
    group: Row[],
    categories: CategoryDefinition[]
  ): HistoricalCategoryCount[] {
    return this.products.historicalCategoryCounts(group, categories);
  }

  ruleWorkspaceShell(db: DatabaseSync): RuleWorkspaceShell {
    return this.reports.ruleWorkspaceShell(db);
  }

  ruleWorkspaceAnalytics(db: DatabaseSync, minOccurrences = 2): RuleWorkspaceAnalytics {
    const data = this.buildRuleInsights(db, minOccurrences);
    return {
      categories_revision: data.categoriesRevision,
      rules_revision: data.rules.revision,
      categories: data.categories,
      rules: data.rules.rows as unknown as SavedRule[],
      recommendations: data.recommendations,
      historical_products: data.historicalProducts,
      rule_conflicts: data.ruleConflicts,
      summary: data.summary
    };
  }

  productHistoryIndex(db: DatabaseSync, query: ProductHistoryQuery): ProductHistoryIndexResult {
    return this.products.productHistoryIndex(db, query);
  }

  productOverview(db: DatabaseSync, query: ProductHistoryQuery = {}): ProductHistoryIndexResult {
    return this.products.productOverview(db, query);
  }

  productHistory(db: DatabaseSync, query: ProductHistoryQuery): ProductHistoryResult {
    return this.products.productHistory(db, query);
  }

  ruleCandidates(
    db: DatabaseSync,
    month: string,
    draftRows: Transaction[],
    minOccurrences = 2
  ): ReturnType<RuleReportReadModel["ruleCandidates"]> {
    return this.reports.ruleCandidates(db, month, draftRows, minOccurrences);
  }

  private buildRuleInsights(
    db: DatabaseSync,
    minOccurrences: number
  ): {
    threshold: number;
    rules: ReturnType<RuleReportReadModel["rules"]>;
    categories: CategoryDefinition[];
    categoriesRevision: number;
    historicalProducts: HistoricalProductStat[];
    recommendations: RuleCandidate[];
    ruleConflicts: RuleConflictGroup[];
    summary: RuleHealthSummary;
  } {
    const requestedThreshold = Number(minOccurrences);
    const threshold = Number.isFinite(requestedThreshold)
      ? Math.max(1, Math.min(10_000, Math.trunc(requestedThreshold)))
      : 2;
    const productData = this.products.historyGroups(db, {});
    const ruleData = productData.ruleData;
    const categories = productData.categories;
    const history = productData.history;
    const ruleConflicts = this.reports.ruleConflictGroups(db, history);
    const historicalProducts = productData.stats;
    const recommendations: RuleCandidate[] = [];
    for (const stat of historicalProducts) {
      const suggestion = stat.rule_suggestion;
      if (
        !suggestion
        || !stat.product_key
        || stat.occurrences < threshold
        || stat.has_category_conflict
        || stat.rule_coverage !== "none"
        || stat.conflicted_occurrences > 0
        || stat.history_rule_mismatch
      ) continue;
      recommendations.push({
        transaction_type: stat.transaction_type,
        product: suggestion.product,
        product_key: stat.product_key,
        variants: stat.variants,
        category: suggestion.category,
        category_key: suggestion.category_key,
        category_counts: suggestion.category_counts,
        category_confidence: suggestion.category_confidence,
        has_category_conflict: stat.has_category_conflict,
        occurrences: suggestion.occurrences,
        months_count: suggestion.months_count,
        last_month: suggestion.last_month,
        match_level: "product"
      });
    }
    recommendations.sort((left, right) =>
      right.occurrences - left.occurrences
      || left.transaction_type.localeCompare(right.transaction_type)
      || left.product.localeCompare(right.product)
    );
    const conflictProducts = new Map<string, number>();
    for (const stat of historicalProducts) {
      if (!stat.has_category_conflict) continue;
      for (const category of stat.category_counts) {
        if (category.category_key) {
          conflictProducts.set(
            category.category_key,
            (conflictProducts.get(category.category_key) ?? 0) + 1
          );
        }
      }
    }
    const historicalCategoryStats = new Map<string, { count: number; months: Set<string> }>();
    for (const row of history) {
      const key = text(row.category_key);
      if (!key) continue;
      const stat = historicalCategoryStats.get(key) ?? { count: 0, months: new Set<string>() };
      stat.count += 1;
      stat.months.add(text(row.month));
      historicalCategoryStats.set(key, stat);
    }
    const ruleCounts = new Map<string, number>();
    for (const row of ruleData.data.rows) {
      const key = text(row.category_key);
      if (key) ruleCounts.set(key, (ruleCounts.get(key) ?? 0) + 1);
    }
    const enrichedCategories = categories.map((category) => {
      const historical = historicalCategoryStats.get(category.category_key);
      return {
        ...category,
        transaction_count: historical?.count ?? 0,
        impact_months: historical ? [...historical.months].sort() : [],
        rule_count: ruleCounts.get(category.category_key) ?? 0,
        conflict_product_count: conflictProducts.get(category.category_key) ?? 0
      };
    });
    const summary: RuleHealthSummary = {
      product_conflicts: historicalProducts.filter((row) => row.has_category_conflict).length,
      rule_conflicts: ruleData.data.rows.filter((row) => row.rule_status === "冲突").length,
      duplicate_rules: ruleData.data.rows.filter((row) => row.rule_status === "重复").length,
      rule_conflict_groups: ruleConflicts.filter((group) => group.kind !== "duplicate").length,
      duplicate_rule_groups: ruleConflicts.filter((group) => group.kind === "duplicate").length,
      inactive_category_transactions: history.filter((row) =>
        Boolean(text(row.category_key))
        && row.category_active !== 1 && row.category_active !== true
      ).length,
      uncategorized_transactions: history.filter((row) => !text(row.category_key)).length,
      stable_products_without_rule: historicalProducts.filter((row) =>
        Boolean(row.rule_suggestion)
      ).length,
      fully_covered_groups: historicalProducts.filter((row) => row.rule_coverage === "full").length,
      partially_covered_groups: historicalProducts.filter((row) => row.rule_coverage === "partial").length,
      uncovered_groups: historicalProducts.filter((row) => row.rule_coverage === "none").length,
      higher_priority_covered_transactions: historicalProducts.reduce(
        (total, row) => total + (row.higher_priority_covered_occurrences ?? 0),
        0
      )
    };
    return {
      threshold,
      rules: ruleData.data,
      categories: enrichedCategories,
      categoriesRevision: contentRevision(categories as unknown as Row[]),
      historicalProducts,
      recommendations,
      ruleConflicts,
      summary
    };
  }
}
