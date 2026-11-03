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
type TagTarget = { target_tag_keys: string[]; operation_type?: TagOperation };
export interface TransactionTagBatchEditModalOptions {
  app: App; operationType: TagOperation; tags: TagDefinition[];
  allowModeSwitch?: boolean;
  count?: number;
  presentTagKeys?: string[];
  onPreview?: (value: TagTarget) => Promise<OperationPreview>;
  onConfirm: (value: TagTarget) => void | Promise<void>;
}
function TagBatchEditContent({ operationType, tags, allowModeSwitch = false, count, presentTagKeys, onConfirm, onPreview, onClose }:
  Omit<TransactionTagBatchEditModalOptions, "app"> & { onClose: () => void }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState(operationType);
  const adding = operation === "bulk-add-tag";
  const target: TagTarget = { target_tag_keys: keys, ...(allowModeSwitch ? { operation_type: operation } : {}) };
  const previewState = useBatchPreview(target, onPreview);
  const choices = tags.filter(tag => adding ? tag.is_active : !presentTagKeys || presentTagKeys.includes(tag.tag_key));
  const confirm = async () => {
    if (!keys.length) return;
    setBusy(true); setMessage("");
    try { await onConfirm(target); onClose(); }
    catch (error) { setMessage(messageFor(error)); setBusy(false); }
  };
  return <div ref={previewState.host} className="asset-track-batch-edit-modal-content" data-asset-track-busy={busy}>
    {count !== undefined && <p className="asset-track-modal-subtitle">{t(`修改已选的 ${count} 条流水，确认后进入当前草稿。`, `Edit ${count} selected transactions. Confirm to update the current draft.`)}</p>}
    {allowModeSwitch && <div className="asset-track-selection-edit-modes">
      {(["bulk-add-tag", "bulk-remove-tag"] as const).map(mode => <button type="button" key={mode} disabled={busy}
        aria-pressed={operation === mode} className={operation === mode ? "is-active" : ""}
        onClick={() => { setOperation(mode); setKeys([]); setMessage(""); }}>
        {mode === "bulk-add-tag" ? t("添加标签", "Add tags") : t("移除标签", "Remove tags")}
      </button>)}
    </div>}
    <div className="asset-track-tag-choice-grid">{choices.map(tag =>
      <label key={tag.tag_key}><input type="checkbox" disabled={busy} checked={keys.includes(tag.tag_key)} onChange={event =>
        setKeys(event.target.checked ? [...keys, tag.tag_key] : keys.filter(key => key !== tag.tag_key))} />{tag.name || tag.tag_key}</label>)}</div>
    {!choices.length && <p className="asset-track-modal-subtitle">{adding ? t("暂无可添加的标签，请先在分类设计中定义。", "Define tags in Category design before adding them.") : t("选中的流水没有可移除的标签。", "The selected transactions have no tags to remove.")}</p>}
    {allowModeSwitch && <p className="asset-track-modal-subtitle">{t("可同时选择多个标签，其他标签保留。", "Select multiple tags; other tags are preserved.")}</p>}
    {onPreview && <BatchPreview {...previewState} tagNames={Object.fromEntries(tags.map(tag => [tag.tag_key, tag.name]))} />}
    {message && <p role="alert">{message}</p>}
    <div className="asset-track-rule-create-actions"><button type="button" disabled={busy} onClick={onClose}>{allowModeSwitch ? t("取消", "Cancel") : adding ? t("取消添加", "Cancel addition") : t("取消移除", "Cancel removal")}</button>
      <button type="button" className="mod-cta" disabled={busy || !keys.length || Boolean(onPreview && (previewState.pending || !previewState.preview))} onClick={() => void confirm()}>
        {busy ? t("正在处理…", "Working…") : adding ? t("添加到草稿", "Add to draft") : t("从草稿移除", "Remove from draft")}
      </button></div>
  </div>;
}
export class TransactionTagBatchEditModal extends ManagedModal {
  private root: Root | null = null;
  constructor(private readonly options: TransactionTagBatchEditModalOptions) { super(options.app); }
  onOpen(): void {
    this.installInteraction();
    this.setTitle(this.options.allowModeSwitch ? t("编辑标签", "Edit tags") : this.options.operationType === "bulk-add-tag" ? t("添加标签", "Add tags") : t("移除标签", "Remove tags"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-batch-edit-modal");
    if (this.options.allowModeSwitch) this.modalEl.addClass("asset-track-selection-edit-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(TagBatchEditContent, { ...this.options, onClose: () => this.completeClose() }));
  }
  onClose(): void { super.onClose(); this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
