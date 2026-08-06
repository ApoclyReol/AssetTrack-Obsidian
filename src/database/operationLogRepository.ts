import type { DatabaseSync } from "node:sqlite";
import type {
  OperationLogSummary,
  OperationPreview,
  OperationResult
} from "../types/operations";
import { text, type Row } from "./repositoryPrimitives";

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ error: "无法序列化操作详情" });
  }
}

export class OperationLogRepository {
  write(
    db: DatabaseSync,
    result: OperationPreview | OperationResult,
    selection: string[]
  ): void {
    const completedAt = "completed_at" in result ? result.completed_at : new Date().toISOString();
    const successCount = "success_count" in result
      ? result.success_count
      : result.change_count;
    db.prepare(`
      INSERT INTO operation_logs
        (operation_id,created_at,actor,operation_type,source_page,business_tab,
         selection_json,total_count,success_count,skipped_count,failure_count,details_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      result.operation_id,
      completedAt,
      result.actor ?? "local-user",
      result.operation_type,
      result.source_page,
      result.business_tab ?? null,
      safeJson(selection),
      result.total_count,
      successCount,
      result.skipped_count,
      result.failure_count,
      safeJson({
        actor: result.actor ?? "local-user",
        source_page: result.source_page,
        business_tab: result.business_tab ?? null,
        selection,
        changes: result.changes,
        protected_count: result.protected_count ?? 0,
        rule_ids: result.rule_ids ?? [],
        metadata: result.metadata ?? {}
      })
    );
  }

  list(db: DatabaseSync, limit = 50): OperationLogSummary[] {
    const bounded = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 50)));
    return (db.prepare(`
      SELECT operation_id,created_at,actor,operation_type,source_page,business_tab,
             total_count,success_count,skipped_count,failure_count,details_json
      FROM operation_logs
      ORDER BY created_at DESC,id DESC
      LIMIT ?
    `).all(bounded) as Row[]).map((row) => {
      let previewOnly = false;
      try {
        const details = JSON.parse(text(row.details_json)) as Record<string, unknown>;
        const metadata = details.metadata;
        previewOnly = Boolean(metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).preview_only);
      } catch {
        previewOnly = false;
      }
      return {
        operation_id: text(row.operation_id),
        created_at: text(row.created_at),
        actor: text(row.actor) || "local-user",
        operation_type: text(row.operation_type),
        source_page: text(row.source_page),
        business_tab: text(row.business_tab) || null,
        total_count: Number(row.total_count ?? 0),
        success_count: Number(row.success_count ?? 0),
        skipped_count: Number(row.skipped_count ?? 0),
        failure_count: Number(row.failure_count ?? 0),
        preview_only: previewOnly
      };
    });
  }

  details(db: DatabaseSync, operationId: string): Record<string, unknown> | null {
    const row = db.prepare(
      "SELECT details_json FROM operation_logs WHERE operation_id=?"
    ).get(operationId) as Row | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(text(row.details_json)) as unknown;
      return parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : { value: parsed };
    } catch {
      return { error: "操作详情损坏" };
    }
  }
}
