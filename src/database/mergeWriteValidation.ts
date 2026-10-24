import { AssetTrackError } from "../application/errors";
import { previewTransactionMerge, type MergeGroupPreview } from "../domain/transactionMerge";
import { transactionKey } from "../domain/transactionOperations";
import type { Transaction } from "../types/transactions";
import type { PendingOperationLog } from "../types/operations";

function reject(): never { throw new AssetTrackError({ code: "operation.preview_draft_mismatch", status: 422 }); }
function fields(row: Transaction): string {
  return JSON.stringify([row.transaction_date, row.type, row.counterparty ?? "", row.product,
    row.category_key ?? null, row.category, row.amount, row.source ?? "", row.account_key ?? null,
    [...new Set(row.tag_keys ?? [])].sort()]);
}
/** Structural operations are validated from immutable draft checkpoints, never as row updates. */
export function validateMergeLogs(
  month: string, canonical: Transaction[], input: Transaction[], logs: PendingOperationLog[],
  rulesRevision: number, monthRevision: number
): PendingOperationLog[] {
  const persistedIds = new Set(canonical.map((row) => row.id));
  const consumed = new Set<string>();
  const virtual = new Map(canonical.map((row) => [transactionKey(row), row]));
  const finalByKey = new Map(input.map((row) => [transactionKey(row), row]));
  if (finalByKey.size !== input.length) reject();
  return logs.map((entry) => {
    const meta = entry.preview.metadata ?? {};
    if ((entry.preview.operation_type !== "merge-transactions" && meta.rules_revision != null && meta.rules_revision !== rulesRevision)
      || (meta.expected_revision != null && meta.expected_revision !== monthRevision)) {
      throw new AssetTrackError({ code: "revision_conflict", status: 409 });
    }
    if (entry.preview.operation_type !== "merge-transactions") {
      const changes = entry.preview.changes;
      const keys = changes.map((change) => change.transaction_key ?? `id:${change.transaction_id}`);
      if (new Set(keys).size !== keys.length || JSON.stringify([...keys].sort()) !== JSON.stringify([...entry.selection].sort())
        || entry.preview.total_count !== changes.length
        || entry.preview.change_count !== changes.filter((change) => change.status === "change").length
        || entry.preview.failure_count !== changes.filter((change) => change.status === "failure").length
        || entry.preview.skipped_count !== changes.filter((change) => change.status === "skip").length) reject();
      changes.forEach((change, index) => {
        const key = keys[index];
        if (change.month !== month || consumed.has(key)
          || (change.transaction_id != null && !persistedIds.has(change.transaction_id))) reject();
        const prior = virtual.get(key) ?? finalByKey.get(key);
        if (!prior || ["transaction_date", "type", "product", "amount", "source", "category", "category_key", "counterparty", "account_key"]
          .some((field) => !(field in change.before) || !(field in change.after))) reject();
        if (change.status !== "change" && JSON.stringify(change.before) !== JSON.stringify(change.after)) reject();
        virtual.set(key, { ...prior, ...change.after });
      });
      return entry;
    }
    if (meta.merge_policy !== "summary" || meta.expected_revision !== monthRevision) reject();
    if (!Array.isArray(meta.draft_before) || !Array.isArray(meta.merge_groups)
      || !["product", "counterparty"].includes(String(meta.group_by))) reject();
    if (typeof meta.include_tagged !== "boolean" || !meta.merge_groups.length) reject();
    const before = meta.draft_before as Transaction[];
    const groups = meta.merge_groups as MergeGroupPreview[];
    if (before.some((row) => (row.id != null && !persistedIds.has(row.id)) || consumed.has(transactionKey(row)))) reject();
    before.forEach((row) => virtual.set(transactionKey(row), row));
    const result = previewTransactionMerge({ month, rows: before,
      expected_revision: monthRevision,
      group_by: meta.group_by as "product" | "counterparty",
      include_tagged: meta.include_tagged,
      groups: groups.map((group) => ({ transaction_keys: group.source_keys })) });
    if (result.groups.length !== groups.length || entry.preview.total_count !== result.preview.total_count || entry.preview.change_count !== result.preview.change_count
      || entry.preview.changes.length || entry.preview.failure_count || entry.preview.skipped_count) reject();
    const sourceKeys = groups.flatMap((group) => group.source_keys);
    if (JSON.stringify([...sourceKeys].sort()) !== JSON.stringify([...entry.selection].sort())) reject();
    const targetKeys = new Set<string>();
    groups.forEach((group, index) => {
      const expected = result.groups[index];
      if (JSON.stringify(group.cleared_fields) !== JSON.stringify(expected.cleared_fields) || !group.after.client_id || group.after.id != null
        || fields(group.after) !== fields(expected.after)
        || group.before.length !== expected.before.length
        || group.before.some((row, i) => transactionKey(row) !== transactionKey(expected.before[i]) || fields(row) !== fields(expected.before[i]))) reject();
      const key = transactionKey(group.after);
      if (targetKeys.has(key) || before.some((row) => transactionKey(row) === key)) reject();
      targetKeys.add(key);
      group.source_keys.forEach((sourceKey) => {
        if (consumed.has(sourceKey) || finalByKey.has(sourceKey)) reject();
        consumed.add(sourceKey);
        virtual.delete(sourceKey);
      });
      virtual.set(key, group.after);
    });
    return { ...entry, preview: { ...entry.preview, rule_ids: result.preview.rule_ids, metadata: { ...meta,
      committed_from_canonical_rows: true,
      merge_groups: result.groups.map((group, index) => ({ ...group, after: groups[index].after })),
      source_canonical_before: canonical.filter((row) => sourceKeys.includes(transactionKey(row))),
      // Later manual edits/deletions are ordinary draft changes, recorded separately from the merge result.
      final_results: groups.map((group) => ({ confirmed: group.after, saved: finalByKey.get(transactionKey(group.after)) ?? null }))
    } } };
  });
}
