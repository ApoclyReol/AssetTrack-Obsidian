import type { App } from "obsidian";
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TagDefinition } from "../types/configuration";
import type { OperationKind, OperationPreview } from "../types/operations";
import { t } from "../i18n";
import { messageFor } from "./editorPrimitives";
import { ManagedModal } from "./ManagedModal";
import { BatchPreview, useBatchPreview } from "./BatchPreview";

type TagOperation = Extract<OperationKind, "bulk-add-tag" | "bulk-remove-tag">;
type TagTarget = { target_tag_keys: string[] };
export interface TransactionTagBatchEditModalOptions {
  app: App; operationType: TagOperation; tags: TagDefinition[];
  onPreview?: (value: TagTarget) => Promise<OperationPreview>;
  onConfirm: (value: TagTarget) => void | Promise<void>;
}
function TagBatchEditContent({ operationType, tags, onConfirm, onPreview, onClose }:
  Omit<TransactionTagBatchEditModalOptions, "app"> & { onClose: () => void }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const adding = operationType === "bulk-add-tag";
  const previewState = useBatchPreview({ target_tag_keys: keys }, onPreview);
  const confirm = async () => {
    if (!keys.length) return;
    setBusy(true); setMessage("");
    try { await onConfirm({ target_tag_keys: keys }); onClose(); }
    catch (error) { setMessage(messageFor(error)); setBusy(false); }
  };
  return <div ref={previewState.host} className="asset-track-batch-edit-modal-content" data-asset-track-busy={busy}>
    <div className="asset-track-tag-choice-grid">{tags.filter(tag => !adding || tag.is_active).map(tag =>
      <label key={tag.tag_key}><input type="checkbox" disabled={busy} checked={keys.includes(tag.tag_key)} onChange={event =>
        setKeys(event.target.checked ? [...keys, tag.tag_key] : keys.filter(key => key !== tag.tag_key))} />{tag.name || tag.tag_key}</label>)}</div>
    {onPreview && <BatchPreview {...previewState} tagNames={Object.fromEntries(tags.map(tag => [tag.tag_key, tag.name]))} />}
    {message && <p role="alert">{message}</p>}
    <div className="asset-track-rule-create-actions"><button disabled={busy} onClick={onClose}>{adding ? t("取消添加", "Cancel addition") : t("取消移除", "Cancel removal")}</button>
      <button className="mod-cta" disabled={busy || !keys.length || Boolean(onPreview && (previewState.pending || !previewState.preview))} onClick={() => void confirm()}>
        {busy ? t("正在处理…", "Working…") : adding ? t("添加到流水草稿", "Add to transaction draft") : t("移除并更新草稿", "Remove from transaction draft")}
      </button></div>
  </div>;
}
export class TransactionTagBatchEditModal extends ManagedModal {
  private root: Root | null = null;
  constructor(private readonly options: TransactionTagBatchEditModalOptions) { super(options.app); }
  onOpen(): void {
    this.installInteraction();
    this.setTitle(this.options.operationType === "bulk-add-tag" ? t("添加标签", "Add tags") : t("移除标签", "Remove tags"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-batch-edit-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(TagBatchEditContent, { ...this.options, onClose: () => this.completeClose() }));
  }
  onClose(): void { super.onClose(); this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
