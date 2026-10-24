import { randomUUID } from "node:crypto";
import { AssetTrackError } from "../application/errors";
import type { Transaction } from "../types/transactions";
import type { OperationPreview } from "../types/operations";
import { amountMinor } from "./ruleAmounts";
import { transactionKey } from "./transactionOperations";
import { normalizeTransactionLabel } from "./transactionLabels";

export interface MergeTransactionsRequest {
  month: string;
  expected_revision: number;
  group_by: "product" | "counterparty";
  groups: Array<{ transaction_keys: string[] }>;
  rows: Transaction[];
  include_tagged?: boolean;
}
export interface MergeGroupPreview {
  cleared_fields: Array<"counterparty" | "product">;
  source_keys: string[];
  before: Transaction[];
  after: Transaction;
}
export interface MergePreviewResult {
  preview: OperationPreview;
  groups: MergeGroupPreview[];
  rows: Transaction[];
  selected_count: number;
  excluded_tagged_count: number;
  unchanged_count: number;
}
export function mergeFailure(reason: string): never {
  throw new AssetTrackError({ code: "transaction.merge.invalid", status: 422, params: { reason } });
}
export type MergeIneligibilityReason = "single" | "month" | "type" | "amount";
export function mergeEligibility(rows: Transaction[], month: string): { reason: MergeIneligibilityReason | null } {
  if (rows.length < 2) return { reason: "single" };
  if (!rows.every((row) => row.transaction_date.slice(0, 7) === month)) return { reason: "month" };
  if (!rows.every((row) => row.type === rows[0].type && ["支出", "收入", "代付"].includes(row.type))) return { reason: "type" };
  try { rows.forEach((row) => amountMinor(row.amount)); } catch { return { reason: "amount" }; }
  return { reason: null };
}
export function previewTransactionMerge(request: MergeTransactionsRequest): MergePreviewResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month) || !request.groups.length
    || !["product", "counterparty"].includes(request.group_by)) mergeFailure("selection");
  const byKey = new Map(request.rows.map((row) => [transactionKey(row), row]));
  if (request.rows.some((row) => row.id == null && !row.client_id?.trim()) || byKey.size !== request.rows.length) mergeFailure("identity");
  if (request.include_tagged != null && typeof request.include_tagged !== "boolean") mergeFailure("selection");
  const selected = new Set<string>();
  const used = new Set<string>();
  let excludedTagged = 0;
  const groups = request.groups.flatMap(({ transaction_keys: keys }) => {
    if (!keys.length || new Set(keys).size !== keys.length || keys.some((key) => selected.has(key) || !byKey.has(key))) mergeFailure("selection");
    keys.forEach((key) => selected.add(key));
    const sourceRows = keys.map((key) => byKey.get(key)!);
    const eligibility = mergeEligibility(sourceRows, request.month);
    if (eligibility.reason) mergeFailure(eligibility.reason);
    const label = normalizeTransactionLabel(sourceRows[0][request.group_by] ?? "");
    if (sourceRows.some((row) => normalizeTransactionLabel(row[request.group_by] ?? "") !== label)) mergeFailure("group");
    const partitions = new Map<string, Transaction[]>();
    for (const row of sourceRows) {
      const tags = [...new Set(row.tag_keys ?? [])].sort();
      if (tags.length && !request.include_tagged) { excludedTagged++; continue; }
      const key = JSON.stringify([row.category_key ?? null, row.category, tags]);
      const partition = partitions.get(key) ?? [];
      partition.push(row); partitions.set(key, partition);
    }
    return [...partitions.values()].filter((rows) => rows.length >= 2).map((before) => {
      const sourceKeys = before.map(transactionKey);
      sourceKeys.forEach((key) => used.add(key));
      const minor = before.reduce((sum, row) => sum + amountMinor(row.amount), 0);
      if (!Number.isSafeInteger(minor)) mergeFailure("amount");
      const secondary = request.group_by === "product" ? "counterparty" : "product";
      const names = new Set(before.map((row) => row[secondary] ?? ""));
      const clearedFields: MergeGroupPreview["cleared_fields"] = names.size > 1 ? [secondary] : [];
      const after: Transaction = {
        client_id: randomUUID(), transaction_date: `${request.month}-01`, type: before[0].type,
        counterparty: before[0].counterparty ?? "", product: before[0].product,
        [secondary]: names.size === 1 ? [...names][0] : "",
        category_key: before[0].category_key ?? null, category: before[0].category,
        amount: minor / 100, tag_keys: [...new Set(before[0].tag_keys ?? [])].sort(),
        account_key: null, source: `合并 · ${before.length} 笔`
      };
      return { cleared_fields: clearedFields, source_keys: sourceKeys, before: structuredClone(before), after };
    });
  });
  const sourceGroups = new Map(groups.flatMap((group) => group.source_keys.map((key) => [key, group] as const)));
  const inserted = new Set<MergeGroupPreview>();
  const rows: Transaction[] = [];
  request.rows.forEach((row) => {
    const group = sourceGroups.get(transactionKey(row));
    if (!group) rows.push(row);
    else if (!inserted.has(group)) { inserted.add(group); rows.push(group.after); }
  });
  const preview: OperationPreview = {
    operation_id: randomUUID(), operation_type: "merge-transactions", source_page: "记录/流水",
    total_count: used.size, change_count: used.size, skipped_count: 0, failure_count: 0, changes: [],
    rule_ids: [],
    metadata: { expected_revision: request.expected_revision, merge_policy: "summary",
      group_by: request.group_by, include_tagged: request.include_tagged === true,
      merge_groups: structuredClone(groups), draft_before: structuredClone(request.rows.filter((row) => used.has(transactionKey(row)))) }
  };
  return { preview, groups, rows, selected_count: selected.size, excluded_tagged_count: excludedTagged, unchanged_count: selected.size - used.size };
}
