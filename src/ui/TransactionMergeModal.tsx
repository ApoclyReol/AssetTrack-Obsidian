import { ManagedModal } from "./ManagedModal";
import { type App } from "obsidian";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MergePreviewResult } from "../domain/transactionMerge";
import { displayError, t } from "../i18n";

interface Options {
  tagNames?: Record<string, string>;
  app: App;
  result: MergePreviewResult;
  onPreview?: (includeTagged: boolean) => Promise<MergePreviewResult>;
  onConfirm: (isOpen: () => boolean, result: MergePreviewResult) => Promise<void>;
}
export function TransactionMergeContent({ result: initialResult, tagNames = {}, onPreview, onConfirm, onClose }:
  Omit<Options, "app" | "onConfirm"> & { onConfirm: (result: MergePreviewResult) => Promise<void>; onClose: () => void }) {
  const [result, setResult] = useState(initialResult);
  const [includeTagged, setIncludeTagged] = useState(initialResult.preview.metadata?.include_tagged === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  useEffect(() => () => { requestSequence.current++; }, []);
  const count = result.groups.reduce((sum, group) => sum + group.before.length, 0);
  const tagLabel = (keys?: string[]) => keys?.map((key) => tagNames[key] ?? key).join(" · ") || t("无标签", "No tags");
  const nameLabel = (group: MergePreviewResult["groups"][number], field: "counterparty" | "product") =>
    group.cleared_fields.includes(field) ? t("—（原名称不同，合并后留空）", "— (different original names; left blank)") : group.after[field] || "—";
  const changeTags = async (next: boolean) => {
    if (!onPreview) return;
    const sequence = ++requestSequence.current;
    setIncludeTagged(next); setBusy(true); setError("");
    try {
      const updated = await onPreview(next);
      if (sequence === requestSequence.current) setResult(updated);
    } catch (reason) {
      if (sequence === requestSequence.current) {
        setIncludeTagged(result.preview.metadata?.include_tagged === true);
        setError(displayError(reason));
      }
    } finally { if (sequence === requestSequence.current) setBusy(false); }
  };
  return <div className="asset-track-merge-content" data-asset-track-busy={busy}>
    <div className="asset-track-merge-summary" role="status">
      <div><strong>{count}</strong><span>{t("参与合并", "Source transactions")}</span></div>
      <div><strong>{result.groups.length}</strong><span>{t("合并结果", "Merged transactions")}</span></div>
      <div><strong>{result.unchanged_count}</strong><span>{t("保留明细", "Kept unchanged")}</span></div>
    </div>
    <label className="asset-track-merge-tag-option"><input type="checkbox" checked={includeTagged} disabled={busy || !onPreview}
      onChange={(event) => void changeTags(event.target.checked)} />{t("包含有标签的流水", "Include tagged transactions")}</label>
    <div className="asset-track-table-scroll asset-track-merge-results"><table>
      <thead><tr>{[t("商品", "Item"), t("交易对手", "Counterparty"), t("分类", "Category"), t("标签", "Tags"), t("合计", "Total")].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.groups.map(group => <tr key={group.after.client_id}>
        <td>{nameLabel(group, "product")}</td><td>{nameLabel(group, "counterparty")}</td>
        <td>{group.after.category || "—"}</td><td>{tagLabel(group.after.tag_keys)}</td><td>{group.after.amount.toFixed(2)}</td>
      </tr>)}</tbody>
    </table></div>
    {!result.groups.length && <p role="status">{t("当前范围没有可合并的记录。", "No transactions can be merged in this scope.")}</p>}
    <div className="asset-track-merge-footer">
      <small>{t("按分类和完整标签组合分别合并。保存后替换原记录，不支持拆分。", "Merged separately by category and complete tag set. Saving replaces the originals; splitting is not supported.")}</small>
      {error && <p role="alert">{error}</p>}
      <div className="asset-track-rule-create-actions">
        <button type="button" disabled={busy} onClick={onClose}>{t("取消合并", "Cancel merge")}</button>
        <button type="button" className="mod-cta" disabled={busy || !result.groups.length} onClick={() => {
          setBusy(true); setError("");
          void onConfirm(result).then(onClose).catch((reason: unknown) => { setError(displayError(reason)); setBusy(false); });
        }}>{busy ? t("正在处理…", "Working…") : t("合并到流水草稿", "Merge into transaction draft")}</button>
      </div>
    </div>
  </div>;
}

export class TransactionMergeModal extends ManagedModal {
  private root: Root | null = null;
  private closed = false;
  constructor(private readonly options: Options) { super(options.app); }
  onOpen(): void {
    this.installInteraction();
    this.closed = false;
    this.setTitle(t("合并此组", "Merge this group"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-merge-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(TransactionMergeContent, { ...this.options,
      onConfirm: (result) => this.options.onConfirm(() => !this.closed, result), onClose: () => this.completeClose() }));
  }
  onClose(): void { super.onClose(); this.closed = true; this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
