import { type App } from "obsidian";
import { createElement, useId, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../i18n";
import { messageFor } from "./editorPrimitives";
import { ManagedModal } from "./ManagedModal";

export interface TransactionInfoTarget {
  counterparty?: string;
  product?: string;
}

interface TransactionInfoEditModalOptions {
  app: App;
  count: number;
  onConfirm: (value: TransactionInfoTarget) => Promise<void>;
}

function TransactionInfoContent({ count, onConfirm, onClose }:
  Omit<TransactionInfoEditModalOptions, "app"> & { onClose: () => void }) {
  const [values, setValues] = useState({ counterparty: "", product: "" });
  const [clear, setClear] = useState({ counterparty: false, product: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const formId = useId();
  const hasChanges = clear.counterparty || clear.product || values.counterparty.trim() || values.product.trim();
  const confirm = async () => {
    if (!hasChanges || busy) return;
    setBusy(true);
    setMessage("");
    const target: TransactionInfoTarget = {};
    for (const field of ["counterparty", "product"] as const) {
      if (clear[field] || values[field].trim()) target[field] = clear[field] ? "" : values[field].trim();
    }
    try {
      await onConfirm(target);
      onClose();
    } catch (error) {
      setMessage(messageFor(error));
      setBusy(false);
    }
  };
  return <div className="asset-track-selection-edit-content" data-asset-track-busy={busy}>
    <p className="asset-track-modal-subtitle">{t(`修改已选的 ${count} 条流水，确认后进入当前草稿。`, `Edit ${count} selected transactions. Confirm to update the current draft.`)}</p>
    <div className="asset-track-selection-edit-fields">
      {(["counterparty", "product"] as const).map((field) => <div className="asset-track-selection-edit-field" key={field}>
        <div className="asset-track-selection-edit-label">
          <label htmlFor={`${formId}-${field}`}>{field === "counterparty" ? t("交易对手", "Counterparty") : t("商品", "Item")}</label>
          <label className="asset-track-selection-clear"><input type="checkbox" disabled={busy} checked={clear[field]}
            onChange={(event) => setClear({ ...clear, [field]: event.target.checked })} />{t("清空", "Clear")}</label>
        </div>
        <input id={`${formId}-${field}`} disabled={busy || clear[field]} value={values[field]}
          placeholder={t("填写后统一修改，留空保留原值", "Enter a shared value; leave blank to keep existing values")}
          onChange={(event) => setValues({ ...values, [field]: event.target.value })} />
      </div>)}
    </div>
    <p className="asset-track-modal-subtitle">{t("两项可以独立修改。需要移除内容时，勾选对应的“清空”。", "Edit either field independently. Select Clear to remove its content.")}</p>
    {message && <p role="alert">{message}</p>}
    <div className="asset-track-rule-create-actions">
      <button type="button" disabled={busy} onClick={onClose}>{t("取消", "Cancel")}</button>
      <button type="button" className="mod-cta" disabled={busy || !hasChanges} onClick={() => void confirm()}>
        {busy ? t("正在修改…", "Applying changes…") : t("应用到草稿", "Apply to draft")}
      </button>
    </div>
  </div>;
}

export class TransactionInfoEditModal extends ManagedModal {
  private root: Root | null = null;
  constructor(private readonly options: TransactionInfoEditModalOptions) { super(options.app); }
  onOpen(): void {
    this.installInteraction();
    this.setTitle(t("编辑信息", "Edit information"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-selection-edit-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(TransactionInfoContent, { ...this.options, onClose: () => this.completeClose() }));
  }
  onClose(): void {
    super.onClose();
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
