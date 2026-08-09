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
  ImportMode
} from "../types/csv";
import { scalarText } from "../domain/text";
import { businessLabel, displayError, t } from "../i18n";
import { issueIsBlocking } from "./editorPrimitives";
import { StaticTableHeader } from "./TablePrimitives";

const TYPES = ["支出", "收入", "代付", "加仓", "提现", "忽略"] as const;
const REQUIRED_FIELDS: Array<[keyof CsvColumnMapping, string]> = [
  ["date_column", t("日期", "Date")],
  ["product_column", t("商品", "Item")],
  ["amount_column", t("金额", "Amount")],
  ["type_column", t("收支", "Type")]
];
const OPTIONAL_FIELDS: Array<[keyof CsvColumnMapping, string]> = [
  ["counterparty_column", t("对方", "Counterparty")],
  ["category_column", t("分类", "Category")],
  ["status_column", t("状态", "Status")]
];
const FILTER_LABELS: Record<string, string> = {
  outside_month: t("跨月", "Outside month"),
  status_filtered: t("状态过滤", "Status filtered"),
  ignored_type: t("忽略类型", "Ignored type"),
  invalid: t("无效字段", "Invalid field")
};
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

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
        ? `${key} ${t("（空状态）", "(empty status)")}`
      : `${key} ${String(value)}`)
    .join(t("，", ", "));
}

function totalFilteredRows(preview: CsvImportPreview): number {
  return Object.values(preview.import_stats.filtered)
    .reduce((total, count) => total + Number(count ?? 0), 0);
}

function statusValuesFor(
  inspection: CsvInspection,
  column: string
): string[] {
  const values = [...inspection.distinct_values[column] ?? []];
  if (inspection.empty_values[column] && !values.includes("")) values.push("");
  return values;
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
  for (const raw of inspection.distinct_values[base.type_column] ?? []) {
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
  onPreview,
  onApply
}: {
  hostWindow: Window;
  inspection: CsvInspection;
  savedMapping?: CsvColumnMapping;
  onCancel: () => void;
  onPreview: (
    mapping: CsvColumnMapping
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
  const [mapping, setMapping] = useState<CsvColumnMapping>(() =>
    initialMapping(inspection, savedMapping)
  );
  const [mode, setMode] = useState<ImportMode>("append");
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previewRequestSequence = useRef(0);
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
  const directionValues = useMemo(
    () => inspection.distinct_values[mapping.type_column] ?? [],
    [inspection, mapping.type_column]
  );
  const statusValues = useMemo(
    () => statusValuesFor(inspection, mapping.status_column ?? ""),
    [inspection, mapping.status_column]
  );
  const setColumn = (field: keyof CsvColumnMapping, value: string) => {
    previewRequestSequence.current += 1;
    setPreview(null);
    setMapping((current) => {
      const next = { ...current, [field]: value };
      if (field === "type_column") {
        next.type_values = Object.fromEntries(
          (inspection.distinct_values[value] ?? []).map((raw) => [
            raw,
            TYPES.includes(raw as typeof TYPES[number]) ? raw : ""
          ])
        );
      }
      if (field === "status_column") {
        next.included_statuses = statusValuesFor(inspection, value).includes("")
          ? [""]
          : [];
      }
      return next;
    });
  };
  const valid = REQUIRED_FIELDS.every(([field]) =>
    scalarText(mapping[field]).trim()
  )
    && directionValues.every((value) => Boolean(mapping.type_values[value]))
    && (!mapping.status_column || mapping.included_statuses.length > 0);
  const blockingIssueCount = preview?.issues.filter(issueIsBlocking).length ?? 0;
  const warningIssueCount = (preview?.issues.length ?? 0) - blockingIssueCount;

  const createPreview = async () => {
    const sequence = ++previewRequestSequence.current;
    const requestedMapping = structuredClone(mapping);
    setBusy(true);
    setError("");
    try {
      const nextPreview = await onPreview(requestedMapping);
      if (sequence === previewRequestSequence.current) setPreview(nextPreview);
    } catch (reason) {
      if (sequence === previewRequestSequence.current) setError(displayError(reason));
    } finally {
      if (sequence === previewRequestSequence.current) setBusy(false);
    }
  };
  const changeMode = (nextMode: ImportMode) => {
    previewRequestSequence.current += 1;
    setPreview(null);
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
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !busy) {
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
        if (event.target === event.currentTarget && !busy) onCancel();
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
            <span>{inspection.filename} · {inspection.row_count} {t("行", "rows")}</span>
          </div>
          <button onClick={onCancel} disabled={busy}>{t("关闭", "Close")}</button>
        </header>

        <p id={descriptionId} className="asset-track-import-warning">
          {t(
            "推荐先整理列名和无关记录；导入前请确认字段、收支和状态。",
            "Clean up column names and irrelevant rows first, then confirm fields, types, and statuses before importing."
          )}
        </p>

        <div className="asset-track-import-mode">
          <label>
            <input
              type="radio"
              checked={mode === "append"}
              disabled={busy}
              onChange={() => changeMode("append")}
            />
            {t("增量导入（追加全部）", "Incremental import (append all)")}
          </label>
          <label>
            <input
              type="radio"
              checked={mode === "replace"}
              disabled={busy}
              onChange={() => changeMode("replace")}
            />
            {t("覆盖当前流水草稿", "Replace current transaction draft")}
          </label>
        </div>
        {mode === "append" && (
          <p className="asset-track-import-warning">
            {t(
              "本模式不去重。重复导入同一账单会再次追加全部有效记录，请自行确认账单范围。",
              "This mode does not deduplicate. Importing the same statement again appends every valid row again, so verify the statement range."
            )}
          </p>
        )}

        <div className="asset-track-mapping-grid">
          {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(([field, label]) => (
            <label key={field}>
              <span>{label}</span>
              <select
                value={scalarText(mapping[field])}
                disabled={busy}
                onChange={(event) => setColumn(field, event.target.value)}
              >
                <option value="">{t("请选择", "Select")}</option>
                {field === "date_column" && (
                  <option value="__month_start__">
                    {t(
                      "当前月 1 日（简化 CSV 无日期时使用）",
                      "First day of current month (for CSV files without dates)"
                    )}
                  </option>
                )}
                {inspection.headers.map((header) => (
                  <option key={header} value={header}>{header}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {directionValues.length > 0 && (
          <section className="asset-track-import-values">
            <strong>{t("收支映射", "Type mapping")}</strong>
            <div className="asset-track-import-control-list">
            {directionValues.map((raw) => (
              <label key={raw}>
                <span>{raw}</span>
                <select
                  value={mapping.type_values[raw] ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    previewRequestSequence.current += 1;
                    setPreview(null);
                    setMapping((current) => ({
                      ...current,
                      type_values: {
                        ...current.type_values,
                        [raw]: event.target.value
                      }
                    }));
                  }}
                >
                  <option value="">{t("请选择", "Select")}</option>
                  {TYPES.map((value) => (
                    <option key={value} value={value}>{businessLabel(value)}</option>
                  ))}
                </select>
              </label>
            ))}
            </div>
          </section>
        )}

        {mapping.status_column && statusValues.length > 0 && (
          <section className="asset-track-import-statuses">
            <strong>{t(
              "允许导入的状态",
              "Statuses to import"
            )}</strong>
            <div className="asset-track-import-control-list">
              {statusValues.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={mapping.included_statuses.includes(status)}
                    onChange={(event) => {
                      previewRequestSequence.current += 1;
                      setPreview(null);
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
                  {status || t("（空状态）", "(empty status)")}
                </label>
              ))}
            </div>
          </section>
        )}

        {preview && (
          <div className="asset-track-import-preview">
            <strong>{t("导入预览", "Import preview")}</strong>
            <span>{t("接受", "Accepted")} {preview.import_stats.accepted_rows} / {preview.import_stats.source_rows} {t("行", "rows")}</span>
            <span>{t("被过滤", "Filtered")} {totalFilteredRows(preview)} {t("行", "rows")}</span>
            <span>{t("日期补为月初", "Dates defaulted to month start")} {preview.import_stats.defaulted.date ?? 0} {t("行", "rows")}</span>
            <span>{t("错误", "Errors")} {blockingIssueCount}</span>
            <span>{t("警告", "Warnings")} {warningIssueCount}</span>
            {Object.entries(preview.import_stats.defaulted_examples)
              .filter(([, examples]) => examples.length > 0)
              .map(([kind, examples]) => (
                <small key={`defaulted-${kind}`}>
                  {t("已使用默认值示例：", "Defaulted value examples: ")}
                  {examples.map(describeExample).join(t("；", "; "))}
                </small>
              ))}
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
                        {inspection.headers.map((header) => (
                          <StaticTableHeader key={header} label={header} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.import_stats.filtered_rows.map((item) => (
                        <tr key={`${item.row}-${item.reason}`}>
                          <td>{item.row}</td>
                          <td>{FILTER_LABELS[item.reason] ?? item.reason}</td>
                          {inspection.headers.map((header) => (
                            <td key={header}>{item.values[header] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
        {error && (
          <p className="asset-track-status is-error" role="alert">
            {error}
          </p>
        )}

        <footer>
          <button onClick={onCancel} disabled={busy}>{t("取消", "Cancel")}</button>
          <button
            onClick={() => void createPreview()}
            disabled={!valid || busy}
          >
            {busy && !preview
              ? t("正在解析…", "Parsing…")
              : t("生成预览", "Generate preview")}
          </button>
          <button
            className="mod-cta"
            onClick={() => void apply()}
            disabled={!preview || busy}
          >
            {t("应用到草稿", "Apply to draft")}
          </button>
        </footer>
      </section>
    </div>
  );
}
