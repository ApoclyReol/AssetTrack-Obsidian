import { scalarText } from "../domain/text";
import { useEffect, useRef, useState } from "react";
import type { OperationPreview } from "../types/operations";
import { t } from "../i18n";
import { messageFor } from "./editorPrimitives";

export function useBatchPreview<T>(value: T, load?: (value: T) => Promise<OperationPreview>) {
  const [preview, setPreview] = useState<OperationPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(value);
  useEffect(() => {
    if (!load) { setPreview(null); setPending(false); setError(""); return; }
    let active = true;
    setPreview(null); setPending(true); setError("");
    const hostWindow = host.current?.ownerDocument.defaultView;
    const timer = hostWindow?.setTimeout(() => {
      void load(value).then(result => { if (active) setPreview(result); })
        .catch(reason => { if (active) setError(messageFor(reason)); })
        .finally(() => { if (active) setPending(false); });
    }, 150);
    return () => { active = false; if (timer !== undefined) hostWindow?.clearTimeout(timer); };
  }, [key, load]);
  return { host, preview, pending, error };
}

export function BatchPreview({ preview, pending, error, tagNames = {} }: { preview: OperationPreview | null; pending: boolean; error: string; tagNames?: Record<string, string> }) {
  const [all, setAll] = useState(false);
  if (error) return <p role="alert">{error}</p>;
  if (pending) return <p role="status">{t("正在更新预览…", "Updating preview…")}</p>;
  if (!preview) return null;
  const labels: Record<string, string> = { counterparty: t("交易对手", "Counterparty"), product: t("商品", "Item"), category: t("分类", "Category"), tag_keys: t("标签", "Tags") };
  const text = (value: unknown) => Array.isArray(value) ? value.map(item => tagNames[scalarText(item)] ?? scalarText(item)).join(" · ") || "—" : scalarText(value).trim() || "—";
  return <section className="asset-track-batch-preview">
    <div className="asset-track-scope-summary" role="status"><span>{t(`${preview.change_count} 笔将修改`, `${preview.change_count} changes`)}</span>
      <span>{t(`${preview.skipped_count} 笔保留`, `${preview.skipped_count} kept`)}</span></div>
    <div className="asset-track-table-scroll"><table><thead><tr><th>{t("字段", "Field")}</th><th>{t("原值", "Before")}</th><th>{t("修改后", "After")}</th></tr></thead>
      <tbody>{(all ? preview.changes : preview.changes.slice(0, 4)).flatMap((change, index) => Object.keys(labels)
        .filter(key => JSON.stringify(change.before[key]) !== JSON.stringify(change.after[key]))
        .map(key => <tr key={`${index}-${key}`}><td>{labels[key]}</td><td>{text(change.before[key])}</td><td>{text(change.after[key])}</td></tr>))}</tbody></table></div>
    {preview.changes.length > 4 && <button type="button" onClick={() => setAll(!all)}>{all ? t("收起", "Collapse") : t("查看全部变化", "View all changes")}</button>}
  </section>;
}
