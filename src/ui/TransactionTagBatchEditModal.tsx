import { Modal, type App } from "obsidian";
import { createElement, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TagDefinition } from "../types/configuration";
import type { OperationKind } from "../types/operations";
import { t } from "../i18n";
import { messageFor } from "./editorPrimitives";

type TagOperation = Extract<OperationKind, "bulk-add-tag" | "bulk-remove-tag" | "bulk-replace-tags">;

export interface TransactionTagBatchEditModalOptions {
  app: App;
  operationType: TagOperation;
  tags: TagDefinition[];
  onConfirm: (value: { target_tag_key?: string; target_tag_keys?: string[] }) => void | Promise<void>;
}

function titleFor(operationType: TagOperation): string {
  if (operationType === "bulk-add-tag") return t("添加标签", "Add tag");
  if (operationType === "bulk-remove-tag") return t("移除标签", "Remove tag");
  if (operationType === "bulk-replace-tags") return t("替换标签", "Replace tags");
  return t("编辑标签", "Edit tags");
}

function TagBatchEditContent({
  operationType,
  tags,
  onConfirm,
  onClose
}: Omit<TransactionTagBatchEditModalOptions, "app"> & { onClose: () => void }) {
  const [tagKey, setTagKey] = useState("");
  const [tagKeys, setTagKeys] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isReplace = operationType === "bulk-replace-tags";
  const availableTags = useMemo(
    () => operationType === "bulk-remove-tag"
      ? tags
      : tags.filter((tag) => tag.is_active || tag.tag_key === tagKey || tagKeys.includes(tag.tag_key)),
    [operationType, tagKey, tagKeys, tags]
  );

  const confirm = async () => {
    if (!isReplace && !tagKey) {
      setMessage(t("请选择标签。", "Choose a tag."));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await onConfirm(isReplace ? { target_tag_keys: tagKeys } : { target_tag_key: tagKey });
      onClose();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  return <div className="asset-track-batch-edit-modal-content">
    <p>{isReplace
      ? t("选择要保留的全部标签；不选择表示清空标签。确认后先进入当前月份草稿，保存流水后才写入数据库。", "Select all tags to keep; leave empty to clear tags. Confirmation changes the current-month draft and saving transactions persists it.")
      : t("选择一个标签。确认后先进入当前月份草稿，保存流水后才写入数据库。", "Choose a tag. Confirmation changes the current-month draft and saving transactions persists it.")}</p>
    {message && <p className="asset-track-rule-history-message" role="alert">{message}</p>}
    <label>{isReplace ? t("目标标签", "Target tags") : t("标签", "Tag")}
      <select
        autoFocus
        multiple={isReplace}
        size={isReplace ? Math.min(8, Math.max(3, availableTags.length)) : undefined}
        disabled={busy}
        value={isReplace ? tagKeys : tagKey}
        onChange={(event) => {
          if (isReplace) {
            setTagKeys(Array.from(event.currentTarget.selectedOptions).map((option) => option.value));
          } else {
            setTagKey(event.target.value);
          }
        }}
      >
        {!isReplace && <option value="">{t("请选择标签", "Choose a tag")}</option>}
        {availableTags.map((tag) => {
          const name = typeof tag.name === "string" ? tag.name.trim() : "";
          return <option key={tag.tag_key} value={tag.tag_key}>
            {name || tag.tag_key || t("未命名标签", "Unnamed tag")}{!tag.is_active ? t("（停用）", " (inactive)") : ""}
          </option>;
        })}
      </select>
    </label>
    <div className="asset-track-rule-create-actions">
      <button type="button" className="mod-cta" disabled={busy || (!isReplace && !tagKey)} onClick={() => void confirm()}>
        {busy ? t("正在准备预览…", "Preparing preview…") : t("确认并预览", "Confirm and preview")}
      </button>
      <button type="button" disabled={busy} onClick={onClose}>{t("取消", "Cancel")}</button>
    </div>
  </div>;
}

export class TransactionTagBatchEditModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: TransactionTagBatchEditModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(titleFor(this.options.operationType));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-batch-edit-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(TagBatchEditContent, {
      operationType: this.options.operationType,
      tags: this.options.tags,
      onConfirm: this.options.onConfirm,
      onClose: () => this.close()
    }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
