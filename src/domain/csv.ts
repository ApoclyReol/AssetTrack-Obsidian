import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import type {
  CsvColumnMapping,
  CsvDelimiter,
  CsvEncoding,
  CsvImportFilterReason,
  CsvImportFilteredRow,
  CsvImportPreview,
  CsvInspection,
  CsvHeaderCandidate,
  CsvRawRow,
  CsvStructureSelection,
  CsvWorksheetCandidate
} from "../types/csv";
import type {
  Transaction
} from "../types/transactions";
import { scalarText } from "./text";
import { isMonth, normalizeDate } from "./dates";
import { AssetTrackError } from "../application/errors";

const ALLOWED_TYPES = new Set(["支出", "收入", "代付", "加仓", "提现"]);
const HEADER_SCAN_LIMIT = 200;
const RAW_PREVIEW_LIMIT = 120;
const CSV_FIELD_ALIASES: Record<string, string[]> = {
  date_column: ["日期", "交易时间", "时间", "创建时间", "付款时间"],
  product_column: ["商品", "商品说明", "商品/说明", "商品名称", "备注"],
  counterparty_column: ["交易对方", "对方", "商户", "商家名称", "收款方"],
  amount_column: ["金额", "金额(元)", "交易金额", "交易金额(元)"],
  type_column: ["收支", "收/支", "类型", "交易类型", "收支类型", "资金流向"],
  category_column: ["分类", "交易分类"],
  status_column: ["交易状态", "当前状态", "状态"]
};
const CSV_FIELD_LABELS: Record<string, string> = {
  date_column: "日期",
  product_column: "商品",
  counterparty_column: "对方",
  amount_column: "金额",
  type_column: "收支",
  category_column: "分类",
  status_column: "状态"
};

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

interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
}

function decodeCsv(content: Buffer): DecodedCsv {
  for (const encoding of ["utf-8", "gb18030"] as const) {
    try {
      return {
        text: new TextDecoder(encoding, { fatal: true }).decode(content)
          .replace(/^\ufeff/, ""),
        encoding
      };
    } catch {
      // Try the next supported bill encoding.
    }
  }
  return {
    text: new TextDecoder("utf-8").decode(content).replace(/^\ufeff/, ""),
    encoding: "utf-8-fallback"
  };
}

function delimiterFor(content: string): CsvDelimiter {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const candidates: CsvDelimiter[] = [",", "\t", ";"];
  return candidates.sort(
    (left, right) => firstLine.split(right).length - firstLine.split(left).length
  )[0] ?? ",";
}

function parseRows(content: string, preserveBlankRows = false): string[][] {
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
      if (preserveBlankRows || row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  const trailingBreak = /(?:\r\n|\r|\n)$/.test(content);
  row.push(value);
  if (row.some((cell) => cell.trim()) || (preserveBlankRows && !trailingBreak && content.length > 0)) {
    rows.push(row);
  }
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

interface SourceMatrix {
  rows: string[][];
  sheet_name?: string;
  worksheet_candidates?: CsvWorksheetCandidate[];
  encoding?: CsvEncoding;
  delimiter?: CsvDelimiter;
}

interface SourceObjectRow {
  row_number: number;
  values: Record<string, string>;
}

interface SourceObjects {
  headers: string[];
  rows: SourceObjectRow[];
  raw_rows: string[][];
  header_row: number;
  sheet_name?: string;
  worksheet_candidates?: CsvWorksheetCandidate[];
}

function csvMatrix(content: Buffer): SourceMatrix {
  const decoded = decodeCsv(content);
  return {
    rows: parseRows(decoded.text, true),
    encoding: decoded.encoding,
    delimiter: delimiterFor(decoded.text)
  };
}

function worksheetRows(sheet: XLSX.WorkSheet | undefined): string[][] {
  if (!sheet) return [];
  const values = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(
    sheet,
    { header: 1, raw: false, defval: "", blankrows: true }
  );
  return values.map((row) => row.map((value) => String(value ?? "").trim()));
}

function workbookMatrix(
  content: Buffer,
  selection?: CsvStructureSelection
): SourceMatrix {
  const workbook = XLSX.read(content, {
    type: "buffer",
    cellDates: false,
    raw: false
  });
  if (!workbook.SheetNames.length) {
    throw new AssetTrackError({ code: "csv.worksheet_missing", status: 422 });
  }
  const worksheetCandidates = workbook.SheetNames.map((name) => {
    const rows = worksheetRows(workbook.Sheets[name]);
    return {
      name,
      row_count: rows.filter(rowHasValue).length,
      header_candidates: headerCandidatesFor(rows)
    } satisfies CsvWorksheetCandidate;
  });
  const bestWorksheet = [...worksheetCandidates].sort((left, right) => {
    const scoreDifference = (right.header_candidates[0]?.score ?? -1)
      - (left.header_candidates[0]?.score ?? -1);
    if (scoreDifference !== 0) return scoreDifference;
    const rowDifference = right.row_count - left.row_count;
    if (rowDifference !== 0) return rowDifference;
    return workbook.SheetNames.indexOf(left.name) - workbook.SheetNames.indexOf(right.name);
  })[0]?.name ?? workbook.SheetNames[0];
  const sheetName = selection?.worksheet_name ?? bestWorksheet;
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new AssetTrackError({
      code: "csv.worksheet_invalid",
      status: 422,
      params: { worksheet: sheetName }
    });
  }
  const rows = worksheetRows(workbook.Sheets[sheetName]);
  if (!rows.length) {
    throw new AssetTrackError({ code: "csv.worksheet_header_missing", status: 422 });
  }
  return {
    sheet_name: sheetName,
    rows,
    worksheet_candidates: worksheetCandidates
  };
}

function sourceMatrix(
  filename: string,
  content: Buffer,
  selection?: CsvStructureSelection
): SourceMatrix {
  const extension = filename.toLocaleLowerCase("en-US").split(".").at(-1);
  if (extension === "csv") return csvMatrix(content);
  if (extension === "xlsx" || extension === "xls") {
    return workbookMatrix(content, selection);
  }
  throw new AssetTrackError({ code: "csv.extension_unsupported", status: 422 });
}

function rowHasValue(row: string[]): boolean {
  return row.some((value) => value.trim());
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^\ufeff/, "")
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .toLocaleLowerCase("zh-CN");
}

function columnsFor(values: string[]): Array<{ header: string; index: number }> {
  return values
    .map((value, index) => ({
      header: value.trim().replace(/^\ufeff/, ""),
      index
    }))
    .filter(({ header }) => header && !header.startsWith("Unnamed:"));
}

function matchedHeaderFields(headers: string[]): string[] {
  const normalizedHeaders = headers.map(normalizeHeader);
  return Object.entries(CSV_FIELD_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) =>
      normalizedHeaders.includes(normalizeHeader(alias))
    ))
    .map(([field]) => CSV_FIELD_LABELS[field] ?? field);
}

function headerFieldIndex(
  columns: Array<{ header: string; index: number }>,
  field: string
): number | undefined {
  const aliases = CSV_FIELD_ALIASES[field] ?? [];
  const column = columns.find(({ header }) => aliases.some((alias) =>
    normalizeHeader(alias) === normalizeHeader(header)
  ));
  return column?.index;
}

function rowLooksLikeData(
  values: string[],
  columns: Array<{ header: string; index: number }>
): boolean {
  const dateIndex = headerFieldIndex(columns, "date_column");
  const amountIndex = headerFieldIndex(columns, "amount_column");
  const dateValue = dateIndex === undefined ? "" : values[dateIndex]?.trim() ?? "";
  const amountValue = amountIndex === undefined ? "" : values[amountIndex]?.trim() ?? "";
  const dateLike = /\d{2,4}[年/-]\d{1,2}[月/-]\d{1,2}/.test(dateValue)
    || /\d{1,2}[月/]\d{1,2}/.test(dateValue);
  const amountLike = amountValue ? parseAmount(amountValue) !== null : false;
  return dateLike || amountLike || values.filter((value) => value.trim()).length >= 3;
}

function headerCandidateFor(
  rows: string[][],
  index: number
): CsvHeaderCandidate | null {
  const columns = columnsFor(rows[index] ?? []);
  const headers = columns.map(({ header }) => header);
  if (headers.length < 2) return null;
  try {
    validateHeaders(headers);
  } catch {
    return null;
  }
  const matchedFields = matchedHeaderFields(headers);
  if (!matchedFields.length) return null;
  const dataLikeRows = rows
    .slice(index + 1, index + 4)
    .filter((row) => rowLooksLikeData(row, columns)).length;
  const score = matchedFields.length * 100
    + Math.min(headers.length, 10)
    + dataLikeRows * 10;
  const confidence = matchedFields.length >= 4 && dataLikeRows > 0
    ? "high"
    : matchedFields.length >= 3
      ? "medium"
      : "low";
  return {
    row: index + 1,
    headers,
    matched_fields: matchedFields,
    score,
    confidence
  };
}

function headerCandidatesFor(rows: string[][]): CsvHeaderCandidate[] {
  return rows
    .slice(0, HEADER_SCAN_LIMIT)
    .flatMap((_, index) => {
      const candidate = headerCandidateFor(rows, index);
      return candidate ? [candidate] : [];
    })
    .sort((left, right) => right.score - left.score || left.row - right.row)
    .slice(0, 8);
}

function firstNonEmptyRow(rows: string[][]): number {
  const index = rows.findIndex(rowHasValue);
  return index < 0 ? 1 : index + 1;
}

function resolvedHeaderRow(
  rows: string[][],
  candidates: CsvHeaderCandidate[],
  selection?: CsvStructureSelection
): number {
  const row = selection?.header_row ?? candidates[0]?.row ?? firstNonEmptyRow(rows);
  if (!Number.isInteger(row) || row < 1 || row > rows.length) {
    throw new AssetTrackError({
      code: "csv.header_row_invalid",
      status: 422,
      params: { row }
    });
  }
  return row;
}

function objectsFromMatrix(rows: string[][], headerRow: number): SourceObjects {
  const headerValues = rows[headerRow - 1];
  if (!headerValues) {
    throw new AssetTrackError({
      code: "csv.header_row_invalid",
      status: 422,
      params: { row: headerRow }
    });
  }
  const columns = columnsFor(headerValues);
  const headers = columns.map(({ header }) => header);
  validateHeaders(headers);
  const sourceRows = rows.slice(headerRow).flatMap((values, index) => {
    if (!rowHasValue(values)) return [];
    return [{
      row_number: headerRow + index + 1,
      values: Object.fromEntries(
        columns.map(({ header, index: columnIndex }) => [
          header,
          values[columnIndex]?.trim() ?? ""
        ])
      )
    }];
  });
  return {
    headers,
    rows: sourceRows,
    raw_rows: rows,
    header_row: headerRow
  };
}

function sourceObjects(
  filename: string,
  content: Buffer,
  selection?: CsvStructureSelection
): SourceObjects {
  const source = sourceMatrix(filename, content, selection);
  if (!source.rows.length) {
    throw new AssetTrackError({ code: "csv.header_missing", status: 422 });
  }
  const candidates = headerCandidatesFor(source.rows);
  const headerRow = resolvedHeaderRow(source.rows, candidates, selection);
  const parsed = objectsFromMatrix(source.rows, headerRow);
  return {
    ...parsed,
    sheet_name: source.sheet_name,
    worksheet_candidates: source.worksheet_candidates
  };
}

function rawRowsForDisplay(
  rows: string[][],
  headerRow: number,
  candidates: CsvHeaderCandidate[]
): CsvRawRow[] {
  const indexes = new Set<number>();
  for (let index = 0; index < Math.min(rows.length, RAW_PREVIEW_LIMIT); index += 1) {
    indexes.add(index);
  }
  for (const candidate of candidates) {
    for (let index = Math.max(0, candidate.row - 3); index <= Math.min(rows.length - 1, candidate.row + 1); index += 1) {
      indexes.add(index);
    }
  }
  for (let index = Math.max(0, headerRow - 3); index <= Math.min(rows.length - 1, headerRow + 1); index += 1) {
    indexes.add(index);
  }
  return [...indexes]
    .sort((left, right) => left - right)
    .map((index) => ({ row: index + 1, values: rows[index] ?? [] }));
}

export function inspectCsv(
  month: string,
  filename: string,
  content: Buffer,
  selection?: CsvStructureSelection
): CsvInspection {
  if (!isMonth(month)) {
    throw new AssetTrackError({ code: "month.invalid", status: 422, params: { month } });
  }
  const source = sourceMatrix(filename, content, selection);
  if (!source.rows.length) {
    throw new AssetTrackError({ code: "csv.header_missing", status: 422 });
  }
  const candidates = headerCandidatesFor(source.rows);
  const headerRow = resolvedHeaderRow(source.rows, candidates, selection);
  const parsed = objectsFromMatrix(source.rows, headerRow);
  const { headers } = parsed;
  const rows = parsed.rows.map(({ values }) => values);
  const signatureSource = source.sheet_name
    ? {
        worksheet_name: source.sheet_name,
        header_row: headerRow,
        headers
      }
    : headers;
  const signature = createHash("sha256")
    .update(JSON.stringify(signatureSource), "utf8")
    .digest("hex");
  const suggested: Partial<CsvColumnMapping> = {};
  for (const [field, aliases] of Object.entries(CSV_FIELD_ALIASES)) {
    const match = aliases.find((alias) => headers.some((header) =>
      normalizeHeader(header) === normalizeHeader(alias)
    ));
    if (match) {
      const matchedHeader = headers.find((header) =>
        normalizeHeader(header) === normalizeHeader(match)
      );
      if (matchedHeader) (suggested as Record<string, unknown>)[field] = matchedHeader;
    }
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
  const bestCandidate = candidates[0];
  const firstRowIsReasonable = bestCandidate?.row === 1
    && bestCandidate.confidence !== "low";
  return {
    month,
    filename,
    headers,
    header_signature: signature,
    row_count: parsed.rows.length,
    sample_rows: rows.slice(0, 8),
    empty_values: Object.fromEntries(headers.map((header) => [
      header,
      rows.some((row) => !(row[header] ?? "").trim())
    ])),
    empty_counts: Object.fromEntries(headers.map((header) => [
      header,
      rows.reduce(
        (count, row) => count + (!(row[header] ?? "").trim() ? 1 : 0),
        0
      )
    ])),
    value_counts: Object.fromEntries(headers.map((header) => {
      const counts: Record<string, number> = {};
      for (const row of rows) {
        const value = row[header]?.trim() ?? "";
        if (value) counts[value] = (counts[value] ?? 0) + 1;
      }
      return [header, counts];
    })),
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
    header_status: selection?.header_row !== undefined || firstRowIsReasonable
      ? "normal"
      : "needs_confirmation",
    header_confirmed: selection?.header_row !== undefined,
    header_row: headerRow,
    data_start_row: headerRow + 1,
    raw_row_count: source.rows.length,
    raw_rows: rawRowsForDisplay(source.rows, headerRow, candidates),
    header_candidates: candidates,
    worksheet_name: source.sheet_name,
    worksheet_candidates: source.worksheet_candidates,
    encoding: source.encoding,
    delimiter: source.delimiter,
    suggested_mapping: suggested
  };
}

export function previewCsv(
  month: string,
  filename: string,
  content: Buffer,
  mapping: CsvColumnMapping,
  selection?: CsvStructureSelection
): CsvImportPreview {
  if (!isMonth(month)) {
    throw new AssetTrackError({ code: "month.invalid", status: 422, params: { month } });
  }
  const { headers, rows: sourceRows } = sourceObjects(filename, content, selection);
  const required: Array<[keyof CsvColumnMapping, string]> = [
    ["date_column", "日期"],
    ["product_column", "商品"],
    ["amount_column", "金额"],
    ["type_column", "收支"]
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
        counterparty_column: "对方",
        category_column: "分类",
        status_column: "状态"
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
    ignored_type: [],
    invalid_date: [],
    invalid_amount: [],
    unmapped_type: []
  };
  const defaulted: Record<string, number> = { date: 0 };
  const defaultedExamples: Record<string, Array<Record<string, unknown>>> = {
    date: []
  };
  const filtered = Object.fromEntries(Object.keys(examples).map((key) => [key, 0]));
  const filteredRows: CsvImportFilteredRow[] = [];
  const acceptedSourceRows: CsvRawRow[] = [];
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
  sourceRows.forEach((source) => {
    const rowNumber = source.row_number;
    const sourceValues = source.values;
    const status = mapping.status_column ? sourceValues[mapping.status_column]?.trim() ?? "" : "";
    if (mapping.status_column && !includedStatuses.has(status)) {
      recordFiltered("status_filtered", rowNumber, sourceValues, { row: rowNumber, status });
      return;
    }
    const rawType = sourceValues[mapping.type_column]?.trim() ?? "";
    const type = String(mapping.type_values?.[rawType] ?? "").trim();
    if (type === "忽略") {
      recordFiltered("ignored_type", rowNumber, sourceValues, { row: rowNumber, value: rawType });
      return;
    }
    if (!ALLOWED_TYPES.has(type)) {
      recordFiltered("unmapped_type", rowNumber, sourceValues, { row: rowNumber, reason: `收支值“${rawType}”尚未映射` });
      return;
    }
    const sourceDate = mapping.date_column === "__month_start__"
      ? `${month}-01`
      : sourceValues[mapping.date_column] ?? "";
    const rawDate = String(sourceDate);
    const dateWasDefaulted = mapping.date_column === "__month_start__"
      || !rawDate.trim();
    let date: string;
    try {
      date = normalizeDate(rawDate, month);
    } catch {
      recordFiltered("invalid_date", rowNumber, sourceValues, { row: rowNumber, reason: `日期无法识别：${rawDate}` });
      return;
    }
    if (dateWasDefaulted) {
      defaulted.date += 1;
      if (defaultedExamples.date.length < 3) {
        defaultedExamples.date.push({ row: rowNumber, value: rawDate.trim() || "(空)" });
      }
    }
    if (date.slice(0, 7) !== month) {
      recordFiltered("outside_month", rowNumber, sourceValues, { row: rowNumber, date });
      return;
    }
    const product = sourceValues[mapping.product_column]?.trim() ?? "";
    const rawAmount = sourceValues[mapping.amount_column] ?? "";
    const amount = parseAmount(rawAmount);
    if (amount === null) {
      recordFiltered("invalid_amount", rowNumber, sourceValues, { row: rowNumber, reason: "金额为空或无法识别" });
      return;
    }
    const category = ["加仓", "提现"].includes(type)
      ? ""
      : mapping.category_column
        ? sourceValues[mapping.category_column]?.trim() ?? ""
        : "";
    rows.push({
      client_id: `import:${randomUUID()}:${rowNumber}`,
      source: `${filename} · 原始第 ${rowNumber} 行`,
      transaction_date: date,
      product,
      amount: Math.abs(amount),
      type,
      category_key: null,
      category,
      counterparty: mapping.counterparty_column
        ? sourceValues[mapping.counterparty_column]?.trim() ?? ""
        : ""
    });
    acceptedSourceRows.push({ row: rowNumber, values: headers.map((header) => sourceValues[header] ?? "") });
  });
  const typeSummary: Record<string, number> = {};
  rows.forEach((row) => {
    typeSummary[row.type] = (typeSummary[row.type] ?? 0) + 1;
  });
  return {
    month,
    rows,
    source_rows: acceptedSourceRows,
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
