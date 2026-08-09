import { createHash, randomUUID } from "node:crypto";
import type {
  DebtRecord,
  FixedAsset
} from "../types/month";
import type {
  Transaction
} from "../types/transactions";
import { finiteNumber } from "../domain/money";
import { normalizeDate } from "../domain/dates";
import { scalarText } from "../domain/text";
import type { ValidationIssue } from "../domain/validators";
import { AssetTrackError, type AssetTrackErrorParams } from "../application/errors";

export type Row = Record<string, unknown>;

const ASSET_STATUSES = new Set(["在用", "闲置", "已出售", "已报废"]);

export function ruleIndexKey(type: string, value: string): string {
  return `${type}\u0000${value}`;
}

export class RevisionConflictError extends AssetTrackError {
  constructor(expected: number, actual: number) {
    super({
      code: "revision_conflict",
      status: 409,
      params: { expected, actual }
    });
  }
}

export class RepositoryValidationError extends AssetTrackError {
  constructor(options: {
    code: string;
    params?: AssetTrackErrorParams;
    issues?: ValidationIssue[];
  }) {
    super({
      code: options.code,
      status: 422,
      params: {
        ...options.params,
        ...(options.issues?.length ? { issues: options.issues } : {})
      }
    });
  }
}

export function text(value: unknown): string {
  return scalarText(value).trim();
}

export function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function rows(statementRows: unknown[]): Row[] {
  return statementRows as Row[];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "boolean") return value ? "true" : "false";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(", ")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(
    (key) => `${JSON.stringify(key)}: ${stableJson(object[key])}`
  ).join(", ")}}`;
}

export function contentRevision(value: Row[]): number {
  const digest = createHash("sha256").update(stableJson(value), "utf8").digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16);
}

export function normalizeAsset(source: Partial<FixedAsset>, index: number): Required<
  Pick<FixedAsset, "asset_key" | "asset_name" | "category" | "purchase_price" | "status" | "note">
> & Pick<FixedAsset, "purchase_date"> {
  const name = text(source.asset_name);
  if (!name) {
    throw new RepositoryValidationError({
      code: "fixed_asset.name_required",
      params: { row: index + 1 }
    });
  }
  const status = text(source.status) || "在用";
  if (!ASSET_STATUSES.has(status)) {
    throw new RepositoryValidationError({
      code: "fixed_asset.status_invalid",
      params: { row: index + 1, status }
    });
  }
  let purchaseDate: string | null = null;
  const rawPurchaseDate = text(source.purchase_date);
  if (rawPurchaseDate) {
    try {
      purchaseDate = normalizeDate(rawPurchaseDate);
    } catch {
      throw new RepositoryValidationError({
        code: "fixed_asset.date_invalid",
        params: { row: index + 1, date: rawPurchaseDate }
      });
    }
  }
  return {
    asset_key: text(source.asset_key) || randomUUID().replaceAll("-", ""),
    asset_name: name,
    category: text(source.category),
    purchase_date: purchaseDate,
    purchase_price: finiteNumber(source.purchase_price, {
      nonNegative: true,
      label: "固定资产金额"
    }),
    status,
    note: text(source.note)
  };
}

export function transactionFromRow(row: Row): Transaction {
  return {
    id: Number(row.id),
    transaction_date: text(row.transaction_date),
    type: text(row.type),
    account_key: text(row.account_key) || null,
    category_key: text(row.category_key) || null,
    category: text(row.category),
    counterparty: text(row.counterparty),
    product: text(row.product),
    source: text(row.source),
    amount: Number(row.amount ?? 0)
  };
}

export function fixedAssetFromRow(row: Row): FixedAsset {
  return {
    id: Number(row.id),
    asset_key: text(row.asset_key),
    asset_name: text(row.asset_name),
    category: text(row.category),
    purchase_date: text(row.purchase_date) || null,
    purchase_price: Number(row.purchase_price ?? 0),
    status: text(row.status),
    note: text(row.note)
  };
}

export function debtFromRow(row: Row): DebtRecord {
  return {
    id: Number(row.id),
    description: text(row.description),
    counterparty: text(row.counterparty),
    amount: Number(row.amount ?? 0),
    start_date: text(row.start_date),
    is_paid: boolean(row.is_paid),
    paid_date: text(row.paid_date) || null
  };
}
