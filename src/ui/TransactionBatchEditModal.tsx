import { Modal, type App } from "obsidian";
import { createElement, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  OperationKind
} from "../types/operations";
import { businessLabel, t } from "../i18n";
import { messageFor } from "./editorPrimitives";

const UNCATEGORIZED_CATEGORY_KEY = "__asset-track-uncategorized__";

export interface TransactionBatchEditModalOptions {
  app: App;
  operationType: Extract<OperationKind, "bulk-edit-counterparty" | "bulk-edit-product" | "bulk-edit-category">;
  categories: CategoryDefinition[];
  transactionType?: "支出" | "收入";
  categorySelectionConflict?: boolean;
  categorySelectionConflictTypes?: string[];
  onConfirm: (value: { target_value: string; target_category_key?: string | null }) => void | Promise<void>;
}

function titleFor(operationType: TransactionBatchEditModalOptions["operationType"]): string {
  if (operationType === "bulk-edit-counterparty") return t("修改交易对手", "Edit counterparty");
  if (operationType === "bulk-edit-product") return t("修改商品", "Edit item");
  return t("修改分类", "Edit category");
}

function BatchEditContent({
  operationType,
  categories,
  transactionType,
  categorySelectionConflict = false,
  categorySelectionConflictTypes = [],
  onConfirm,
  onClose
}: Omit<TransactionBatchEditModalOptions, "app"> & { onClose: () => void }) {
  const [value, setValue] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isCategory = operationType === "bulk-edit-category";
  const categoryEditBlocked = isCategory && categorySelectionConflict;
  const conflictTypes = categorySelectionConflictTypes.map(businessLabel).join(t("、", ", ")) || t("不同流水类型", "different transaction types");
  const availableCategories = useMemo(
    () => categories.filter((category) =>
      category.is_active && (!transactionType || category.transaction_type === transactionType)
    ),
    [categories, transactionType]
  );

  const confirm = async () => {
    if (categoryEditBlocked) return;
    const isUncategorized = isCategory && categoryKey === UNCATEGORIZED_CATEGORY_KEY;
    const selected = isCategory && !isUncategorized
      ? availableCategories.find((category) => category.category_key === categoryKey)
      : null;
    if (isCategory && !categoryKey) {
      setMessage(t("请选择目标分类，或选择未分类。", "Choose a target category or select Uncategorized."));
      return;
    }
    if (isCategory && !isUncategorized && !selected) {
      setMessage(t("目标分类无效，请重新选择。", "The target category is invalid. Choose another category."));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await onConfirm({
        target_value: isCategory ? (isUncategorized ? "" : selected?.name ?? "") : value.trim(),
        ...(isCategory
          ? { target_category_key: isUncategorized ? null : selected?.category_key }
          : {})
      });
      onClose();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  return <div className="asset-track-batch-edit-modal-content">
    <p>{isCategory
      ? t("选择目标分类；选择“未分类”可以清空分类。确认后直接进入当前月份草稿，保存流水后才会写入数据库。", "Choose a target category. Choose “Uncategorized” to clear the category. Confirmation changes the current-month draft; save transactions to persist it.")
      : t("输入目标值；留空可以清空商品或交易对手。确认后直接进入当前月份草稿。", "Enter a target value. Leave it empty to clear the item or counterparty. Confirmation changes the current-month draft.")}</p>
    {message && <p className="asset-track-rule-history-message" role="alert">{message}</p>}
    {categoryEditBlocked && <div className="asset-track-batch-edit-warning" role="alert">
      <strong>{t(`不能同时修改${conflictTypes}的分类`, `Cannot edit categories across ${conflictTypes}`)}</strong>
      <span>{t(`当前选择包含${conflictTypes}，请分开选择后再修改分类。`, `The current selection contains ${conflictTypes}. Select them separately before editing categories.`)}</span>
    </div>}
    {isCategory ? <label>{t("目标分类", "Target category")}
      <select disabled={busy || categoryEditBlocked} value={categoryKey} onChange={(event) => {
        const nextCategoryKey = event.target.value;
        setCategoryKey(nextCategoryKey);
      }}>
        <option value="">{t("请选择分类", "Choose category")}</option>
        <option value={UNCATEGORIZED_CATEGORY_KEY}>{t("未分类", "Uncategorized")}</option>
        {availableCategories.map((category) => <option key={category.category_key} value={category.category_key}>
          {category.name}{category.description ? ` — ${category.description}` : ""}
        </option>)}
      </select>
    </label> : <label>{operationType === "bulk-edit-counterparty"
      ? t("交易对手", "Counterparty")
      : t("商品", "Item")}
      <input
        autoFocus
        value={value}
        placeholder={t("留空以清空", "Leave empty to clear")}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>}
    <div className="asset-track-rule-create-actions">
      <button type="button" className="mod-cta" disabled={busy || categoryEditBlocked} onClick={() => void confirm()}>
        {busy ? t("正在修改…", "Applying changes…") : t("确认修改", "Confirm changes")}
      </button>
      <button type="button" disabled={busy} onClick={onClose}>{t("取消", "Cancel")}</button>
    </div>
  </div>;
}

export class TransactionBatchEditModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: TransactionBatchEditModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(titleFor(this.options.operationType));
    this.modalEl.addClass("asset-track-batch-edit-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(BatchEditContent, {
      operationType: this.options.operationType,
      categories: this.options.categories,
      transactionType: this.options.transactionType,
      categorySelectionConflict: this.options.categorySelectionConflict,
      categorySelectionConflictTypes: this.options.categorySelectionConflictTypes,
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
