import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type {
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  Transaction
} from "../types";
import { scalarText } from "./text";
import { normalizeDate } from "./dates";

const ALLOWED_TYPES = new Set(["支出", "收入", "代付", "加仓", "提现"]);

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

function csvObjects(content: Buffer): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const parsed = parseRows(decodeCsv(content));
  if (!parsed.length) throw new Error("CSV 没有可识别的表头");
  const headers = parsed[0]
    .map((header) => header.trim().replace(/^\ufeff/, ""))
    .filter((header) => header && !header.startsWith("Unnamed:"));
  const rows = parsed.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]))
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
  if (!sheetName) throw new Error("工作簿中没有可读取的工作表");
  const values = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(
    workbook.Sheets[sheetName],
    { header: 1, raw: false, defval: "", blankrows: false }
  );
  if (!values.length) throw new Error("工作表没有可识别的表头");
  const headers = values[0]
    .map((value) => String(value).trim())
    .filter((header) => header && !header.startsWith("Unnamed:"));
  const rows = values.slice(1).map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, String(row[index] ?? "").trim()])
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
  throw new Error("当前导入入口支持 CSV、XLSX 和 XLS 文件");
}

export function inspectCsv(
  month: string,
  filename: string,
  content: Buffer
): CsvInspection {
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
  return {
    month,
    filename,
    headers,
    header_signature: signature,
    row_count: rows.length,
    sample_rows: rows.slice(0, 8),
    distinct_values: Object.fromEntries(headers.map((header) => {
      const values: string[] = [];
      for (const row of rows) {
        const value = row[header]?.trim();
        if (value && !values.includes(value)) values.push(value);
        if (values.length >= 30) break;
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
  const { headers, rows: sourceRows } = sourceObjects(filename, content);
  const required: Array<[keyof CsvColumnMapping, string]> = [
    ["date_column", "日期/时间"],
    ["product_column", "商品或说明"],
    ["amount_column", "金额"],
    ["type_column", "收支方向"]
  ];
  for (const [field, label] of required) {
    const selected = scalarText(mapping[field]).trim();
    if (!selected || (selected !== "__month_start__" && !headers.includes(selected))) {
      throw new Error(`请选择有效的${label}列`);
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
      throw new Error(`选择的${labels[field]}列不存在`);
    }
  }
  const examples: Record<string, Array<Record<string, unknown>>> = {
    outside_month: [],
    status_filtered: [],
    invalid: [],
    ignored_type: []
  };
  const filtered = Object.fromEntries(Object.keys(examples).map((key) => [key, 0]));
  const rows: Transaction[] = [];
  const includedStatuses = new Set(mapping.included_statuses ?? []);
  sourceRows.forEach((source, sourceIndex) => {
    const rowNumber = sourceIndex + 2;
    const status = mapping.status_column ? source[mapping.status_column]?.trim() ?? "" : "";
    if (mapping.status_column && !includedStatuses.has(status)) {
      filtered.status_filtered += 1;
      if (examples.status_filtered.length < 3) examples.status_filtered.push({ row: rowNumber, status });
      return;
    }
    const rawType = source[mapping.type_column]?.trim() ?? "";
    const type = String(mapping.type_values?.[rawType] ?? "").trim();
    if (type === "忽略") {
      filtered.ignored_type += 1;
      if (examples.ignored_type.length < 3) examples.ignored_type.push({ row: rowNumber, value: rawType });
      return;
    }
    if (!ALLOWED_TYPES.has(type)) {
      filtered.invalid += 1;
      if (examples.invalid.length < 3) examples.invalid.push({ row: rowNumber, reason: `收支值“${rawType}”尚未映射` });
      return;
    }
    const rawDate = mapping.date_column === "__month_start__"
      ? `${month}-01`
      : source[mapping.date_column] ?? "";
    let date: string;
    try {
      date = normalizeDate(rawDate);
    } catch {
      filtered.invalid += 1;
      if (examples.invalid.length < 3) examples.invalid.push({ row: rowNumber, reason: `日期无法识别：${rawDate}` });
      return;
    }
    if (date.slice(0, 7) !== month) {
      filtered.outside_month += 1;
      if (examples.outside_month.length < 3) examples.outside_month.push({ row: rowNumber, date });
      return;
    }
    const product = source[mapping.product_column]?.trim() ?? "";
    const amount = Number(
      (source[mapping.amount_column] ?? "")
        .replace(/[¥￥,元\s]/g, "")
    );
    if (!product || !Number.isFinite(amount) || amount === 0) {
      filtered.invalid += 1;
      if (examples.invalid.length < 3) examples.invalid.push({ row: rowNumber, reason: "商品为空或金额无法识别" });
      return;
    }
    const category = ["代付", "加仓", "提现"].includes(type)
      ? ""
      : mapping.category_column
        ? source[mapping.category_column]?.trim() ?? ""
        : "";
    rows.push({
      client_id: `import:${sourceIndex}`,
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
      filtered,
      examples
    }
  };
}
