import { useMemo, useState } from "react";
import type {
  CsvColumnMapping,
  CsvImportPreview,
  CsvInspection,
  ImportMode
} from "../types";

const TYPES = ["支出", "收入", "代付", "加仓", "提现", "忽略"] as const;
const REQUIRED_FIELDS: Array<[keyof CsvColumnMapping, string]> = [
  ["date_column", "日期/时间"],
  ["product_column", "商品或说明"],
  ["amount_column", "金额"],
  ["type_column", "收支方向"]
];
const OPTIONAL_FIELDS: Array<[keyof CsvColumnMapping, string]> = [
  ["category_column", "分类（可选）"],
  ["status_column", "交易状态（可选）"]
];
const FILTER_LABELS: Record<string, string> = {
  outside_month: "跨月",
  status_filtered: "状态过滤",
  ignored_type: "忽略类型",
  invalid: "无效字段"
};

function describeExample(example: Record<string, unknown>): string {
  return Object.entries(example)
    .map(([key, value]) => `${key === "row" ? "第" : key} ${String(value)}${key === "row" ? " 行" : ""}`)
    .join("，");
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
  if (base.status_column && !base.included_statuses.length) {
    base.included_statuses = [
      ...(inspection.distinct_values[base.status_column] ?? [])
    ];
  }
  return base;
}

export function CsvImportDialog({
  inspection,
  savedMapping,
  onCancel,
  onPreview,
  onApply
}: {
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
  const [mapping, setMapping] = useState<CsvColumnMapping>(() =>
    initialMapping(inspection, savedMapping)
  );
  const [mode, setMode] = useState<ImportMode>("append");
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        next.included_statuses = [
          ...(inspection.distinct_values[value] ?? [])
        ];
      }
      return next;
    });
  };
  const valid = REQUIRED_FIELDS.every(([field]) =>
    String(mapping[field] ?? "").trim()
  ) && directionValues.every((value) => Boolean(mapping.type_values[value]));

  const createPreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await onPreview(mapping));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <div className="asset-track-modal-backdrop" role="presentation">
      <section className="asset-track-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>导入 CSV</h2>
            <span>{inspection.filename} · {inspection.row_count} 行</span>
          </div>
          <button onClick={onCancel} disabled={busy}>关闭</button>
        </header>

        <div className="asset-track-import-mode">
          <label>
            <input
              type="radio"
              checked={mode === "append"}
              onChange={() => setMode("append")}
            />
            增量导入（追加全部）
          </label>
          <label>
            <input
              type="radio"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            覆盖当前月份
          </label>
        </div>
        {mode === "append" && (
          <p className="asset-track-import-warning">
            本模式不去重。重复导入同一账单会再次追加全部有效记录，请自行确认账单范围。
          </p>
        )}

        <div className="asset-track-mapping-grid">
          {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(([field, label]) => (
            <label key={field}>
              {label}
              <select
                value={String(mapping[field] ?? "")}
                onChange={(event) => setColumn(field, event.target.value)}
              >
                <option value="">请选择</option>
                {field === "date_column" && (
                  <option value="__month_start__">
                    当前月 1 日（简化 CSV 无日期时使用）
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
            <strong>收支值映射</strong>
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
                  <option value="">请选择</option>
                  {TYPES.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            ))}
          </section>
        )}

        {mapping.status_column && statusValues.length > 0 && (
          <section className="asset-track-import-statuses">
            <strong>允许导入的交易状态</strong>
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
          <summary>查看原始数据样例</summary>
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
            <strong>导入预览</strong>
            <span>接受 {preview.import_stats.accepted_rows} / {preview.import_stats.source_rows} 行</span>
            <span>跨月 {preview.import_stats.filtered.outside_month ?? 0} 行</span>
            <span>状态过滤 {preview.import_stats.filtered.status_filtered ?? 0} 行</span>
            <span>忽略类型 {preview.import_stats.filtered.ignored_type ?? 0} 行</span>
            <span>无效 {preview.import_stats.filtered.invalid ?? 0} 行</span>
            <span>待修正 {preview.issues.length} 项</span>
            {Object.entries(preview.import_stats.examples)
              .filter(([, examples]) => examples.length > 0)
              .map(([kind, examples]) => (
                <small key={kind}>
                  {FILTER_LABELS[kind] ?? kind}示例：
                  {examples.map(describeExample).join("；")}
                </small>
              ))}
          </div>
        )}
        {error && <p className="asset-track-status is-error">{error}</p>}

        <footer>
          <button onClick={onCancel} disabled={busy}>取消</button>
          <button
            onClick={() => void createPreview()}
            disabled={!valid || busy}
          >
            {busy && !preview ? "正在解析…" : "生成预览"}
          </button>
          <button
            className="mod-cta"
            onClick={() => void apply()}
            disabled={!preview || busy}
          >
            应用到草稿
          </button>
        </footer>
      </section>
    </div>
  );
}
