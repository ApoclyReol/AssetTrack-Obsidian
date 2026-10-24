import { ManagedModal } from "./ManagedModal";
import { type App } from "obsidian";
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RuleAmountFields } from "../types/rules";
import { readRuleAmountFields, ruleAmountBounds } from "../domain/ruleAmounts";
import { RuleAmountConditionInput } from "./RuleAmountConditionInput";
import { formatRuleAmount } from "./ruleAmountFormat";
import { t } from "../i18n";

function AmountEditorContent({ value, onConfirm, onClose }: {
  value: RuleAmountFields; onConfirm: (value: RuleAmountFields) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  return <div className="asset-track-rule-create-content">
    <RuleAmountConditionInput value={draft} onChange={setDraft} label={t("金额条件", "Amount condition")} />
    <div className="asset-track-section-actions">
      <button type="button" onClick={onClose}>{t("取消", "Cancel")}</button>
      <button type="button" className="mod-cta" disabled={!ruleAmountBounds(draft)} onClick={() => { onConfirm(draft); onClose(); }}>{t("应用到规则草稿", "Apply to rule draft")}</button>
    </div>
  </div>;
}
class RuleAmountModal extends ManagedModal {
  private root: Root | null = null;
  constructor(app: App, private readonly value: RuleAmountFields, private readonly confirm: (value: RuleAmountFields) => void) { super(app); }
  onOpen(): void {
    this.installInteraction();
    this.setTitle(t("编辑金额条件", "Edit amount condition"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-rule-create-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(AmountEditorContent, { value: this.value, onConfirm: this.confirm, onClose: () => this.completeClose() }));
  }
  onClose(): void { super.onClose(); this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
export function RuleAmountEditor({ app, value, onChange, label }: {
  app?: App; value: RuleAmountFields; onChange: (value: RuleAmountFields) => void; label: string;
}) {
  if (!app) return <RuleAmountConditionInput value={value} onChange={onChange} label={label} />;
  return <button type="button" aria-label={label} title={t("编辑金额条件", "Edit amount condition")}
    onClick={() => new RuleAmountModal(app, readRuleAmountFields({ ...value }), onChange).open()}>{formatRuleAmount(value)}</button>;
}
