import { Modal, type App } from "obsidian";
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RuleRewriteFields } from "../types/rules";
import { t } from "../i18n";

export function RuleRewriteInputs({ value, onChange, disabled = false }: {
  value: RuleRewriteFields; onChange: (value: RuleRewriteFields) => void; disabled?: boolean;
}) {
  return <div className="asset-track-rewrite-fields">
    <label>{t("重写交易对手", "Rewrite counterparty")}<input disabled={disabled} value={value.rewrite_merchant ?? ""}
      onChange={(event) => onChange({ ...value, rewrite_merchant: event.target.value })} /></label>
    <label>{t("重写商品", "Rewrite item")}<input disabled={disabled} value={value.rewrite_product ?? ""}
      onChange={(event) => onChange({ ...value, rewrite_product: event.target.value })} /></label>
    <label>{t("重写内容留空时", "When a rewrite is blank")}<select disabled={disabled} value={value.rewrite_empty_mode ?? "preserve"}
      onChange={(event) => onChange({ ...value, rewrite_empty_mode: event.target.value as "preserve" | "clear" })}>
      <option value="preserve">{t("保留原值", "Keep original value")}</option>
      <option value="clear">{t("清空原值", "Clear original value")}</option>
    </select></label>
    <p className="asset-track-modal-subtitle">{t("留空行为同时作用于交易对手和商品。已填写的重写值始终优先；仅在应用规则或合并确认后生效。", "The blank-value setting applies to both fields. Entered rewrites always take precedence; changes take effect only when applying rules or confirming a merge.")}</p>
  </div>;
}
export function RuleRewriteContent({ value, onConfirm, onClose }: {
  value: RuleRewriteFields; onConfirm: (value: RuleRewriteFields) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<RuleRewriteFields>({ rewrite_merchant: value.rewrite_merchant ?? "",
    rewrite_product: value.rewrite_product ?? "", rewrite_empty_mode: value.rewrite_empty_mode ?? "preserve" });
  return <div className="asset-track-rule-create-content">
    <fieldset className="asset-track-editor-modal-section"><legend>{t("重写设置", "Rewrite settings")}</legend>
      <RuleRewriteInputs value={draft} onChange={setDraft} />
    </fieldset>
    <div className="asset-track-rule-create-actions">
      <button type="button" onClick={onClose}>{t("取消", "Cancel")}</button>
      <button type="button" className="mod-cta" onClick={() => { onConfirm(draft); onClose(); }}>{t("应用到规则草稿", "Apply to rule draft")}</button>
    </div>
  </div>;
}
class RuleRewriteModal extends Modal {
  private root: Root | null = null;
  constructor(app: App, private readonly value: RuleRewriteFields, private readonly confirm: (value: RuleRewriteFields) => void) { super(app); }
  onOpen(): void {
    this.setTitle(t("编辑重写信息", "Edit rewrites"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-rule-create-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(RuleRewriteContent, { value: this.value, onConfirm: this.confirm, onClose: () => this.close() }));
  }
  onClose(): void { this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
export function RuleRewriteEditor({ app, value, label, onChange }: {
  app?: App; value: RuleRewriteFields; label: string; onChange: (value: RuleRewriteFields) => void;
}) {
  const [editing, setEditing] = useState(false);
  return <>
    <button type="button" className="asset-track-rewrite-trigger" aria-label={label}
      onClick={() => app ? new RuleRewriteModal(app, { ...value }, onChange).open() : setEditing(true)}>
      <span>{t("重写设置", "Rewrite settings")}</span><small>{value.rewrite_empty_mode === "clear" ? t("留空清空", "Clear blanks") : t("留空保留", "Keep blanks")}</small>
    </button>
    {editing && <RuleRewriteContent value={value} onConfirm={onChange} onClose={() => setEditing(false)} />}
  </>;
}
