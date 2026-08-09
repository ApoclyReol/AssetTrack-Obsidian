import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import type {
  CsvColumnMapping,
  CsvImportFilterReason,
  CsvImportFilteredRow,
  CsvImportPreview,
  CsvInspection
} from "../types/csv";
import type {
  Transaction
} from "../types/transactions";
import { scalarText } from "./text";
import { isMonth, normalizeDate } from "./dates";
import { AssetTrackError } from "../application/errors";

const ALLOWED_TYPES = new Set(["支出", "收入", "代付", "加仓", "提现"]);

function parseAmount(value: string): number | null {
  const source = value.trim()
    .replace(/^[¥￥]\s*/, "")
    .replace(/\s*元$/, "")
    .trim();
  if (!source) return null;
  const unsigned = source.replace(/^[+-]/, "");
  const valid = /^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?: \d{3})+(?:\.\d+)?)$/.test(unsigned);
  if (!valid) return null;
  const amount = Number(source.replace(/[, ]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function decodeCsv(content: Buffer): string {
  for (const encoding of ["utf-8", "gb18030"] as const) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(content)
        .replace(/^\ufeff/, "");
    } catch {
      // Try the next supported bill encoding.
    }
  }
  return new TextDecoder("utf-8").decode(content).replace(/^\ufeff/, "");
}

function delimiterFor(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";"];
  return candidates.sort(
    (left, right) => firstLine.split(right).length - firstLine.split(left).length
  )[0];
}

function parseRows(content: string): string[][] {
  const delimiter = delimiterFor(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\"") {
      if (quoted && content[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function validateHeaders(headers: string[]): void {
  if (!headers.length) {
    throw new AssetTrackError({ code: "csv.header_missing", status: 422 });
  }
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
    if (seen.has(key)) {
      throw new AssetTrackError({
        code: "csv.duplicate_header",
        status: 422,
        params: { header }
      });
    }
    seen.add(key);
  }
}

function csvObjects(content: Buffer): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const parsed = parseRows(decodeCsv(content));
  if (!parsed.length) throw new AssetTrackError({ code: "csv.header_missing", status: 422 });
  const columns = parsed[0]
    .map((header, index) => ({
      header: header.trim().replace(/^\ufeff/, ""),
      index
    }))
    .filter(({ header }) => header && !header.startsWith("Unnamed:"));
  const headers = columns.map(({ header }) => header);
  validateHeaders(headers);
  const rows = parsed.slice(1).map((values) =>
    Object.fromEntries(columns.map(({ header, index }) => [header, values[index]?.trim() ?? ""]))
  );
  return { headers, rows };
}

function workbookObjects(content: Buffer): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const workbook = XLSX.read(content, {
    type: "buffer",
    cellDates: false,
    raw: false
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new AssetTrackError({ code: "csv.worksheet_missing", status: 422 });
  const values = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(
    workbook.Sheets[sheetName],
    { header: 1, raw: false, defval: "", blankrows: false }
  );
  if (!values.length) throw new AssetTrackError({ code: "csv.worksheet_header_missing", status: 422 });
  const columns = values[0]
    .map((value, index) => ({
      header: String(value).trim(),
      index
    }))
    .filter(({ header }) => header && !header.startsWith("Unnamed:"));
  const headers = columns.map(({ header }) => header);
  validateHeaders(headers);
  const rows = values.slice(1).map((row) =>
    Object.fromEntries(
      columns.map(({ header, index }) => [header, String(row[index] ?? "").trim()])
    )
  );
  return { headers, rows };
}

function sourceObjects(filename: string, content: Buffer): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const extension = filename.toLocaleLowerCase("en-US").split(".").at(-1);
  if (extension === "csv") return csvObjects(content);
  if (extension === "xlsx" || extension === "xls") {
    return workbookObjects(content);
  }
  throw new AssetTrackError({ code: "csv.extension_unsupported", status: 422 });
}

export function inspectCsv(
  month: string,
  filename: string,
  content: Buffer
): CsvInspection {
  if (!isMonth(month)) {
    throw new AssetTrackError({ code: "month.invalid", status: 422, params: { month } });
  }
  const { headers, rows } = sourceObjects(filename, content);
  const signature = createHash("sha256")
    .update(JSON.stringify(headers), "utf8")
    .digest("hex");
  const aliases: Record<string, string[]> = {
    date_column: ["日期", "交易时间", "时间", "创建时间", "付款时间"],
    product_column: ["商品", "商品说明", "商品/说明", "商品名称", "备注"],
    counterparty_column: ["交易对方", "对方", "商户", "商家名称", "收款方"],
    amount_column: ["金额", "金额(元)", "交易金额", "交易金额(元)"],
    type_column: ["收支", "收/支", "类型", "资金流向"],
    category_column: ["分类", "交易分类"],
    status_column: ["交易状态", "状态"]
  };
  const suggested: Partial<CsvColumnMapping> = {};
  for (const [field, candidates] of Object.entries(aliases)) {
    const match = candidates.find((candidate) => headers.includes(candidate));
    if (match) (suggested as Record<string, unknown>)[field] = match;
  }
  if (
    ["商品", "收支", "金额"].every((header) => headers.includes(header))
    && !suggested.date_column
  ) {
    suggested.date_column = "__month_start__";
  }
  if (
    suggested.product_column
    && suggested.amount_column
    && suggested.type_column
    && !suggested.date_column
  ) {
    suggested.date_column = "__month_start__";
  }
  return {
    month,
    filename,
    headers,
    header_signature: signature,
    row_count: rows.length,
    sample_rows: rows.slice(0, 8),
    empty_values: Object.fromEntries(headers.map((header) => [
      header,
      rows.some((row) => !(row[header] ?? "").trim())
    ])),
    distinct_values: Object.fromEntries(headers.map((header) => {
      const values: string[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const value = row[header]?.trim();
        if (value && !seen.has(value)) {
          seen.add(value);
          values.push(value);
        }
      }
      return [header, values];
    })),
    suggested_mapping: suggested
  };
}

export function previewCsv(
  month: string,
  filename: string,
  content: Buffer,
  mapping: CsvColumnMapping
): CsvImportPreview {
  if (!isMonth(month)) {
    throw new AssetTrackError({ code: "month.invalid", status: 422, params: { month } });
  }
  const { headers, rows: sourceRows } = sourceObjects(filename, content);
  const required: Array<[keyof CsvColumnMapping, string]> = [
    ["date_column", "日期/时间"],
    ["product_column", "商品或说明"],
    ["amount_column", "金额"],
    ["type_column", "收支方向"]
  ];
  for (const [field, label] of required) {
    const selected = scalarText(mapping[field]).trim();
    if (!selected
      || (selected === "__month_start__" && field !== "date_column")
      || (selected !== "__month_start__" && !headers.includes(selected))) {
      throw new AssetTrackError({
        code: "csv.mapping_required",
        status: 422,
        params: { field, label }
      });
    }
  }
  for (const field of [
    "counterparty_column",
    "category_column",
    "status_column"
  ] as const) {
    const selected = scalarText(mapping[field]).trim();
    if (selected && !headers.includes(selected)) {
      const labels = {
        counterparty_column: "交易对方",
        category_column: "分类",
        status_column: "交易状态"
      };
      throw new AssetTrackError({
        code: "csv.mapping_missing",
        status: 422,
        params: { field, label: labels[field] }
      });
    }
  }
  if (mapping.status_column && !(mapping.included_statuses ?? []).length) {
    throw new AssetTrackError({
      code: "csv.status_selection_required",
      status: 422
    });
  }
  const examples: Record<string, Array<Record<string, unknown>>> = {
    outside_month: [],
    status_filtered: [],
    invalid: [],
    ignored_type: []
  };
  const defaulted: Record<string, number> = { date: 0 };
  const defaultedExamples: Record<string, Array<Record<string, unknown>>> = {
    date: []
  };
  const filtered = Object.fromEntries(Object.keys(examples).map((key) => [key, 0]));
  const filteredRows: CsvImportFilteredRow[] = [];
  const recordFiltered = (
    reason: CsvImportFilterReason,
    row: number,
    source: Record<string, string>,
    example: Record<string, unknown>
  ): void => {
    filtered[reason] += 1;
    if (examples[reason].length < 3) examples[reason].push(example);
    filteredRows.push({ row, reason, values: { ...source } });
  };
  const rows: Transaction[] = [];
  const includedStatuses = new Set(mapping.included_statuses ?? []);
  sourceRows.forEach((source, sourceIndex) => {
    const rowNumber = sourceIndex + 2;
    const status = mapping.status_column ? source[mapping.status_column]?.trim() ?? "" : "";
    if (mapping.status_column && !includedStatuses.has(status)) {
      recordFiltered("status_filtered", rowNumber, source, { row: rowNumber, status });
      return;
    }
    const rawType = source[mapping.type_column]?.trim() ?? "";
    const type = String(mapping.type_values?.[rawType] ?? "").trim();
    if (type === "忽略") {
      recordFiltered("ignored_type", rowNumber, source, { row: rowNumber, value: rawType });
      return;
    }
    if (!ALLOWED_TYPES.has(type)) {
      recordFiltered("invalid", rowNumber, source, { row: rowNumber, reason: `收支值“${rawType}”尚未映射` });
      return;
    }
    const sourceDate = mapping.date_column === "__month_start__"
      ? `${month}-01`
      : source[mapping.date_column] ?? "";
    const rawDate = String(sourceDate);
    const dateWasDefaulted = mapping.date_column === "__month_start__"
      || !rawDate.trim();
    let date: string;
    try {
      date = normalizeDate(rawDate, month);
    } catch {
      recordFiltered("invalid", rowNumber, source, { row: rowNumber, reason: `日期无法识别：${rawDate}` });
      return;
    }
    if (dateWasDefaulted) {
      defaulted.date += 1;
      if (defaultedExamples.date.length < 3) {
        defaultedExamples.date.push({ row: rowNumber, value: rawDate.trim() || "(空)" });
      }
    }
    if (date.slice(0, 7) !== month) {
      recordFiltered("outside_month", rowNumber, source, { row: rowNumber, date });
      return;
    }
    const product = source[mapping.product_column]?.trim() ?? "";
    const rawAmount = source[mapping.amount_column] ?? "";
    const amount = parseAmount(rawAmount);
    if (amount === null) {
      recordFiltered("invalid", rowNumber, source, { row: rowNumber, reason: "金额为空或无法识别" });
      return;
    }
    const category = ["加仓", "提现"].includes(type)
      ? ""
      : mapping.category_column
        ? source[mapping.category_column]?.trim() ?? ""
        : "";
    rows.push({
      client_id: `import:${randomUUID()}:${sourceIndex}`,
      source: filename,
      transaction_date: date,
      product,
      amount: Math.abs(amount),
      type,
      category_key: null,
      category,
      counterparty: mapping.counterparty_column
        ? source[mapping.counterparty_column]?.trim() ?? ""
        : ""
    });
  });
  const typeSummary: Record<string, number> = {};
  rows.forEach((row) => {
    typeSummary[row.type] = (typeSummary[row.type] ?? 0) + 1;
  });
  return {
    month,
    rows,
    issues: [],
    type_summary: typeSummary,
    modes: ["append", "replace"],
    import_stats: {
      source_rows: sourceRows.length,
      accepted_rows: rows.length,
      defaulted,
      defaulted_examples: defaultedExamples,
      filtered,
      examples,
      filtered_rows: filteredRows
    }
  };
}
