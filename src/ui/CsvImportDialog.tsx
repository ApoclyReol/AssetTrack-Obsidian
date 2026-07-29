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
} from "../types";
import { scalarText } from "../domain/text";
import { businessLabel, displayError, t } from "../i18n";

const TYPES = ["支出", "收入", "代付", "加仓", "提现", "忽略"] as const;
const REQUIRED_FIELDS: Array<[keyof CsvColumnMapping, string]> = [
  ["date_column", t("日期/时间", "Date/time")],
  ["product_column", t("商品或说明", "Item or description")],
  ["amount_column", t("金额", "Amount")],
  ["type_column", t("收支方向", "Income/expense type")]
];
const OPTIONAL_FIELDS: Array<[keyof CsvColumnMapping, string]> = [
  ["counterparty_column", t("交易对方（可选）", "Counterparty (optional)")],
  ["category_column", t("分类（可选）", "Category (optional)")],
  ["status_column", t("交易状态（可选）", "Transaction status (optional)")]
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
      : `${key} ${String(value)}`)
    .join(t("，", ", "));
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
    inspection.distinct_values[base.status_column ?? ""] ?? []
  );
  base.included_statuses = base.included_statuses.filter(
    (status) => actualStatuses.has(status)
  );
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
    () => inspection.distinct_values[mapping.status_column ?? ""] ?? [],
    [inspection, mapping.status_column]
  );
  const setColumn = (field: keyof CsvColumnMapping, value: string) => {
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
        next.included_statuses = [];
      }
      return next;
    });
  };
  const valid = REQUIRED_FIELDS.every(([field]) =>
    scalarText(mapping[field]).trim()
  )
    && directionValues.every((value) => Boolean(mapping.type_values[value]))
    && (!mapping.status_column || mapping.included_statuses.length > 0);

  const createPreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await onPreview(mapping));
    } catch (reason) {
      setError(displayError(reason));
    } finally {
      setBusy(false);
    }
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
            "推荐先根据真实账单整理列名和无关记录；系统仍会要求确认字段、收支方向和交易状态。",
            "We recommend cleaning up column names and irrelevant rows first. You will still confirm the fields, income/expense types, and transaction statuses."
          )}
        </p>

        <div className="asset-track-import-mode">
          <label>
            <input
              type="radio"
              checked={mode === "append"}
              onChange={() => setMode("append")}
            />
            {t("增量导入（追加全部）", "Incremental import (append all)")}
          </label>
          <label>
            <input
              type="radio"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            {t("覆盖当前月份", "Replace current month")}
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
              {label}
              <select
                value={scalarText(mapping[field])}
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
            <strong>{t("收支值映射", "Income/expense value mapping")}</strong>
            {directionValues.map((raw) => (
              <label key={raw}>
                <span>{raw}</span>
                <select
                  value={mapping.type_values[raw] ?? ""}
                  onChange={(event) => {
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
          </section>
        )}

        {mapping.status_column && statusValues.length > 0 && (
          <section className="asset-track-import-statuses">
            <strong>{t(
              "文件中的交易状态（请选择允许导入的值）",
              "Transaction statuses in the file (select the values to import)"
            )}</strong>
            <div>
              {statusValues.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    checked={mapping.included_statuses.includes(status)}
                    onChange={(event) => {
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
                  {status}
                </label>
              ))}
            </div>
          </section>
        )}

        <details>
          <summary>{t("查看原始数据样例", "View raw data samples")}</summary>
          <div className="asset-track-table-scroll">
            <table>
              <thead>
                <tr>{inspection.headers.map((header) => <th key={header}>{header}</th>)}</tr>
              </thead>
              <tbody>
                {inspection.sample_rows.map((row, index) => (
                  <tr key={index}>
                    {inspection.headers.map((header) => (
                      <td key={header}>{row[header]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {preview && (
          <div className="asset-track-import-preview">
            <strong>{t("导入预览", "Import preview")}</strong>
            <span>{t("接受", "Accepted")} {preview.import_stats.accepted_rows} / {preview.import_stats.source_rows} {t("行", "rows")}</span>
            <span>{t("跨月", "Outside month")} {preview.import_stats.filtered.outside_month ?? 0} {t("行", "rows")}</span>
            <span>{t("状态过滤", "Status filtered")} {preview.import_stats.filtered.status_filtered ?? 0} {t("行", "rows")}</span>
            <span>{t("忽略类型", "Ignored type")} {preview.import_stats.filtered.ignored_type ?? 0} {t("行", "rows")}</span>
            <span>{t("无效", "Invalid")} {preview.import_stats.filtered.invalid ?? 0} {t("行", "rows")}</span>
            <span>{t("待修正", "Issues to fix")} {preview.issues.length}</span>
            {Object.entries(preview.import_stats.examples)
              .filter(([, examples]) => examples.length > 0)
              .map(([kind, examples]) => (
                <small key={kind}>
                  {FILTER_LABELS[kind] ?? kind}{t("示例：", " examples: ")}
                  {examples.map(describeExample).join(t("；", "; "))}
                </small>
              ))}
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
