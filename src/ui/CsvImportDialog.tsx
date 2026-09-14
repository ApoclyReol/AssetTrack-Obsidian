import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import type {
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  ImportMode,
  CsvStructureSelection
} from "../types/csv";
import { scalarText } from "../domain/text";
import { businessLabel, displayError, fieldLabel, t } from "../i18n";
import { issueIsBlocking } from "./editorPrimitives";
import { StaticTableHeader } from "./TablePrimitives";

const TYPES = ["支出", "收入", "代付", "加仓", "提现", "忽略"] as const;
function requiredFields(): Array<[keyof CsvColumnMapping, string]> {
  return [
    ["date_column", t("日期", "Date")],
    ["product_column", t("商品", "Item")],
    ["amount_column", t("金额", "Amount")],
    ["type_column", t("收支", "Type")]
  ];
}

function optionalFields(): Array<[keyof CsvColumnMapping, string]> {
  return [
    ["counterparty_column", t("对方", "Counterparty")],
    ["category_column", t("分类", "Category")],
    ["status_column", t("状态", "Status")]
  ];
}

function fieldHelp(field: keyof CsvColumnMapping): string {
  switch (field) {
    case "date_column": return t("用于判断流水是否属于当前月份", "Used to check whether a row belongs to the current month");
    case "product_column": return t("商品、备注或交易说明", "Item, note, or transaction description");
    case "amount_column": return t("应能识别为数字金额", "Should contain a recognizable numeric amount");
    case "type_column": return t("决定记为支出、收入或理财流水", "Determines whether a row is an expense, income, or investment flow");
    case "counterparty_column": return t("交易对方或商户名称", "Counterparty or merchant name");
    case "category_column": return t("可用于补充或覆盖分类", "Can be used to add or replace a category");
    case "status_column": return t("用于筛选已完成、成功等状态", "Used to filter completed, successful, or other statuses");
    default: return "";
  }
}

function filterLabel(reason: string): string {
  return {
    outside_month: t("跨月", "Outside month"),
    status_filtered: t("状态过滤", "Status filtered"),
    ignored_type: t("忽略类型", "Ignored type"),
    invalid_date: t("日期无法识别", "Invalid date"),
    invalid_amount: t("金额无法识别", "Invalid amount"),
    unmapped_type: t("收支值未映射", "Unmapped type")
  }[reason] ?? reason;
}
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");
const SAMPLE_VALUE_LIMIT = 18;

type ImportDialogPage = 1 | 2 | 3;

function canFocus(
  element: Element | null
): element is Element & { focus(): void } {
  return element !== null
    && "focus" in element
    && typeof element.focus === "function";
}

function describeExample(example: Record<string, unknown>): string {
  return Object.entries(example)
    .map(([key, value]) => key === "row"
      ? t(`第 ${String(value)} 行`, `row ${String(value)}`)
      : key === "status" && !String(value)
        ? `${fieldLabel(key)} ${t("（空状态）", "(empty status)")}`
      : `${fieldLabel(key)} ${key === "reason" ? displayError(value) : String(value)}`)
    .join(t("，", ", "));
}

function totalFilteredRows(preview: CsvImportPreview): number {
  return Object.values(preview.import_stats.filtered)
    .reduce((total, count) => total + Number(count ?? 0), 0);
}

function invalidFilteredRows(preview: CsvImportPreview): number {
  return ["invalid_date", "invalid_amount", "unmapped_type"]
    .reduce((total, reason) => total + Number(preview.import_stats.filtered[reason] ?? 0), 0);
}

function statusValuesFor(
  inspection: CsvInspection,
  column: string
): string[] {
  const values = [...inspection.distinct_values[column] ?? []];
  if (inspection.empty_values[column] && !values.includes("")) values.push("");
  return values;
}

function typeValuesFor(
  inspection: CsvInspection,
  column: string
): string[] {
  const values = [...inspection.distinct_values[column] ?? []];
  if (inspection.empty_values[column] && !values.includes("")) values.push("");
  return values;
}

function sampleValuesFor(
  inspection: CsvInspection,
  column: string
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const row of inspection.sample_rows) {
    const value = row[column]?.trim() ?? "";
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
    if (values.length >= 2) break;
  }
  return values;
}

function shortenSampleValue(value: string): string {
  const characters = Array.from(value);
  return characters.length > SAMPLE_VALUE_LIMIT
    ? `${characters.slice(0, SAMPLE_VALUE_LIMIT).join("")}…`
    : value;
}

function valueCountFor(
  inspection: CsvInspection,
  column: string,
  value: string
): number | null {
  if (value === "") {
    const count = inspection.empty_counts?.[column];
    return count === undefined ? null : count;
  }
  const counts = inspection.value_counts?.[column];
  if (!counts) return null;
  return counts[value] ?? 0;
}

function formatColumnMeta(
  inspection: CsvInspection,
  column: string
): string {
  const samples = sampleValuesFor(inspection, column).map(shortenSampleValue);
  const emptyCount = inspection.empty_counts?.[column];
  const empty = emptyCount === undefined
    ? inspection.empty_values[column]
      ? t("含空值", "Contains empty values")
      : t("无空值", "No empty values")
    : t(`${emptyCount} 个空值`, `${emptyCount} empty values`);
  const example = samples.length > 0
    ? `${t("示例", "Examples")}: ${samples.join(" / ")}`
    : t("暂无非空示例", "No non-empty examples");
  return `${example} · ${empty}`;
}

function formatFileType(filename: string): string {
  const extension = filename.split(".").at(-1)?.toUpperCase();
  return extension || t("未知格式", "Unknown format");
}

function formatEncoding(encoding?: string): string {
  if (encoding === "utf-8") return "UTF-8";
  if (encoding === "gb18030") return "GB18030";
  if (encoding === "utf-8-fallback") return t("UTF-8（宽松读取）", "UTF-8 (fallback)");
  return t("不适用", "Not applicable");
}

function formatDelimiter(delimiter?: string): string {
  if (delimiter === "\t") return t("制表符 Tab", "Tab");
  if (delimiter === ";") return ";";
  if (delimiter === ",") return ",";
  return t("不适用", "Not applicable");
}

function acceptedDateRange(preview: CsvImportPreview): string {
  const dates = preview.rows
    .map((row) => row.transaction_date)
    .filter(Boolean)
    .sort();
  if (!dates.length) return t("暂无接受流水", "No accepted rows");
  const first = dates[0];
  const last = dates.at(-1) ?? first;
  return first === last ? first : `${first} → ${last}`;
}

function previewIssueText(issue: Record<string, unknown>): string {
  const field = fieldLabel(scalarText(issue.field) || "流水");
  const row = Number(issue.row_index);
  const rowLabel = Number.isFinite(row)
    ? t(`第 ${row + 1} 行`, `row ${row + 1}`)
    : "";
  const reason = scalarText(issue.issue ?? issue.reason)
    || t("需要检查这条流水", "This transaction needs review");
  const suggestion = scalarText(issue.suggestion);
  return `${rowLabel ? `${rowLabel} · ` : ""}${field}${t("：", ": ")}${displayError(reason)}${suggestion ? ` · ${displayError(suggestion)}` : ""}`;
}

function initialMapping(
  inspection: CsvInspection,
  saved?: CsvColumnMapping
): CsvColumnMapping {
  const suggested = inspection.suggested_mapping;
  const base: CsvColumnMapping = saved
    ? structuredClone(saved)
    : {
        date_column: String(suggested.date_column ?? ""),
        product_column: String(suggested.product_column ?? ""),
        counterparty_column: String(suggested.counterparty_column ?? ""),
        amount_column: String(suggested.amount_column ?? ""),
        type_column: String(suggested.type_column ?? ""),
        category_column: String(suggested.category_column ?? ""),
        status_column: String(suggested.status_column ?? ""),
        type_values: {},
        included_statuses: []
      };
  for (const raw of typeValuesFor(inspection, base.type_column)) {
    if (!(raw in base.type_values)) {
      base.type_values[raw] = TYPES.includes(raw as typeof TYPES[number])
        ? raw
        : "";
    }
  }
  const actualStatuses = new Set(
    statusValuesFor(inspection, base.status_column ?? "")
  );
  if (!saved && base.status_column && actualStatuses.has("")) {
    base.included_statuses = [""];
  } else {
    base.included_statuses = base.included_statuses.filter(
      (status) => actualStatuses.has(status)
    );
  }
  return base;
}

export function CsvImportDialog({
  hostWindow,
  inspection,
  savedMapping,
  onCancel,
  onHeaderRowChange,
  onClearSavedMapping,
  onPreview,
  onApply
}: {
  hostWindow: Window;
  inspection: CsvInspection;
  savedMapping?: CsvColumnMapping;
  onCancel: () => void;
  onHeaderRowChange?: (
    selection: CsvStructureSelection
  ) => Promise<CsvInspection>;
  onClearSavedMapping?: (signature: string) => Promise<void>;
  onPreview: (
    mapping: CsvColumnMapping,
    selection?: CsvStructureSelection
  ) => Promise<CsvImportPreview>;
  onApply: (
    preview: CsvImportPreview,
    mode: ImportMode,
    mapping: CsvColumnMapping
  ) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [activeInspection, setActiveInspection] = useState<CsvInspection>(inspection);
  const [mapping, setMapping] = useState<CsvColumnMapping>(() =>
    initialMapping(inspection, savedMapping)
  );
  const [mode, setMode] = useState<ImportMode>("append");
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [headerBusy, setHeaderBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [page, setPage] = useState<ImportDialogPage>(1);
  const [headerRowInput, setHeaderRowInput] = useState(
    String(inspection.header_row ?? 1)
  );
  const [headerError, setHeaderError] = useState("");
  const [headerSelectorOpen, setHeaderSelectorOpen] = useState(
    inspection.header_status === "needs_confirmation" && !inspection.header_confirmed
  );
  const [error, setError] = useState("");
  const previewRequestSequence = useRef(0);
  useEffect(() => {
    setActiveInspection(inspection);
    setMapping(initialMapping(inspection, savedMapping));
    setPreview(null);
    setPage(1);
    setHeaderRowInput(String(inspection.header_row ?? 1));
    setHeaderError("");
    setHeaderSelectorOpen(
      inspection.header_status === "needs_confirmation" && !inspection.header_confirmed
    );
  }, [inspection, savedMapping]);
  useEffect(() => {
    const previousFocus = hostWindow.document.activeElement;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      FOCUSABLE_SELECTOR
    );
    first?.focus();
    return () => {
      if (canFocus(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [hostWindow]);
  const interactionBusy = busy || headerBusy || mappingBusy;
  const headerStatus = activeInspection.header_status ?? "normal";
  const headerRow = activeInspection.header_row ?? 1;
  const headerCandidates = activeInspection.header_candidates ?? [];
  const rawRows = activeInspection.raw_rows ?? [];
  const rawRowCount = activeInspection.raw_row_count ?? rawRows.length;
  const headerNeedsConfirmation = headerStatus === "needs_confirmation"
    || activeInspection.header_confirmed === false;
  const worksheetCandidates = activeInspection.worksheet_candidates ?? [];
  const selectedWorksheetName = activeInspection.worksheet_name
    ?? worksheetCandidates[0]?.name
    ?? "";
  const directionValues = useMemo(
    () => typeValuesFor(activeInspection, mapping.type_column),
    [activeInspection, mapping.type_column]
  );
  const statusValues = useMemo(
    () => statusValuesFor(activeInspection, mapping.status_column ?? ""),
    [activeInspection, mapping.status_column]
  );
  const setColumn = (field: keyof CsvColumnMapping, value: string) => {
    previewRequestSequence.current += 1;
    setPreview(null);
    setPage(2);
    setMapping((current) => {
      const next = { ...current, [field]: value };
      if (field === "type_column") {
        next.type_values = Object.fromEntries(
          typeValuesFor(activeInspection, value).map((raw) => [
            raw,
            TYPES.includes(raw as typeof TYPES[number]) ? raw : ""
          ])
        );
      }
      if (field === "status_column") {
        next.included_statuses = statusValuesFor(activeInspection, value).includes("")
          ? [""]
          : [];
      }
      return next;
    });
  };
  const selectStructure = async (
    selection: CsvStructureSelection
  ): Promise<void> => {
    if (!onHeaderRowChange) {
      setHeaderError(t(
        "当前导入会话不支持重新读取文件结构，请重新选择文件。",
        "This import session cannot reread the file structure. Select the file again."
      ));
      return;
    }
    const row = selection.header_row;
    if (row !== undefined && (!Number.isInteger(row) || row < 1 || row > rawRowCount)) {
      setHeaderError(t(
        `表头行号必须在 1 到 ${rawRowCount} 之间。`,
        `The header row must be between 1 and ${rawRowCount}.`
      ));
      return;
    }
    previewRequestSequence.current += 1;
    setHeaderBusy(true);
    setHeaderError("");
    setError("");
    setPreview(null);
    try {
      const nextInspection = await onHeaderRowChange(selection);
      setActiveInspection(nextInspection);
      setMapping(initialMapping(nextInspection));
      setHeaderRowInput(String(nextInspection.header_row ?? row ?? 1));
      setHeaderSelectorOpen(
        nextInspection.header_status === "needs_confirmation"
        && !nextInspection.header_confirmed
      );
    } catch (reason) {
      setHeaderError(displayError(reason));
    } finally {
      setHeaderBusy(false);
    }
  };
  const valid = requiredFields().every(([field]) =>
    scalarText(mapping[field]).trim()
  )
    && directionValues.every((value) => Boolean(mapping.type_values[value]))
    && (!mapping.status_column || mapping.included_statuses.length > 0);
  const blockingIssueCount = preview?.issues.filter(issueIsBlocking).length ?? 0;
  const warningIssueCount = (preview?.issues.length ?? 0) - blockingIssueCount;
  const filteredSummary = preview
    ? Object.entries(preview.import_stats.filtered)
      .filter(([, count]) => Number(count ?? 0) > 0)
    : [];
  const canApply = Boolean(
    preview
    && preview.import_stats.accepted_rows > 0
    && blockingIssueCount === 0
  );
  const canLeaveFilePage = activeInspection.headers.length > 0
    && !headerNeedsConfirmation
    && !interactionBusy;

  const openMappingPage = (): void => {
    if (!canLeaveFilePage) return;
    setError("");
    setPage(2);
  };

  const clearSavedMapping = async (): Promise<void> => {
    previewRequestSequence.current += 1;
    setPreview(null);
    setError("");
    setMappingBusy(true);
    try {
      await onClearSavedMapping?.(activeInspection.header_signature);
      setMapping(initialMapping(activeInspection));
    } catch (reason) {
      setError(displayError(reason));
    } finally {
      setMappingBusy(false);
    }
  };

  const createPreview = async () => {
    const sequence = ++previewRequestSequence.current;
    const requestedMapping = structuredClone(mapping);
    setBusy(true);
    setError("");
    try {
      const nextPreview = await onPreview(
        requestedMapping,
        {
          header_row: activeInspection.header_row ?? 1,
          ...(activeInspection.worksheet_name
            ? { worksheet_name: activeInspection.worksheet_name }
            : {})
        }
      );
      if (sequence === previewRequestSequence.current) {
        setPreview(nextPreview);
        setPage(3);
      }
    } catch (reason) {
      if (sequence === previewRequestSequence.current) setError(displayError(reason));
    } finally {
      if (sequence === previewRequestSequence.current) setBusy(false);
    }
  };
  const changeMode = (nextMode: ImportMode) => {
    previewRequestSequence.current += 1;
    setPreview(null);
    setPage(2);
    setMode(nextMode);
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await onApply(preview, mode, mapping);
    } catch (reason) {
      setError(displayError(reason));
      setBusy(false);
    }
  };
  const returnToPreviousPage = (): void => {
    if (interactionBusy) return;
    setError("");
    setPage((current) => current === 3 ? 2 : 1);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !interactionBusy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
    );
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = hostWindow.document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="asset-track-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !interactionBusy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="asset-track-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <h2 id={titleId}>{t("导入账单", "Import statement")}</h2>
            <span className="asset-track-modal-subtitle">
              {activeInspection.filename} · {activeInspection.row_count} {t("行待检查", "rows to review")}
            </span>
          </div>
          <button type="button" onClick={onCancel} disabled={interactionBusy}>
            {t("关闭", "Close")}
          </button>
        </header>

        <nav
          className="asset-track-import-steps"
          aria-label={t("导入步骤", "Import steps")}
        >
          <ol>
            <li className={page > 1 ? "is-complete" : "is-active"} aria-current={page === 1 ? "step" : undefined}>
              <span aria-hidden="true">1</span>{t("文件已读取", "File read")}
            </li>
            <li className={page > 2 ? "is-complete" : page === 2 ? "is-active" : ""} aria-current={page === 2 ? "step" : undefined}>
              <span aria-hidden="true">2</span>{t("确认映射", "Confirm mapping")}
            </li>
            <li className={busy && page === 3 ? "is-complete" : page === 3 ? "is-active" : ""} aria-current={page === 3 && !busy ? "step" : undefined}>
              <span aria-hidden="true">3</span>{t("检查预览", "Review preview")}
            </li>
            <li className={busy && page === 3 ? "is-active" : ""} aria-current={busy && page === 3 ? "step" : undefined}>
              <span aria-hidden="true">4</span>{t("加入草稿", "Add to draft")}
            </li>
          </ol>
        </nav>

        <p id={descriptionId} className="asset-track-import-intro">
          {t(
            "先确认文件和字段，再查看哪些流水会进入当前月草稿。这里不会直接写入数据库，完成后仍需在流水页保存。",
            "Confirm the file and fields first, then review which rows will enter this month's draft. Nothing is written to the database here; save the draft from the transactions page afterward."
          )}
        </p>

        {page === 1 && (
          <div className="asset-track-import-page" aria-labelledby={`${titleId}-page-file`}>
            <div className="asset-track-import-page-heading">
              <strong id={`${titleId}-page-file`}>{t("第 1 步：确认文件结构", "Step 1: Confirm the file structure")}</strong>
              <span>{t("选择正确的工作表和表头行，说明段落不会被当作流水。", "Choose the right worksheet and header row so preamble text is not imported as transactions.")}</span>
            </div>
            <section
              className="asset-track-import-file-summary"
              aria-labelledby={`${titleId}-file`}
            >
          <div className="asset-track-import-section-heading">
            <div>
              <h3 id={`${titleId}-file`}>{t("账单文件", "Statement file")}</h3>
              <p>
                {t(
                  "下面的列来自已读取的表格内容；如果找不到需要的列，请先整理表头后重新选择文件。",
                  "The columns below come from the table that was read. If a needed column is missing, clean up the header row and select the file again."
                )}
              </p>
            </div>
          </div>
          <dl className="asset-track-import-file-facts">
            <div>
              <dt>{t("格式", "Format")}</dt>
              <dd>{formatFileType(activeInspection.filename)}</dd>
            </div>
            <div>
              <dt>{t("编码", "Encoding")}</dt>
              <dd>{formatEncoding(activeInspection.encoding)}</dd>
            </div>
            <div>
              <dt>{t("分隔符", "Delimiter")}</dt>
              <dd>{formatDelimiter(activeInspection.delimiter)}</dd>
            </div>
            <div>
              <dt>{t("数据行", "Data rows")}</dt>
              <dd>{activeInspection.row_count}</dd>
            </div>
            <div>
              <dt>{t("已识别列", "Detected columns")}</dt>
              <dd>{activeInspection.headers.length}</dd>
            </div>
            <div>
              <dt>{t("目标月份", "Target month")}</dt>
              <dd>{activeInspection.month}</dd>
            </div>
            {activeInspection.worksheet_name && (
              <div>
                <dt>{t("当前工作表", "Current worksheet")}</dt>
                <dd>{activeInspection.worksheet_name}</dd>
              </div>
            )}
          </dl>
        </section>

        {worksheetCandidates.length > 1 && (
          <fieldset
            className="asset-track-import-worksheet-selector"
            aria-labelledby={`${titleId}-worksheet-selector`}
          >
            <legend id={`${titleId}-worksheet-selector`}>
              {t("选择工作表", "Choose a worksheet")}
            </legend>
            <p>
              {t(
                "这个工作簿包含多张表。请选择真正包含账单明细的工作表；系统会为每张表显示行数和表头识别结果。",
                "This workbook contains multiple worksheets. Choose the one with the statement details; each option shows its row count and header detection result."
              )}
            </p>
            <div
              className="asset-track-import-worksheet-list"
              role="radiogroup"
              aria-labelledby={`${titleId}-worksheet-selector`}
            >
              {worksheetCandidates.map((worksheet) => {
                const candidate = worksheet.header_candidates[0];
                const worksheetMeta = worksheet.row_count === 0
                  ? t("空工作表", "Empty worksheet")
                  : candidate
                    ? t(
                      `${worksheet.row_count} 行 · 建议第 ${candidate.row} 行作为表头 · 识别 ${candidate.matched_fields.length} 个字段`,
                      `${worksheet.row_count} rows · row ${candidate.row} suggested as header · ${candidate.matched_fields.length} fields detected`
                    )
                    : t(
                      `${worksheet.row_count} 行 · 未识别到可信表头`,
                      `${worksheet.row_count} rows · no reliable header detected`
                    );
                return (
                  <label
                    key={worksheet.name}
                    className={worksheet.name === selectedWorksheetName ? "is-selected" : ""}
                  >
                    <input
                      type="radio"
                      name={`${titleId}-worksheet`}
                      checked={worksheet.name === selectedWorksheetName}
                      disabled={interactionBusy || !onHeaderRowChange}
                      onChange={() => void selectStructure({ worksheet_name: worksheet.name })}
                    />
                    <span>
                      <strong>{worksheet.name}</strong>
                      <small>{worksheetMeta}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <section
          className={`asset-track-import-header-status ${headerNeedsConfirmation ? "is-warning" : "is-ok"}`}
          role="status"
          aria-live="polite"
          aria-labelledby={`${titleId}-header-status`}
        >
          <div>
            <strong id={`${titleId}-header-status`}>
              {headerNeedsConfirmation
                ? t("需要确认表头位置", "Confirm the header row")
                : activeInspection.header_confirmed
                  ? t("表头已确认", "Header confirmed")
                  : t("表头读取正常", "Header read successfully")}
            </strong>
            <span>
              {t(
                `当前使用第 ${headerRow} 行作为表头`,
                `Currently using row ${headerRow} as the header`
              )}
              {headerCandidates.find((candidate) => candidate.row === headerRow)?.matched_fields.length
                ? t(
                  `，识别到 ${headerCandidates.find((candidate) => candidate.row === headerRow)?.matched_fields.length ?? 0} 个账单字段`,
                  `, with ${headerCandidates.find((candidate) => candidate.row === headerRow)?.matched_fields.length ?? 0} statement fields detected`
                )
                : ""}
            </span>
          </div>
          {onHeaderRowChange && (
            <button
              type="button"
              disabled={interactionBusy}
              onClick={() => setHeaderSelectorOpen((current) => !current)}
            >
              {headerSelectorOpen
                ? t("收起表头选择", "Hide header selection")
                : t("调整表头行", "Adjust header row")}
            </button>
          )}
        </section>

        {(headerNeedsConfirmation || headerSelectorOpen) && (
          <section
            className="asset-track-import-header-selector"
            aria-labelledby={`${titleId}-header-selector`}
          >
            <div className="asset-track-import-section-heading">
              <div>
                <h3 id={`${titleId}-header-selector`}>
                  {t("确认哪一行是表头", "Confirm the header row")}
                </h3>
                <p>
                  {headerCandidates.length > 0
                    ? t(
                      "系统找到了可能的表头，请对照原始内容确认。账单标题、统计信息和备注行不会作为流水导入。",
                      "The system found possible headers. Check the original content before confirming. Titles, summaries, and notes will not be imported as transactions."
                    )
                    : t(
                      "系统没有找到可信的表头，请选择包含日期、金额、商品或收支等列名的行。",
                      "The system could not find a reliable header. Choose a row containing labels such as date, amount, item, or type."
                    )}
                </p>
                {headerCandidates.length > 0 && (
                  <p className="asset-track-import-header-recommendation">
                    {t("系统建议：", "Suggested by the system: ")}
                    {headerCandidates.slice(0, 3).map((candidate) => (
                      <span key={candidate.row}>
                        {t(`第 ${candidate.row} 行`, `row ${candidate.row}`)} · {candidate.matched_fields.map(businessLabel).join(t("、", ", "))}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
            <div className="asset-track-import-header-controls">
              <label>
                <span>{t("表头行号", "Header row")}</span>
                <input
                  type="number"
                  min="1"
                  max={rawRowCount || undefined}
                  value={headerRowInput}
                  disabled={interactionBusy}
                  onChange={(event) => setHeaderRowInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void selectStructure({
                        header_row: Number(headerRowInput),
                        ...(activeInspection.worksheet_name
                          ? { worksheet_name: activeInspection.worksheet_name }
                          : {})
                      });
                    }
                  }}
                />
              </label>
              <button
                type="button"
                disabled={interactionBusy}
                onClick={() => void selectStructure({
                  header_row: Number(headerRowInput),
                  ...(activeInspection.worksheet_name
                    ? { worksheet_name: activeInspection.worksheet_name }
                    : {})
                })}
              >
                {headerBusy
                  ? t("正在读取…", "Reading…")
                  : t("使用这一行", "Use this row")}
              </button>
            </div>
            {headerError && (
              <p className="asset-track-status is-error" role="alert">
                {headerError}
              </p>
            )}
            {rawRows.length > 0 ? (
              <div className="asset-track-import-raw-preview">
                <table aria-label={t("账单原始行预览", "Raw statement row preview")}>
                  <thead>
                    <tr>
                      <StaticTableHeader label={t("原始行", "Source row")} />
                      <StaticTableHeader label={t("内容", "Content")} />
                      <StaticTableHeader label={t("识别结果", "Detection")} />
                      <StaticTableHeader label={t("操作", "Action")} />
                    </tr>
                  </thead>
                  <tbody>
                    {rawRows.map((row) => {
                      const candidate = headerCandidates.find((item) => item.row === row.row);
                      const content = row.values.filter((value) => value.trim()).join(" | ");
                      return (
                        <tr
                          key={row.row}
                          className={row.row === headerRow ? "is-selected" : ""}
                        >
                          <td>{row.row}</td>
                          <td className="asset-track-import-raw-content">
                            {content || t("（空行）", "(empty row)")}
                          </td>
                          <td>
                            {candidate
                              ? t(
                                `候选：${candidate.matched_fields.join("、")}`,
                                `Candidate: ${candidate.matched_fields.map(businessLabel).join(", ")}`
                              )
                              : row.row === headerRow
                                ? t("当前表头", "Current header")
                                : t("前置说明或数据", "Preamble or data")}
                          </td>
                          <td>
                            <button
                              type="button"
                              disabled={interactionBusy}
                              onClick={() => void selectStructure({
                                header_row: row.row,
                                ...(activeInspection.worksheet_name
                                  ? { worksheet_name: activeInspection.worksheet_name }
                                  : {})
                              })}
                            >
                              {row.row === headerRow
                                ? t("确认此行", "Confirm this row")
                                : t("使用此行", "Use this row")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rawRowCount > rawRows.length && (
                  <small>
                    {t(
                      `当前显示前 ${rawRows.length} 行及候选行；如需选择其他位置，可直接输入 1–${rawRowCount}。`,
                      `Showing the first ${rawRows.length} rows and candidate rows. Enter any row from 1 to ${rawRowCount} to choose another position.`
                    )}
                  </small>
                )}
              </div>
            ) : (
              <p className="asset-track-import-note">
                {t("暂无可展示的原始行，请直接输入表头行号。", "No raw rows are available to display. Enter the header row number directly.")}
              </p>
            )}
          </section>
        )}

          </div>
        )}

        {page === 2 && (
          <div className="asset-track-import-page" aria-labelledby={`${titleId}-page-mapping`}>
            <div className="asset-track-import-page-heading">
              <strong id={`${titleId}-page-mapping`}>{t("第 2 步：确认字段和筛选", "Step 2: Confirm fields and filters")}</strong>
              <span>{t("确认导入范围、必填字段、收支映射和需要保留的状态。", "Confirm the import scope, required fields, type mappings, and statuses to keep.")}</span>
            </div>

            {savedMapping && (
              <section className="asset-track-import-profile-notice" role="status">
                <div>
                  <strong>{t("已应用上次映射", "Last mapping applied")}</strong>
                  <span>{t("它按当前文件的表头结构复用；仍建议检查下方字段和数量。", "The mapping was reused for this file structure. Check the fields and counts below before previewing.")}</span>
                </div>
                <button
                  type="button"
                  disabled={interactionBusy}
                  onClick={() => void clearSavedMapping()}
                >
                  {mappingBusy
                    ? t("正在清除…", "Clearing…")
                    : t("清除并使用系统建议", "Clear and use suggestions")}
                </button>
              </section>
            )}

        <fieldset className="asset-track-import-fieldset">
          <legend>
            <span className="asset-track-import-legend-title" role="heading" aria-level={3}>
              {t("导入方式", "Import mode")}
            </span>
            <small>{t("先选择本次操作的范围", "Choose the scope of this import")}</small>
          </legend>
          <div className="asset-track-import-mode">
            <label className={mode === "append" ? "is-selected" : ""}>
              <input
                type="radio"
                name="asset-track-import-mode"
                checked={mode === "append"}
                disabled={interactionBusy}
                onChange={() => changeMode("append")}
              />
              <span>
                <strong>{t("追加到当前草稿", "Append to current draft")}</strong>
                <small>
                  {t(
                    "保留当前草稿，并加入本文件的全部有效流水；不会自动去重。",
                    "Keep the current draft and add every valid row from this file; duplicates are not removed automatically."
                  )}
                </small>
              </span>
            </label>
            <label className={mode === "replace" ? "is-selected" : ""}>
              <input
                type="radio"
                name="asset-track-import-mode"
                checked={mode === "replace"}
                disabled={interactionBusy}
                onChange={() => changeMode("replace")}
              />
              <span>
                <strong>{t("替换当前草稿", "Replace current draft")}</strong>
                <small>
                  {t(
                    "清除当前流水草稿，再用本文件的有效流水重新建立草稿。",
                    "Clear the current transaction draft and rebuild it with the valid rows from this file."
                  )}
                </small>
              </span>
            </label>
          </div>
          {mode === "append" && (
            <p className="asset-track-import-note is-warning">
              {t(
                "如果重复选择同一账单，接受的流水会再次追加；请先确认账单范围。",
                "Selecting the same statement again will append its accepted rows again. Check the statement range first."
              )}
            </p>
          )}
        </fieldset>

        <fieldset className="asset-track-import-fieldset">
          <legend>
            <span className="asset-track-import-legend-title" role="heading" aria-level={3}>
              {t("必填字段", "Required fields")}
            </span>
            <small>{t("这 4 项都确认后才能生成预览", "All four must be confirmed before previewing")}</small>
          </legend>
          <div className="asset-track-mapping-grid">
            {requiredFields().map(([field, label]) => {
              const selected = scalarText(mapping[field]);
              const meta = selected === "__month_start__"
                ? t("每条流水使用当前月 1 日", "Every row uses the first day of the target month")
                : selected
                  ? formatColumnMeta(activeInspection, selected)
                  : t("尚未选择列", "No column selected");
              return (
                <label key={field} className="asset-track-import-field">
                  <span className="asset-track-import-field-label">
                    <strong>{label}</strong>
                    <small>{fieldHelp(field)}</small>
                  </span>
                  <span className="asset-track-import-field-control">
                    <select
                      value={selected}
                      disabled={interactionBusy}
                      aria-required="true"
                      title={meta}
                      onChange={(event) => setColumn(field, event.target.value)}
                    >
                      <option value="">{t("请选择字段", "Select a field")}</option>
                      {field === "date_column" && (
                        <option value="__month_start__">
                          {t(
                            "当前月 1 日（文件没有日期时使用）",
                            "First day of target month (when the file has no date)"
                          )}
                        </option>
                      )}
                      {activeInspection.headers.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="asset-track-import-fieldset is-optional">
          <legend>
            <span className="asset-track-import-legend-title" role="heading" aria-level={3}>
              {t("可选字段", "Optional fields")}
            </span>
            <small>{t("没有对应列时可以保持不使用", "Leave unused when the file has no matching column")}</small>
          </legend>
          <div className="asset-track-mapping-grid">
            {optionalFields().map(([field, label]) => {
              const selected = scalarText(mapping[field]);
              const meta = selected
                ? formatColumnMeta(activeInspection, selected)
                : t("不使用此字段", "This field will not be imported");
              return (
                <label key={field} className="asset-track-import-field">
                  <span className="asset-track-import-field-label">
                    <strong>{label}</strong>
                    <small>{fieldHelp(field)}</small>
                  </span>
                  <span className="asset-track-import-field-control">
                    <select
                      value={selected}
                      disabled={interactionBusy}
                      title={meta}
                      onChange={(event) => setColumn(field, event.target.value)}
                    >
                      <option value="">{t("不使用此字段", "Do not use this field")}</option>
                      {activeInspection.headers.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="asset-track-import-note">
            {t(
              "分类是可选字段；如需导入分类，请先在系统配置中设置。文件中无法匹配的分类会重置为“未分类”。",
              "Category is optional. To import categories, define them in the system first. Unmatched file categories are reset to ‘Uncategorized’."
            )}
          </p>
        </fieldset>

        {directionValues.length > 0 && (
          <fieldset className="asset-track-import-fieldset asset-track-import-values">
            <legend>
              <span
                className="asset-track-import-legend-title"
                role="heading"
                aria-level={3}
              >
                {t("收支映射", "Type mapping")}
              </span>
              <small>
                {t(
                  "每个原始收支值都必须明确映射；选择“忽略”表示这些行不会进入预览。",
                  "Map every raw type explicitly. Choosing Ignore keeps those rows out of the preview."
                )}
              </small>
              <span className="asset-track-import-count">
                {directionValues.length} {t("种原始值", "raw values")}
              </span>
            </legend>
            <div className="asset-track-import-control-list">
              {directionValues.map((raw) => {
                const count = valueCountFor(activeInspection, mapping.type_column, raw);
                return (
                  <label key={raw} className="asset-track-import-value-row">
                    <span className="asset-track-import-value-label">
                      <strong>{raw || t("（空收支值）", "(empty type value)")}</strong>
                      <small>
                        {count === null
                          ? t("数量未知", "Count unavailable")
                          : `${count} ${t("行", "rows")}`}
                      </small>
                    </span>
                    <select
                      value={mapping.type_values[raw] ?? ""}
                      disabled={interactionBusy}
                      aria-label={t(`将${raw || "空收支值"}映射为`, `Map ${raw || "empty type value"} to`)}
                      onChange={(event) => {
                        previewRequestSequence.current += 1;
                        setPreview(null);
                        setPage(2);
                        setMapping((current) => ({
                          ...current,
                          type_values: {
                            ...current.type_values,
                            [raw]: event.target.value
                          }
                        }));
                      }}
                    >
                      <option value="">{t("请选择结果", "Select a result")}</option>
                      {TYPES.map((value) => (
                        <option key={value} value={value}>{businessLabel(value)}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {mapping.status_column && statusValues.length > 0 && (
          <fieldset className="asset-track-import-fieldset asset-track-import-statuses">
            <legend>
              <span
                className="asset-track-import-legend-title"
                role="heading"
                aria-level={3}
              >
                {t("导入状态", "Statuses to import")}
              </span>
              <small>
                {t(
                  "只会导入勾选的状态；未勾选的行会在预览中标记为状态过滤。",
                  "Only checked statuses are imported. Unchecked rows appear in the preview as status-filtered."
                )}
              </small>
              <span className="asset-track-import-count">
                {mapping.included_statuses.length} / {statusValues.length} {t("已选择", "selected")}
              </span>
            </legend>
            <div className="asset-track-import-control-list">
              {statusValues.map((status) => {
                const count = valueCountFor(activeInspection, mapping.status_column ?? "", status);
                return (
                  <label key={status} className="asset-track-import-status-row">
                    <input
                      type="checkbox"
                      disabled={interactionBusy}
                      checked={mapping.included_statuses.includes(status)}
                      aria-label={status || t("（空状态）", "(empty status)")}
                      onChange={(event) => {
                        previewRequestSequence.current += 1;
                        setPreview(null);
                        setPage(2);
                        setMapping((current) => ({
                          ...current,
                          included_statuses: event.target.checked
                            ? [...current.included_statuses, status]
                            : current.included_statuses.filter(
                                (value) => value !== status
                              )
                        }));
                      }}
                    />
                    <span>
                      <strong>{status || t("（空状态）", "(empty status)")}</strong>
                      <small>
                        {count === null
                          ? t("数量未知", "Count unavailable")
                          : `${count} ${t("行", "rows")}`}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

          </div>
        )}

        {page === 3 && preview && (
          <section
            className="asset-track-import-preview"
            aria-labelledby={`${titleId}-preview`}
            aria-live="polite"
          >
            <div className="asset-track-import-page-heading">
              <strong>{t("第 3 步：检查预览", "Step 3: Review the preview")}</strong>
              <span>{t("确认接受、过滤和异常数量后，完成导入到当前草稿。", "Review accepted, filtered, and invalid rows before completing the import into the current draft.")}</span>
            </div>
            <div className="asset-track-import-preview-heading">
              <div>
                <h3 id={`${titleId}-preview`}>{t("导入预览", "Import preview")}</h3>
                <p>
                  {t(
                    "只有“接受”数量会进入当前草稿；其他行会保留在下面的原因列表中。",
                    "Only accepted rows enter the current draft. Other rows remain listed below with their reasons."
                  )}
                </p>
              </div>
              <strong className="asset-track-import-preview-total">
                {preview.import_stats.accepted_rows} {t("条将加入草稿", "rows will enter the draft")}
              </strong>
            </div>
            <div className="asset-track-import-preview-cards">
              <div className="asset-track-import-preview-card is-positive">
                <span>{t("接受", "Accepted")}</span>
                <strong>{preview.import_stats.accepted_rows}</strong>
                <small>{t("将进入草稿", "will enter the draft")}</small>
              </div>
              <div className="asset-track-import-preview-card">
                <span>{t("被过滤", "Filtered")}</span>
                <strong>{totalFilteredRows(preview)}</strong>
                <small>{t("不会进入草稿", "will stay out of the draft")}</small>
              </div>
              <div className="asset-track-import-preview-card is-warning">
                <span>{t("异常行", "Invalid rows")}</span>
                <strong>{invalidFilteredRows(preview)}</strong>
                <small>{t("需要回到字段或原文件检查", "check the mapping or source file")}</small>
              </div>
              <div className="asset-track-import-preview-card">
                <span>{t("日期补为月初", "Dates defaulted")}</span>
                <strong>{preview.import_stats.defaulted.date ?? 0}</strong>
                <small>{t("需要导入后检查", "check after importing")}</small>
              </div>
              <div className="asset-track-import-preview-card">
                <span>{t("错误 / 警告", "Errors / warnings")}</span>
                <strong>{blockingIssueCount} / {warningIssueCount}</strong>
                <small>{t("错误需要先处理", "errors need attention first")}</small>
              </div>
            </div>
            <dl className="asset-track-import-preview-details">
              <div>
                <dt>{t("接受流水日期范围", "Accepted date range")}</dt>
                <dd>{acceptedDateRange(preview)}</dd>
              </div>
              <div>
                <dt>{t("接受流水类型", "Accepted types")}</dt>
                <dd>
                  {Object.entries(preview.type_summary).length > 0
                    ? Object.entries(preview.type_summary)
                      .map(([type, count]) => `${businessLabel(type)} ${count}`)
                      .join(t("、", ", "))
                    : t("暂无接受流水", "No accepted rows")}
                </dd>
              </div>
            </dl>
            {preview.issues.length > 0 && (
              <div className="asset-track-import-issue-summary" role="alert">
                <strong>
                  {t(
                    `导入后检查发现 ${blockingIssueCount} 项错误、${warningIssueCount} 项警告`,
                    `Post-import checks found ${blockingIssueCount} errors and ${warningIssueCount} warnings`
                  )}
                </strong>
                <ul>
                  {preview.issues.slice(0, 8).map((issue, index) => (
                    <li key={`${scalarText(issue.code ?? issue.field) || "issue"}-${index}`}>
                      <span className={issueIsBlocking(issue) ? "is-error" : "is-warning"}>
                        {issueIsBlocking(issue)
                          ? t("错误", "Error")
                          : t("警告", "Warning")}
                      </span>
                      {previewIssueText(issue)}
                    </li>
                  ))}
                </ul>
                {preview.issues.length > 8 && (
                  <small>
                    {t(
                      `其余 ${preview.issues.length - 8} 项检查结果会在加入草稿后按行显示。`,
                      `${preview.issues.length - 8} more checks will be shown by row after adding to the draft.`
                    )}
                  </small>
                )}
              </div>
            )}
            {Object.entries(preview.import_stats.defaulted_examples)
              .filter(([, examples]) => examples.length > 0)
              .map(([kind, examples]) => (
                <p key={`defaulted-${kind}`} className="asset-track-import-note is-warning">
                  {t("日期使用月初的示例：", "Examples using the month start date: ")}
                  {examples.map(describeExample).join(t("；", "; "))}
                </p>
              ))}
            {filteredSummary.length > 0 && (
              <div className="asset-track-import-filter-summary">
                <strong>{t("过滤原因汇总", "Filter reasons")}</strong>
                <ul>
                  {filteredSummary.map(([reason, count]) => (
                    <li key={reason}>
                      <span>{filterLabel(reason)}</span>
                      <strong>{count} {t("行", "rows")}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.import_stats.accepted_rows === 0 && (
              <div className="asset-track-import-empty-result" role="status">
                <strong>{t("没有流水可以加入草稿", "No rows can be added to the draft")}</strong>
                <p>
                  {t(
                    "当前草稿未改变。请检查字段映射、收支结果和状态选择，再重新生成预览。",
                    "The current draft is unchanged. Check the field mapping, type results, and status selection, then generate the preview again."
                  )}
                </p>
              </div>
            )}
            {preview.import_stats.filtered_rows.length > 0 && (
              <details className="asset-track-import-filtered-rows">
                <summary>
                  {t(
                    `查看全部被过滤条目（${preview.import_stats.filtered_rows.length} 行）`,
                    `View all filtered rows (${preview.import_stats.filtered_rows.length})`
                  )}
                </summary>
                <div className="asset-track-table-scroll">
                  <table aria-label={t("被过滤条目", "Filtered rows")}>
                    <thead>
                      <tr>
                        <StaticTableHeader label={t("原始行", "Source row")} />
                        <StaticTableHeader label={t("原因", "Reason")} />
                        {activeInspection.headers.map((header) => (
                          <StaticTableHeader key={header} label={header} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.import_stats.filtered_rows.map((item) => (
                        <tr key={`${item.row}-${item.reason}`}>
                          <td>{item.row}</td>
                          <td>{filterLabel(item.reason)}</td>
                          {activeInspection.headers.map((header) => (
                            <td key={header}>{item.values[header] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        )}
        {error && (
          <div className="asset-track-status is-error" role="alert">
            <strong>{t("预览或应用未完成", "Preview or apply did not finish")}</strong>
            <p>{error}</p>
            <small>
              {t(
                "下一步：按上面的提示修正字段、表头或状态选择，然后重新生成预览；未成功应用的内容不会写入数据库。",
                "Next: correct the fields, header, or status selection above and generate the preview again. Content that was not successfully applied is not written to the database."
              )}
            </small>
          </div>
        )}

        <footer className="asset-track-import-footer">
          <button type="button" onClick={onCancel} disabled={interactionBusy}>
            {t("取消", "Cancel")}
          </button>
          {page > 1 && (
            <button
              type="button"
              onClick={returnToPreviousPage}
              disabled={interactionBusy}
            >
              {page === 2
                ? t("上一步：文件读取", "Back: file structure")
                : t("上一步：确认映射", "Back: mapping")}
            </button>
          )}
          {page === 1 && (
            <button
              type="button"
              onClick={openMappingPage}
              disabled={!canLeaveFilePage}
            >
              {t("下一步：确认映射", "Next: confirm mapping")}
            </button>
          )}
          {page === 2 && (
            <button
              type="button"
              onClick={() => void createPreview()}
              disabled={!valid || busy}
            >
              {busy
                ? t("正在解析…", "Parsing…")
                : t("生成预览", "Generate preview")}
            </button>
          )}
          {page === 3 && (
            <button
              type="button"
              className="mod-cta"
              onClick={() => void apply()}
              disabled={!canApply || busy}
            >
              {busy
                ? t("正在加入草稿…", "Adding to draft…")
                : preview
                  ? t(
                    `完成并加入 ${preview.import_stats.accepted_rows} 条`,
                    `Complete and add ${preview.import_stats.accepted_rows} rows`
                  )
                  : t("完成并加入草稿", "Complete and add to draft")}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
