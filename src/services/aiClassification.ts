import { requestUrl } from "obsidian";
import { randomUUID } from "node:crypto";
import { AssetTrackError } from "../application/errors";
import type {
  AssetTrackSettings
} from "../types/settings";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  AiBatchResult,
  OperationPreview,
  OperationPreviewChange,
  TransactionOperationRequest
} from "../types/operations";
import type {
  Transaction
} from "../types/transactions";
import { scalarText } from "../domain/text";
import { transactionKey } from "../domain/transactionOperations";

interface RawAiRow {
  transaction_id?: unknown;
  transaction_key?: unknown;
  category_key?: unknown;
  rewrite_merchant?: unknown;
  rewrite_product?: unknown;
  status?: unknown;
  confidence?: unknown;
}

const AI_STATUSES = new Set(["classified", "unclassified", "need_review", "error"]);

function categoryTypeForTransaction(type: Transaction["type"]): "支出" | "收入" | null {
  if (type === "代付") return "支出";
  return type === "支出" || type === "收入" ? type : null;
}

export interface AiClassificationPreviewResult {
  batch: AiBatchResult;
  preview: OperationPreview;
  rows: Transaction[];
}

function endpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function beforeFields(row: Transaction): Record<string, unknown> {
  return {
    transaction_date: row.transaction_date,
    type: row.type,
    counterparty: row.counterparty ?? "",
    product: row.product,
    source: row.source ?? "",
    category_key: row.category_key ?? null,
    category: row.category,
    amount: row.amount
  };
}

function status(value: unknown): AiBatchResult["rows"][number]["status"] {
  return value === "classified" || value === "unclassified" || value === "need_review" || value === "error"
    ? value
    : "error";
}

function optionalString(value: unknown): { value: string | null; valid: boolean } {
  if (value === undefined || value === null) return { value: null, valid: true };
  if (typeof value !== "string") return { value: null, valid: false };
  const normalized = value.trim();
  return { value: normalized || null, valid: Boolean(normalized) };
}

function confidence(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= 1
    ? numberValue
    : null;
}

function responseRows(payload: unknown): RawAiRow[] {
  if (Array.isArray(payload)) return payload.filter((row): row is RawAiRow => Boolean(row && typeof row === "object"));
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.results)) return record.results.filter((row): row is RawAiRow => Boolean(row && typeof row === "object"));
  const content = (record.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = content?.message as Record<string, unknown> | undefined;
  const rawContent = message?.content;
  if (typeof rawContent !== "string") return [];
  try {
    return responseRows(JSON.parse(rawContent) as unknown);
  } catch {
    return [];
  }
}

async function requestWithTimeout(
  url: string,
  body: string,
  apiKey: string,
  timeoutMs: number,
  timerHost?: Pick<Window, "setTimeout" | "clearTimeout">
): Promise<unknown> {
  const host = timerHost ?? window;
  let timer: number | undefined;
  const request = requestUrl({
    url,
    method: "POST",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    throw: false
  });
  try {
    const response = await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = host.setTimeout(() => reject(new AssetTrackError({
          code: "ai.timeout",
          status: 504,
          params: { timeoutMs }
        })), timeoutMs);
      })
    ]);
    if (response.status < 200 || response.status >= 300) {
      throw new AssetTrackError({
        code: "ai.http_error",
        status: 502,
        params: { status: response.status }
      });
    }
    return response.json;
  } finally {
    if (timer !== undefined) host.clearTimeout(timer);
  }
}

function parseRawResult(
  row: Transaction,
  raw: RawAiRow | undefined,
  categories: CategoryDefinition[],
  index: number
): AiBatchResult["rows"][number] {
  if (!raw) {
    return {
      transaction_id: typeof row.id === "number" ? row.id : null,
      transaction_key: transactionKey(row, index),
      status: "error",
      category_key: null,
      rewrite_merchant: null,
      rewrite_product: null,
      confidence: null,
      error: "AI 未返回对应流水结果"
    };
  }
  const rawStatus = status(raw?.status);
  const categoryKey = raw.category_key === undefined || raw.category_key === null
    ? ""
    : typeof raw.category_key === "string" ? raw.category_key.trim() : "__invalid__";
  const category = categories.find((item) => item.category_key === categoryKey);
  const rawConfidence = confidence(raw?.confidence);
  const confidenceProvided = raw.confidence !== undefined && raw.confidence !== null && raw.confidence !== "";
  const rewriteMerchant = optionalString(raw.rewrite_merchant);
  const rewriteProduct = optionalString(raw.rewrite_product);
  const base = {
    transaction_id: typeof row.id === "number" ? row.id : null,
    transaction_key: transactionKey(row, index),
    status: rawStatus,
    category_key: category?.category_key ?? null,
    rewrite_merchant: rewriteMerchant.value,
    rewrite_product: rewriteProduct.value,
    confidence: rawConfidence,
    raw
  } satisfies AiBatchResult["rows"][number];
  if (!AI_STATUSES.has(String(raw.status)) || !rewriteMerchant.valid || !rewriteProduct.valid
    || (confidenceProvided && rawConfidence === null)
    || (raw.category_key !== undefined && raw.category_key !== null && typeof raw.category_key !== "string")) {
    return { ...base, status: "error", error: "AI 返回字段类型或取值无效" };
  }
  if (rawStatus === "classified" && (!category || !category.is_active || rawConfidence === null)) {
    return {
      ...base,
      status: "error",
      error: !category || !category.is_active ? "AI 返回了无效或停用分类" : "AI confidence 无效"
    };
  }
  return base;
}

function findRawResult(row: Transaction, rawRows: RawAiRow[], index: number): RawAiRow | undefined {
  const id = typeof row.id === "number" ? String(row.id) : "";
  const key = transactionKey(row, index);
  return rawRows.find((candidate) =>
    (id && String(candidate.transaction_id) === id)
    || (key && scalarText(candidate.transaction_key) === key)
  );
}

function changeFor(
  row: Transaction,
  result: AiBatchResult["rows"][number],
  categories: CategoryDefinition[],
  month: string,
  index: number
): { next: Transaction; change: OperationPreviewChange } {
  if (result.status !== "classified" || !result.category_key) {
    return {
      next: { ...row },
      change: {
        transaction_id: typeof row.id === "number" ? row.id : null,
        transaction_key: transactionKey(row, index),
        month,
        before: beforeFields(row),
        after: beforeFields(row),
        status: result.status === "error" ? "failure" : "skip",
        reason: result.error ?? (result.status === "need_review" ? "AI 结果需要人工确认" : "AI 无法分类")
      }
    };
  }
  const category = categories.find((item) => item.category_key === result.category_key);
  const next = {
    ...row,
    category_key: result.category_key,
    category: category?.name ?? row.category,
    counterparty: result.rewrite_merchant ?? row.counterparty,
    product: result.rewrite_product ?? row.product
  };
  const changed = JSON.stringify(beforeFields(row)) !== JSON.stringify(beforeFields(next));
  return {
    next,
    change: {
      transaction_id: typeof row.id === "number" ? row.id : null,
      transaction_key: transactionKey(row, index),
      month,
      before: beforeFields(row),
      after: beforeFields(next),
      status: changed ? "change" : "skip",
      reason: changed ? undefined : "AI 结果与当前值相同"
    }
  };
}

export async function previewAiClassification(
  rows: Transaction[],
  request: TransactionOperationRequest,
  categories: CategoryDefinition[],
  settings: AssetTrackSettings,
  apiKey: string,
  timerHost?: Pick<Window, "setTimeout" | "clearTimeout">
): Promise<AiClassificationPreviewResult> {
  const selected = new Set(request.transaction_ids);
  const selectedKeys = new Set(request.transaction_keys ?? []);
  const protectedIds = new Set(request.protected_transaction_ids ?? []);
  const protectedKeys = new Set(request.protected_transaction_keys ?? []);
  const selectedRows = rows.filter((row, index) => {
    if (!categoryTypeForTransaction(row.type)) return false;
    const id = typeof row.id === "number" ? row.id : null;
    const key = transactionKey(row, index);
    return (id !== null && selected.has(id)) || selectedKeys.has(key);
  });
  const rowsToSend = selectedRows.filter((row, index) => {
    const id = typeof row.id === "number" ? row.id : null;
    const key = transactionKey(row, rows.indexOf(row) >= 0 ? rows.indexOf(row) : index);
    return request.include_protected
      || !((id !== null && protectedIds.has(id)) || protectedKeys.has(key));
  });
  if (!rowsToSend.length) {
    return makePreview(
      rows,
      request,
      categories,
      {
        batch_id: randomUUID(),
        model: settings.aiModel?.trim() || "未调用",
        created_at: new Date().toISOString(),
        total_count: 0,
        classified_count: 0,
        unclassified_count: 0,
        review_count: 0,
        error_count: 0,
        rows: []
      },
      protectedIds,
      protectedKeys
    );
  }
  if (!settings.aiEndpoint?.trim() || !settings.aiModel?.trim()) {
    throw new AssetTrackError({ code: "ai.configuration_missing", status: 422 });
  }
  if (!apiKey.trim()) {
    throw new AssetTrackError({ code: "ai.api_key_missing", status: 422 });
  }
  const input = rowsToSend.map((row) => ({
    transaction_id: typeof row.id === "number" ? row.id : null,
    transaction_key: transactionKey(row, rows.indexOf(row)),
    transaction_type: row.type,
    counterparty: row.counterparty ?? "",
    product: row.product,
    current_category_key: row.category_key ?? null,
    current_category: row.category
  }));
  const categoryList = [...new Map(categories
    .filter((category) => category.is_active && (category.transaction_type === "支出" || category.transaction_type === "收入"))
    .map((category) => [category.category_key, category]))]
    .map(([, category]) => ({ category_key: category.category_key, name: category.name, transaction_type: category.transaction_type, description: category.description ?? "" }));
  const body = JSON.stringify({
    model: settings.aiModel.trim(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "你是个人财务分类助手。只输出 JSON，不要解释。代付流水允许分类，但必须使用支出类分类。results 数组中的每项必须包含 transaction_id 或 transaction_key、category_key、rewrite_merchant、rewrite_product、status、confidence。status 只能是 classified、unclassified、need_review、error。" },
      { role: "user", content: JSON.stringify({ transactions: input, categories: categoryList }) }
    ]
  });
  const createdAt = new Date().toISOString();
  let payload: unknown;
  try {
    payload = await requestWithTimeout(
      endpoint(settings.aiEndpoint),
      body,
      apiKey,
      settings.aiTimeoutMs ?? 60_000,
      timerHost
    );
  } catch (error) {
    const failedRows = selectedRows.map((row) => ({
      transaction_id: typeof row.id === "number" ? row.id : null,
      transaction_key: transactionKey(row, rows.indexOf(row)),
      status: "error" as const,
      category_key: null,
      rewrite_merchant: null,
      rewrite_product: null,
      confidence: null,
      error: error instanceof Error ? error.message : String(error)
    }));
    return makePreview(
      rows,
      request,
      categories,
      {
        batch_id: randomUUID(),
        model: settings.aiModel.trim(),
        created_at: createdAt,
        total_count: rowsToSend.length,
        classified_count: 0,
        unclassified_count: 0,
        review_count: 0,
        error_count: selectedRows.length,
        rows: failedRows
      },
      protectedIds,
      protectedKeys
    );
  }
  const rawRows = responseRows(payload);
  const parsed = rowsToSend.map((row) => {
    const index = rows.indexOf(row);
    return parseRawResult(
      row,
      findRawResult(row, rawRows, index),
      categories.filter((category) => category.transaction_type === categoryTypeForTransaction(row.type)),
      index
    );
  });
  const batch: AiBatchResult = {
    batch_id: randomUUID(),
    model: settings.aiModel.trim(),
    created_at: createdAt,
    total_count: parsed.length,
    classified_count: parsed.filter((row) => row.status === "classified").length,
    unclassified_count: parsed.filter((row) => row.status === "unclassified").length,
    review_count: parsed.filter((row) => row.status === "need_review").length,
    error_count: parsed.filter((row) => row.status === "error").length,
    rows: parsed
  };
  return makePreview(rows, request, categories, batch, protectedIds, protectedKeys);
}

function makePreview(
  rows: Transaction[],
  request: TransactionOperationRequest,
  categories: CategoryDefinition[],
  batch: AiBatchResult,
  protectedIds = new Set<number>(),
  protectedKeys = new Set<string>()
): AiClassificationPreviewResult {
  const resultById = new Map(batch.rows.flatMap((row) =>
    row.transaction_id === null ? [] : [[row.transaction_id, row] as const]
  ));
  const resultByKey = new Map(batch.rows.flatMap((row) =>
    row.transaction_key ? [[row.transaction_key, row] as const] : []
  ));
  const changes: OperationPreviewChange[] = [];
  const nextRows = rows.map((row, index) => {
    const id = typeof row.id === "number" ? row.id : null;
    const key = transactionKey(row, index);
    if ((id === null || !request.transaction_ids.includes(id)) && !(request.transaction_keys ?? []).includes(key)) return { ...row };
    if (!request.include_protected && ((id !== null && protectedIds.has(id)) || protectedKeys.has(key))) {
      changes.push({ transaction_id: id, transaction_key: key, month: request.month, before: beforeFields(row), after: beforeFields(row), status: "skip", reason: "位于本次保护范围" });
      return { ...row };
    }
    const result = (id === null ? undefined : resultById.get(id)) ?? resultByKey.get(key);
    if (!result) return { ...row };
    const change = changeFor(row, result, categories.filter((category) => category.transaction_type === categoryTypeForTransaction(row.type)), request.month, index);
    changes.push(change.change);
    return change.next;
  });
  const preview: OperationPreview = {
    operation_id: batch.batch_id,
    operation_type: "ai-classification",
    source_page: request.source_page,
    business_tab: request.business_tab,
    total_count: changes.length,
    change_count: changes.filter((change) => change.status === "change").length,
    skipped_count: changes.filter((change) => change.status === "skip").length,
    failure_count: changes.filter((change) => change.status === "failure").length,
    protected_count: changes.filter((change) => change.reason === "位于本次保护范围").length,
    changes,
    metadata: {
      expected_revision: request.expected_revision,
      rules_revision: request.rules_revision ?? null,
      transaction_ids: request.transaction_ids,
      transaction_keys: request.transaction_keys ?? [],
      protected_transaction_ids: request.protected_transaction_ids ?? [],
      protected_transaction_keys: request.protected_transaction_keys ?? [],
      include_protected: request.include_protected ?? false,
      selected_tab_counts: { [request.business_tab ?? "unknown"]: changes.length },
      ai_batch_id: batch.batch_id,
      model: batch.model,
      created_at: batch.created_at,
      result_rows: batch.rows
    }
  };
  return { batch, preview, rows: nextRows };
}
