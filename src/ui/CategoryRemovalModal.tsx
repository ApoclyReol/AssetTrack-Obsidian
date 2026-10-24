import type { App } from "obsidian";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConfigurationEditorPort } from "../services/ports";
import type { CategoryDefinition } from "../types/configuration";
import type { CategoryRemovalPreview } from "../types/categoryRemoval";
import { t } from "../i18n";
import { messageFor } from "./editorPrimitives";
import { ManagedModal } from "./ManagedModal";

interface Options {
  app: App; api: ConfigurationEditorPort; category: CategoryDefinition;
  categories: CategoryDefinition[]; onSaved: () => void; onDataChanged: () => void;
}
export function CategoryRemovalContent({ api, category, categories, onSaved, onClose }: Omit<Options, "app" | "onDataChanged"> & { onClose: () => void }) {
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<CategoryRemovalPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    const request = ++sequence.current;
    setPreview(null); setMessage("");
    void api.previewCategoryRemoval?.(category.category_key, target || undefined).then(value => {
      if (request === sequence.current) setPreview(value);
    }).catch(error => { if (request === sequence.current) setMessage(messageFor(error)); });
    return () => { sequence.current++; };
  }, [api, category.category_key, target]);
  const referenced = Boolean(preview && (preview.transaction_count || preview.rule_count));
  const submit = async () => {
    if (!preview || !api.applyCategoryRemoval || (referenced && !target)) return;
    setBusy(true); setMessage("");
    try { await api.applyCategoryRemoval(preview); onSaved(); onClose(); }
    catch (error) { setMessage(messageFor(error)); setBusy(false); }
  };
  return <div className="asset-track-category-removal-content" data-asset-track-busy={busy}>
    <div className="asset-track-scope-summary"><span>{category.name}</span>
      <span>{t(`${preview?.transaction_count ?? "…"} 笔流水`, `${preview?.transaction_count ?? "…"} transactions`)}</span>
      <span>{t(`${preview?.rule_count ?? "…"} 条规则`, `${preview?.rule_count ?? "…"} rules`)}</span></div>
    {referenced && <label>{t("流水与规则一并转移到", "Transfer transactions and rules to")}
      <select value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
        <option value="">{t("请选择目标分类", "Choose target category")}</option>
        {categories.filter(row => row.category_key !== category.category_key && row.is_active && row.transaction_type === category.transaction_type)
          .map(row => <option key={row.category_key} value={row.category_key}>{row.name}</option>)}
      </select></label>}
    <p className="asset-track-danger-note">{t("删除原分类，保留流水和规则。确认前创建保护备份。", "The category is removed; transactions and rules are kept. A protection backup is created first.")}</p>
    {message && <p role="alert">{message}</p>}
    <div className="asset-track-rule-create-actions"><button disabled={busy} onClick={onClose}>{t("取消删除", "Cancel deletion")}</button>
      <button className="mod-warning" disabled={busy || !preview || (referenced && !target)} onClick={() => void submit()}>
        {busy ? t("正在处理…", "Working…") : referenced ? t("转移并删除", "Transfer and delete") : t("删除分类", "Delete category")}
      </button></div>
  </div>;
}
export class CategoryRemovalModal extends ManagedModal {
  private root: Root | null = null;
  constructor(private readonly options: Options) { super(options.app); }
  onOpen(): void {
    this.installInteraction();
    this.modalEl.addClass("asset-track-native-modal", "asset-track-compact-modal");
    this.setTitle(t("删除分类", "Delete category"));
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(CategoryRemovalContent, { ...this.options,
      onSaved: () => { this.options.onSaved(); this.options.onDataChanged(); }, onClose: () => this.completeClose() }));
  }
  onClose(): void { super.onClose(); this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
