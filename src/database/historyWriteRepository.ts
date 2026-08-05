import type { DatabaseSync } from "node:sqlite";
import type {
  CategoryBackfillPreview,
  CategoryBackfillRequest,
  CategoryBackfillResult,
  ProductRenamePreview,
  ProductRenameRequest,
  ProductRenameResult
} from "../types";
import { transactionFromRow, RepositoryValidationError, RevisionConflictError, rows, text, type Row } from "./repositoryPrimitives";
import type { RepositoryWriteContext } from "./repositoryWriteContext";

export class HistoryWriteRepository {
  constructor(private readonly context: RepositoryWriteContext) {}

  private backfillRows(db: DatabaseSync, transactionIds: number[]): Row[] {
    const ids = transactionIds.map((id) => Number(id));
    if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new RepositoryValidationError("请选择至少一条有效历史流水");
    }
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) {
      throw new RepositoryValidationError("回溯流水不能重复选择");
    }
    const placeholders = uniqueIds.map(() => "?").join(",");
    const selected = rows(db.prepare(`
      SELECT t.id,t.month,t.transaction_date,t.type,t.category_key,t.category,
             t.counterparty,t.product,t.amount
      FROM transactions t
      JOIN month_status m ON m.month=t.month AND m.status='saved'
      WHERE t.id IN (${placeholders})
      ORDER BY t.month,t.transaction_date,t.id
    `).all(...uniqueIds));
    if (selected.length !== uniqueIds.length) {
      throw new RepositoryValidationError("部分流水不属于已保存月份，回溯未执行");
    }
    return selected;
  }

  private backfillPreview(
    db: DatabaseSync,
    selected: Row[],
    targetCategoryKey: string
  ): CategoryBackfillPreview {
    const target = this.context.categoryRows(db).find(
      (category) => category.category_key === text(targetCategoryKey)
    );
    if (!target || !target.is_active) {
      throw new RepositoryValidationError("目标分类不存在或已停用");
    }
    const types = new Set(selected.map((row) => text(row.type)));
    if (types.size !== 1 || !types.has(target.transaction_type)) {
      throw new RepositoryValidationError("目标分类的收支类型与选中流水不一致");
    }
    const ruleData = this.context.ruleHistory.normalizedRuleRows(db);
    const conflicts = selected
      .map((row) => ruleData.matcher.resolve(transactionFromRow(row)))
      .filter((resolution) => resolution.status === "conflict");
    if (conflicts.length) {
      const ruleIds = [...new Set(conflicts.flatMap((resolution) => resolution.rule_ids))];
      throw new RepositoryValidationError(
        ruleIds.length
          ? `选中流水存在未解决的规则冲突（规则 ${ruleIds.join("、")}），请先处理规则`
          : "选中流水存在未解决的规则冲突，请先处理规则"
      );
    }
    const monthCounts = new Map<string, number>();
    for (const row of selected) {
      const month = text(row.month);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    }
    const months = [...monthCounts].sort(([left], [right]) => left.localeCompare(right))
      .map(([month, count]) => ({
        month,
        revision: this.context.getRevision(month, db),
        count
      }));
    return {
      transaction_ids: selected.map((row) => Number(row.id)),
      target_category_key: target.category_key,
      target_category: target.name,
      target_transaction_type: target.transaction_type,
      transaction_count: selected.length,
      month_count: months.length,
      months,
      old_categories: this.context.ruleHistory.historicalCategoryCounts(
        selected,
        this.context.categoryRows(db)
      )
    };
  }

  previewCategoryBackfill(
    db: DatabaseSync,
    request: Omit<CategoryBackfillRequest, "expected_month_revisions">
  ): CategoryBackfillPreview {
    const selected = this.backfillRows(db, request.transaction_ids);
    return this.backfillPreview(db, selected, request.target_category_key);
  }

  applyCategoryBackfill(
    db: DatabaseSync,
    request: CategoryBackfillRequest
  ): CategoryBackfillResult {
    const selected = this.backfillRows(db, request.transaction_ids);
    const preview = this.backfillPreview(db, selected, request.target_category_key);
    const revisions: Record<string, number> = {};
    for (const month of preview.months) {
      const expected = Number(request.expected_month_revisions[month.month]);
      if (!Number.isFinite(expected)) {
        throw new RepositoryValidationError(`缺少 ${month.month} 的 revision`);
      }
      const actual = this.context.getRevision(month.month, db);
      if (actual !== expected) throw new RevisionConflictError(expected, actual);
    }
    const update = db.prepare(
      "UPDATE transactions SET category_key=?,category=? WHERE id=?"
    );
    let updated = 0;
    for (const row of selected) {
      updated += Number(update.run(
        preview.target_category_key,
        preview.target_category,
        Number(row.id)
      ).changes);
    }
    if (updated !== selected.length) {
      throw new RepositoryValidationError("回溯更新行数与预览不一致，已回滚");
    }
    for (const month of preview.months) {
      revisions[month.month] = this.context.touchMonth(db, month.month, month.revision);
    }
    return { ...preview, updated_count: updated, revisions };
  }

  private productRenamePreview(
    db: DatabaseSync,
    selected: Row[],
    targetProduct: string
  ): ProductRenamePreview {
    const target = text(targetProduct);
    if (!target) throw new RepositoryValidationError("目标商品名称不能为空");
    const monthCounts = new Map<string, number>();
    const variantCounts = new Map<string, { occurrences: number; months: Set<string> }>();
    for (const row of selected) {
      const month = text(row.month);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
      const product = text(row.product);
      const variant = variantCounts.get(product) ?? { occurrences: 0, months: new Set<string>() };
      variant.occurrences += 1;
      variant.months.add(month);
      variantCounts.set(product, variant);
    }
    const months = [...monthCounts].sort(([left], [right]) => left.localeCompare(right))
      .map(([month, count]) => ({
        month,
        revision: this.context.getRevision(month, db),
        count
      }));
    return {
      transaction_ids: selected.map((row) => Number(row.id)),
      target_product: target,
      transaction_count: selected.length,
      month_count: months.length,
      months,
      variants: [...variantCounts].map(([product, value]) => ({
        product,
        occurrences: value.occurrences,
        months_count: value.months.size
      })).sort((left, right) =>
        right.occurrences - left.occurrences || left.product.localeCompare(right.product)
      )
    };
  }

  previewProductRename(
    db: DatabaseSync,
    request: Omit<ProductRenameRequest, "expected_month_revisions">
  ): ProductRenamePreview {
    const selected = this.backfillRows(db, request.transaction_ids);
    return this.productRenamePreview(db, selected, request.target_product);
  }

  applyProductRename(db: DatabaseSync, request: ProductRenameRequest): ProductRenameResult {
    const selected = this.backfillRows(db, request.transaction_ids);
    const preview = this.productRenamePreview(db, selected, request.target_product);
    const revisions: Record<string, number> = {};
    for (const month of preview.months) {
      const expected = Number(request.expected_month_revisions[month.month]);
      if (!Number.isFinite(expected)) {
        throw new RepositoryValidationError(`缺少 ${month.month} 的 revision`);
      }
      const actual = this.context.getRevision(month.month, db);
      if (actual !== expected) throw new RevisionConflictError(expected, actual);
    }
    const update = db.prepare("UPDATE transactions SET product=? WHERE id=?");
    let updated = 0;
    for (const row of selected) {
      updated += Number(update.run(
        preview.target_product,
        Number(row.id)
      ).changes);
    }
    if (updated !== selected.length) {
      throw new RepositoryValidationError("商品名称更新行数与预览不一致，已回滚");
    }
    for (const month of preview.months) {
      revisions[month.month] = this.context.touchMonth(db, month.month, month.revision);
    }
    return { ...preview, updated_count: updated, revisions };
  }
}
