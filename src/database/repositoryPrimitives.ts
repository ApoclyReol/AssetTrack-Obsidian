import { createHash, randomUUID } from "node:crypto";
import type {
  DebtRecord,
  FixedAsset,
  Transaction
} from "../types";
import { finiteNumber } from "../domain/money";
import { scalarText } from "../domain/text";
import type { ValidationIssue } from "../domain/validators";
import { AssetTrackError } from "../services/AssetTrackService";

export type Row = Record<string, unknown>;

const ASSET_STATUSES = new Set(["在用", "闲置", "已出售", "已报废"]);

export function ruleIndexKey(type: string, value: string): string {
  return `${type}\u0000${value}`;
}

export function exactRuleIndexKey(type: string, counterparty: string, product: string): string {
  return `${type}\u0000${counterparty}\u0000${product}`;
}

export class RevisionConflictError extends AssetTrackError {
  constructor(expected: number, actual: number) {
    super(
      `revision 冲突：草稿基于 ${expected}，当前数据库为 ${actual}`,
      409,
      { expected, actual },
      "revision_conflict"
    );
  }
}

export class RepositoryValidationError extends AssetTrackError {
  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message, 422, issues.length ? { message, issues } : message, "validation_error");
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
  if (!name) throw new RepositoryValidationError(`第 ${index + 1} 行的资产名称不能为空`);
  const status = text(source.status) || "在用";
  return {
    asset_key: text(source.asset_key) || randomUUID().replaceAll("-", ""),
    asset_name: name,
    category: text(source.category),
    purchase_date: text(source.purchase_date) || null,
    purchase_price: finiteNumber(source.purchase_price, {
      nonNegative: true,
      label: "固定资产金额"
    }),
    status: ASSET_STATUSES.has(status) ? status : "在用",
    note: text(source.note)
  };
}

export function transactionFromRow(row: Row): Transaction {
  return {
    id: Number(row.id),
    transaction_date: text(row.transaction_date),
    type: text(row.type),
    category_key: text(row.category_key) || null,
    category: text(row.category),
    counterparty: text(row.counterparty),
    product: text(row.product),
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
