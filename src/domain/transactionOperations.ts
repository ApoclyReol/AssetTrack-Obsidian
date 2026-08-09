import { randomUUID } from "node:crypto";
import { RuleMatcher, type RuleRow } from "./rules";
import { scalarText } from "./text";
import type {
  OperationPreview,
  OperationPreviewChange,
  OperationResult,
  TransactionBusinessTab,
  TransactionOperationRequest
} from "../types/operations";
import type {
  Transaction
} from "../types/transactions";

const OUTGOING_TYPES = new Set(["支出"]);
const INCOMING_TYPES = new Set(["收入", "代付"]);
const INVESTMENT_TYPES = new Set(["加仓", "提现"]);

export function transactionTab(type: string): TransactionBusinessTab | null {
  if (OUTGOING_TYPES.has(type)) return "outgoing";
  if (INCOMING_TYPES.has(type)) return "incoming";
  if (INVESTMENT_TYPES.has(type)) return "investment";
  return null;
}

export function transactionTypesForTab(tab: TransactionBusinessTab): string[] {
  return tab === "outgoing"
    ? [...OUTGOING_TYPES]
    : tab === "incoming" ? [...INCOMING_TYPES] : [...INVESTMENT_TYPES];
}

export function isClassifiableTransaction(row: Pick<Transaction, "type">): boolean {
  return row.type === "支出" || row.type === "收入" || row.type === "代付";
}

export function isSelectableTransaction(
  row: Pick<Transaction, "type">,
  tab: TransactionBusinessTab
): boolean {
  return transactionTypesForTab(tab).includes(row.type);
}

export interface TransactionOperationRequestIssue {
  code: string;
  params: Record<string, unknown>;
}

const PREVIEW_OPERATION_TYPES = new Set<TransactionOperationRequest["operation_type"]>([
  "apply-rules",
  "bulk-edit-counterparty",
  "bulk-edit-product",
  "bulk-edit-category",
  "income-to-daifu",
  "daifu-to-income"
]);

/**
 * Return the category namespace used by a transaction type.
 *
 * 代付 is displayed in the incoming tab, but it deliberately shares the
 * expense category namespace with 支出. Keeping this mapping in the domain
 * layer prevents UI batch operations and persistence validation from
 * disagreeing about mixed selections.
 */
export function transactionCategoryType(type: string): "支出" | "收入" | null {
  if (type === "代付") return "支出";
  if (type === "支出" || type === "收入") return type;
  return null;
}

function requestedSelection(rows: Transaction[], request: TransactionOperationRequest): {
  rows: Transaction[];
  keys: Set<string>;
  missing: string[];
} {
  const byKey = new Map(rows.map((row, index) => [transactionKey(row, index), row] as const));
  const keys = new Set<string>();
  const selectedRows: Transaction[] = [];
  const missing: string[] = [];
  for (const id of request.transaction_ids) {
    const key = `id:${id}`;
    keys.add(key);
    const row = byKey.get(key);
    if (row) selectedRows.push(row);
    else missing.push(key);
  }
  for (const key of request.transaction_keys ?? []) {
    const normalized = key.trim();
    keys.add(normalized);
    const row = byKey.get(normalized);
    if (row) {
      if (!selectedRows.some((selected) => transactionKey(selected) === normalized)) selectedRows.push(row);
    } else if (normalized) {
      missing.push(normalized);
    }
  }
  return { rows: selectedRows, keys, missing: [...new Set(missing)] };
}

/**
 * Validate the request contract before a preview is generated.
 *
 * This intentionally does not read categories, revisions, rules, or the
 * database. Those checks belong to the local service and the final write
 * transaction respectively.
 */
export function validateTransactionOperationRequest(
  rows: Transaction[],
  request: TransactionOperationRequest
): TransactionOperationRequestIssue[] {
  const issues: TransactionOperationRequestIssue[] = [];
  if (!PREVIEW_OPERATION_TYPES.has(request.operation_type)) {
    issues.push({
      code: "transaction.operation.unsupported",
      params: { operation_type: request.operation_type }
    });
    return issues;
  }

  const ids = request.transaction_ids;
  const keys = request.transaction_keys ?? [];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    issues.push({ code: "transaction.selection.invalid", params: {} });
  }
  if (ids.length !== new Set(ids).size || keys.some((key) => !key.trim()) || keys.length !== new Set(keys).size) {
    issues.push({ code: "transaction.selection.duplicate", params: {} });
  }
  const selected = requestedSelection(rows, request);
  if (selected.keys.size === 0) {
    issues.push({ code: "transaction.selection.empty", params: {} });
    return issues;
  }
  if (selected.missing.length) {
    issues.push({
      code: "transaction.selection.not_found",
      params: { selection: selected.missing.join(", ") }
    });
  }
  if (!selected.rows.length) return issues;

  if (request.operation_type === "bulk-edit-category") {
    const types = new Set(selected.rows.map((row) => transactionCategoryType(row.type)));
    if ([...types].some((type) => type === null)) {
      issues.push({ code: "transaction.category.invalid_selection", params: {} });
    }
    const normalizedTypes = new Set([...types].filter((type): type is "支出" | "收入" => type !== null));
    if (normalizedTypes.size > 1) {
      issues.push({
        code: "transaction.category.mixed_types",
        params: { types: [...normalizedTypes] }
      });
    }
    const targetKey = request.target_category_key?.trim() ?? "";
    const targetValue = request.target_value?.trim() ?? "";
    if (!targetKey && targetValue) {
      issues.push({ code: "transaction.category.invalid_target", params: {} });
    }
  }

  if (request.operation_type === "income-to-daifu") {
    const invalid = selected.rows.filter((row) => row.type !== "收入");
    if (invalid.length) {
      issues.push({ code: "transaction.conversion.invalid_source", params: { expected: "收入" } });
    }
  }
  if (request.operation_type === "daifu-to-income") {
    const invalid = selected.rows.filter((row) => row.type !== "代付");
    if (invalid.length) {
      issues.push({ code: "transaction.conversion.invalid_source", params: { expected: "代付" } });
    }
  }
  return issues;
}

function transactionId(row: Transaction): number | null {
  return typeof row.id === "number" && Number.isFinite(row.id) ? row.id : null;
}

export function transactionKey(row: Transaction, index = 0): string {
  return row.id !== undefined
    ? `id:${row.id}`
    : `client:${row.client_id ?? `row-${index}`}`;
}

function beforeFields(row: Transaction): Record<string, unknown> {
  return {
    transaction_date: row.transaction_date,
    type: row.type,
    account_key: row.account_key ?? null,
    counterparty: row.counterparty ?? "",
    product: row.product,
    source: row.source ?? "",
    category_key: row.category_key ?? null,
    category: row.category,
    amount: row.amount
  };
}

function previewChange(
  row: Transaction,
  after: Transaction,
  month: string,
  status: OperationPreviewChange["status"],
  reason?: string,
  ruleIds?: number[],
  index = 0
): OperationPreviewChange {
  return {
    transaction_id: transactionId(row),
    transaction_key: transactionKey(row, index),
    month,
    before: beforeFields(row),
    after: beforeFields(after),
    status,
    reason,
    rule_ids: ruleIds
  };
}

function protectedSet(request: TransactionOperationRequest): Set<number> {
  return new Set((request.protected_transaction_ids ?? []).filter((id) => Number.isFinite(id)));
}

export interface TransactionOperationPreviewResult {
  preview: OperationPreview;
  rows: Transaction[];
}

export function previewTransactionOperation(
  rows: Transaction[],
  request: TransactionOperationRequest,
  rules: RuleRow[] = []
): TransactionOperationPreviewResult {
  const matcher = new RuleMatcher(rules);
  const selected = new Set(request.transaction_ids);
  const selectedKeys = new Set(request.transaction_keys ?? []);
  const protectedRows = protectedSet(request);
  const protectedKeys = new Set(request.protected_transaction_keys ?? []);
  const changes: OperationPreviewChange[] = [];
  const nextRows = rows.map((row, rowIndex) => {
    const id = transactionId(row);
    const key = transactionKey(row, rowIndex);
    if ((id === null || !selected.has(id)) && !selectedKeys.has(key)) return { ...row };
    if (((id !== null && protectedRows.has(id)) || protectedKeys.has(key)) && !request.include_protected) {
      changes.push(previewChange(row, row, request.month, "skip", "位于本次保护范围", undefined, rowIndex));
      return { ...row };
    }
    if (request.operation_type === "apply-rules") {
      const resolution = matcher.resolve(row);
      if (resolution.status === "conflict") {
        changes.push(previewChange(row, row, request.month, "failure", resolution.reason, resolution.rule_ids, rowIndex));
        return { ...row };
      }
      const next = resolution.status === "matched"
        ? {
            ...row,
            counterparty: resolution.rewrite_merchant || row.counterparty || "",
            product: resolution.rewrite_product || row.product,
            category_key: resolution.category_key ?? null,
            category: resolution.category ?? ""
          }
        : { ...row };
      const changed = JSON.stringify(beforeFields(row)) !== JSON.stringify(beforeFields(next));
      changes.push(previewChange(
        row,
        next,
        request.month,
        changed ? "change" : "skip",
        changed ? undefined : "规则结果与当前值相同",
        [...new Set([...resolution.rule_ids, ...(resolution.covered_rule_ids ?? [])])],
        rowIndex
      ));
      return next;
    }
    if (request.operation_type === "bulk-edit-counterparty") {
      const next = { ...row, counterparty: request.target_value?.trim() ?? "" };
      changes.push(previewChange(row, next, request.month, next.counterparty === (row.counterparty ?? "") ? "skip" : "change", undefined, undefined, rowIndex));
      return next;
    }
    if (request.operation_type === "bulk-edit-product") {
      const next = { ...row, product: request.target_value?.trim() ?? "" };
      changes.push(previewChange(row, next, request.month, next.product === row.product ? "skip" : "change", undefined, undefined, rowIndex));
      return next;
    }
    if (request.operation_type === "bulk-edit-category") {
      if (row.type !== "支出" && row.type !== "收入" && row.type !== "代付") {
        changes.push(previewChange(row, row, request.month, "skip", "该流水类型不适用分类", undefined, rowIndex));
        return { ...row };
      }
      const next = {
        ...row,
        category_key: request.target_category_key ?? null,
        category: request.target_value?.trim() ?? ""
      };
      const changed = next.category_key !== row.category_key || next.category !== row.category;
      changes.push(previewChange(row, next, request.month, changed ? "change" : "skip", undefined, undefined, rowIndex));
      return next;
    }
    if (request.operation_type === "income-to-daifu" || request.operation_type === "daifu-to-income") {
      const expected = request.operation_type === "income-to-daifu" ? "收入" : "代付";
      const target = request.operation_type === "income-to-daifu" ? "代付" : "收入";
      if (row.type !== expected) {
        changes.push(previewChange(row, row, request.month, "skip", `只有${expected}流水可以执行此转换`, undefined, rowIndex));
        return { ...row };
      }
      const next = { ...row, type: target, category_key: null, category: "" };
      changes.push(previewChange(row, next, request.month, "change", undefined, undefined, rowIndex));
      return next;
    }
    changes.push(previewChange(row, row, request.month, "skip", "该操作没有可执行的流水变更", undefined, rowIndex));
    return { ...row };
  });
  const operationId = randomUUID();
  const tabCounts = changes.reduce<Record<string, number>>((counts, change) => {
    const type = scalarText(change.before.type);
    const tab = transactionTab(type) ?? "unknown";
    counts[tab] = (counts[tab] ?? 0) + 1;
    return counts;
  }, {});
  const originalField = request.operation_type === "bulk-edit-counterparty"
    ? "counterparty"
    : request.operation_type === "bulk-edit-product"
      ? "product"
      : request.operation_type === "bulk-edit-category"
        ? "category"
        : request.operation_type === "income-to-daifu"
          || request.operation_type === "daifu-to-income"
          ? "type"
          : null;
  const originalValueCounts = originalField
    ? changes.reduce<Record<string, number>>((counts, change) => {
        const value = scalarText(change.before[originalField]);
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
      }, {})
    : undefined;
  const preview: OperationPreview = {
    operation_id: operationId,
    operation_type: request.operation_type,
    source_page: request.source_page,
    business_tab: request.business_tab,
    total_count: changes.length,
    change_count: changes.filter((change) => change.status === "change").length,
    skipped_count: changes.filter((change) => change.status === "skip").length,
    failure_count: changes.filter((change) => change.status === "failure").length,
    changes,
    protected_count: changes.filter((change) => change.reason === "位于本次保护范围").length,
    rule_ids: request.operation_type === "apply-rules"
      ? [...new Set(changes.flatMap((change) => {
          return change.rule_ids ?? [];
        }))]
      : undefined,
    metadata: {
      expected_revision: request.expected_revision,
      rules_revision: request.rules_revision ?? null,
      transaction_ids: request.transaction_ids,
      transaction_keys: request.transaction_keys ?? [],
      protected_transaction_ids: request.protected_transaction_ids ?? [],
      protected_transaction_keys: request.protected_transaction_keys ?? [],
      include_protected: request.include_protected ?? false,
      target_value: request.target_value ?? null,
      target_category_key: request.target_category_key ?? null,
      target_type: request.target_type ?? null,
      selected_tab_counts: tabCounts,
      original_value_counts: originalValueCounts ?? null
    }
  };
  return { preview, rows: nextRows };
}

export function operationResult(
  preview: OperationPreview,
  completedAt: string
): OperationResult {
  return {
    ...preview,
    completed_at: completedAt,
    success_count: preview.change_count
  };
}
