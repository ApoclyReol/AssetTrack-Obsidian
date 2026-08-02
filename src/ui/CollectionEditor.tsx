import { useCallback, useEffect, useRef, useState } from "react";
import { scalarText } from "../domain/text";
import { t } from "../i18n";
import type {
  DebtEditorDraftSnapshot,
  EditorDraftSnapshot
} from "./editorDraft";
import {
  clone,
  messageFor,
  number,
  OperationState,
  SortButton,
  sortRows,
  type SortState,
  Status
} from "./editorPrimitives";
import { ActionTableHeader } from "./TablePrimitives";

type ColumnType = "text" | "number" | "date" | "checkbox" | "readonly";

export function CollectionEditor({
  title,
  load,
  save,
  createRow,
  columns,
  onDirty,
  initialDraft,
  onDraftChange,
  onSaved
}: {
  title: string;
  load: () => Promise<{ revision: number; rows: Array<Record<string, unknown>> }>;
  save: (revision: number, rows: Array<Record<string, unknown>>) => Promise<unknown>;
  createRow: () => Record<string, unknown>;
  columns: Array<[string, string, ColumnType]>;
  onDirty: (dirty: boolean) => void;
  initialDraft?: DebtEditorDraftSnapshot;
  onDraftChange: (snapshot: EditorDraftSnapshot | null) => void;
  onSaved: () => void;
}) {
  const [revision, setRevision] = useState(initialDraft?.revision ?? 0);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>(
    initialDraft ? clone(initialDraft.rows) : []
  );
  const [sort, setSort] = useState<SortState>(null);
  const [state, setState] = useState<OperationState>({ kind: "idle" });
  const loadRef = useRef(load);
  const saveRef = useRef(save);
  const restoredDraft = useRef(
    initialDraft ? clone(initialDraft) : null
  );
  loadRef.current = load;
  saveRef.current = save;
  const reload = useCallback(async () => {
    setState({ kind: "pending", message: t("加载…", "Loading…") });
    try {
      const result = await loadRef.current();
      setRevision(result.revision);
      setRows(result.rows);
      onDirty(false);
      onDraftChange(null);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [onDirty, onDraftChange]);
  useEffect(() => {
    const restored = restoredDraft.current;
    if (!restored) {
      void reload();
      return;
    }
    restoredDraft.current = null;
    onDirty(true);
    onDraftChange(restored);
    setState({
      kind: "success",
      message: t("未保存借款草稿已恢复。", "The unsaved debt draft was restored.")
    });
    void loadRef.current()
      .then((current) => {
        if (current.revision !== restored.revision) {
          setState({
            kind: "error",
            message: t(
              "草稿已恢复，但其他窗口已修改借款；重新加载前不能覆盖保存。",
              "The draft was restored, but another window changed debts. Reload before saving."
            )
          });
        }
      })
      .catch((error: unknown) => {
        setState({ kind: "error", message: messageFor(error) });
      });
  }, [onDirty, onDraftChange, reload]);
  const markRows = (nextRows: Array<Record<string, unknown>>) => {
    setRows(nextRows);
    onDirty(true);
    onDraftChange({
      kind: "debts",
      revision,
      rows: clone(nextRows)
    });
  };
  const update = (index: number, key: string, value: unknown) => {
    markRows(rows.map((row, item) =>
      item === index ? { ...row, [key]: value } : row
    ));
  };
  const commit = async () => {
    setState({ kind: "pending", message: t("保存…", "Saving…") });
    try {
      await saveRef.current(revision, rows);
      await reload();
      onSaved();
      setState({ kind: "success", message: t("已保存。", "Saved.") });
    } catch (error) {
      setState({ kind: "error", message: messageFor(error) });
    }
  };
  const sorted = sortRows(rows, sort, (row, key) => row[key]);
  return (
    <main className="asset-track-editor">
      <section className="asset-track-month-header">
        <div>
          <h2>{title}</h2>
          <span>revision {revision}</span>
        </div>
        <div className="asset-track-actions">
          <button
            onClick={() => {
              markRows([...rows, createRow()]);
            }}
          >
            {t("新增", "Add")}
          </button>
          <button onClick={() => void reload()}>{t("放弃并重载", "Discard and reload")}</button>
          <button className="mod-cta" onClick={() => void commit()}>
            {t("整体保存", "Save all")}
          </button>
        </div>
      </section>
      <Status state={state} />
      <div className="asset-track-table-scroll">
        <table className="asset-track-collection-table">
          <thead>
            <tr>
              {columns.map(([field, label, type]) => (
                <th key={field} scope="col" className={type === "checkbox" ? "asset-track-checkbox-heading" : undefined}>
                  <SortButton field={field} label={label} sort={sort} onSort={setSort} />
                </th>
              ))}
              <ActionTableHeader />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, originalIndex }) => (
              <tr key={scalarText(row.id ?? originalIndex)}>
                {columns.map(([key, , type]) => (
                  <td key={key} className={type === "checkbox" ? "asset-track-checkbox-cell" : undefined}>
                    {type === "readonly" ? (
                      scalarText(row[key])
                    ) : type === "checkbox" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(row[key])}
                        onChange={(event) => update(originalIndex, key, event.target.checked)}
                      />
                    ) : (
                      <input
                        type={type}
                        value={scalarText(row[key])}
                        onChange={(event) =>
                          update(
                            originalIndex,
                            key,
                            type === "number" ? number(event.target.value) : event.target.value
                          )
                        }
                      />
                    )}
                  </td>
                ))}
                <td className="asset-track-actions-cell">
                  <button
                    onClick={() => {
                      markRows(rows.filter((_, item) => item !== originalIndex));
                    }}
                  >
                    {t("删除", "Delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
