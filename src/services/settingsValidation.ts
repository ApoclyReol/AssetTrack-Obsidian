import type {
  AssetTrackSettings,
  CsvColumnMapping,
  CsvMappingProfile
} from "../types";
import { normalizeDataDirectory } from "./workspacePath";
import { isCurrencyCode } from "../domain/moneyFormat";

export interface SettingsParseResult {
  settings: AssetTrackSettings;
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value)
    && Object.values(value).every((item) => typeof item === "string");
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parseMapping(value: unknown): CsvColumnMapping | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.date_column !== "string"
    || typeof value.product_column !== "string"
    || typeof value.amount_column !== "string"
    || typeof value.type_column !== "string"
    || !optionalString(value.counterparty_column)
    || !optionalString(value.category_column)
    || !optionalString(value.status_column)
    || !isStringRecord(value.type_values)
    || !Array.isArray(value.included_statuses)
    || !value.included_statuses.every((item) => typeof item === "string")
  ) {
    return null;
  }
  return {
    date_column: value.date_column,
    product_column: value.product_column,
    counterparty_column: value.counterparty_column,
    amount_column: value.amount_column,
    type_column: value.type_column,
    category_column: value.category_column,
    status_column: value.status_column,
    type_values: { ...value.type_values },
    included_statuses: [...value.included_statuses]
  };
}

function parseProfile(value: unknown): CsvMappingProfile | null {
  if (
    !isRecord(value)
    || typeof value.header_signature !== "string"
    || !value.header_signature
    || typeof value.updated_at !== "string"
  ) {
    return null;
  }
  const mapping = parseMapping(value.mapping);
  if (!mapping) return null;
  return {
    header_signature: value.header_signature,
    mapping,
    updated_at: value.updated_at
  };
}

export function parseAssetTrackSettings(value: unknown): SettingsParseResult {
  const issues: string[] = [];
  const source = isRecord(value) ? value : {};
  let dataDirectory = "";
  if (typeof source.dataDirectory === "string") {
    try {
      dataDirectory = normalizeDataDirectory(source.dataDirectory);
    } catch (error) {
      issues.push(
        `已忽略无效数据目录：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } else if (source.dataDirectory !== undefined) {
    issues.push("已忽略非文本数据目录");
  }

  const csvMappings = Array.isArray(source.csvMappings)
    ? source.csvMappings.flatMap((item) => {
        const profile = parseProfile(item);
        if (profile) return [profile];
        issues.push("已忽略一个无效账单映射配置");
        return [];
      }).slice(-20)
    : [];
  if (source.csvMappings !== undefined && !Array.isArray(source.csvMappings)) {
    issues.push("已忽略格式错误的账单映射列表");
  }
  const baseCurrency = typeof source.baseCurrency === "string"
    && isCurrencyCode(source.baseCurrency.toUpperCase())
    ? source.baseCurrency.toUpperCase()
    : "CNY";
  if (source.baseCurrency !== undefined && baseCurrency === "CNY" && source.baseCurrency !== "CNY") {
    issues.push("已忽略无效基础货币");
  }
  const currencyFormat = source.currencyFormat === "accounting"
    ? "accounting" : "standard";
  const reconciliationTolerance = typeof source.reconciliationTolerance === "number"
    && Number.isFinite(source.reconciliationTolerance)
    && source.reconciliationTolerance >= 0
    ? source.reconciliationTolerance : 100;
  const largeExpenseThreshold = typeof source.largeExpenseThreshold === "number"
    && Number.isFinite(source.largeExpenseThreshold)
    && source.largeExpenseThreshold > 0
    ? source.largeExpenseThreshold : 1000;

  return {
    settings: {
      dataDirectory,
      csvMappings,
      baseCurrency,
      currencyFormat,
      reconciliationTolerance,
      largeExpenseThreshold
    },
    issues
  };
}
