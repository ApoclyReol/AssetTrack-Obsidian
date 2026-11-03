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
export function TransactionMergeContent({ result: initialResult, onPreview, onConfirm, onClose }:
  Omit<Options, "app" | "onConfirm"> & { onConfirm: (result: MergePreviewResult) => Promise<void>; onClose: () => void }) {
  const result = initialResult;
  const [retainTagged, setRetainTagged] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const next = onPreview ? await onPreview(!retainTagged) : result;
      if (!mounted.current) return;
      if (!next.groups.length) {
        setError(t("当前范围没有可合并的记录。", "No transactions can be merged in this scope."));
        setBusy(false);
        return;
      }
      await onConfirm(next);
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) { setError(displayError(reason)); setBusy(false); }
    }
  };
  return <div className="asset-track-merge-content" data-asset-track-busy={busy}>
    <label className="asset-track-merge-tag-option">
      <input type="checkbox" checked={retainTagged} disabled={busy}
        onChange={(event) => setRetainTagged(event.target.checked)} />
      {t("保留带标签项", "Keep tagged transactions")}
    </label>
    {error && <p role="alert">{error}</p>}
    <div className="asset-track-rule-create-actions">
      <button type="button" disabled={busy} onClick={onClose}>{t("取消合并", "Cancel merge")}</button>
      <button type="button" className="mod-cta" disabled={busy} onClick={() => void confirm()}>
        {busy ? t("正在处理…", "Working…") : t("合并到流水草稿", "Merge into transaction draft")}
      </button>
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
