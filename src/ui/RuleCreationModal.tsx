import { Modal, type App } from "obsidian";
import {
  createElement,
  useState
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CategoryDefinition, SavedRule } from "../types";
import { AssetTrackError } from "../services/AssetTrackService";
import { businessLabel, displayError, t } from "../i18n";

export interface RuleCreationModalOptions {
  app: App;
  categories: CategoryDefinition[];
  initial: Pick<SavedRule, "transaction_type" | "counterparty" | "product" | "category_key" | "category">;
  onConfirm: (rule: SavedRule) => void | Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof AssetTrackError && error.code === "revision_conflict") {
    return t("数据已被其他窗口修改，请重新加载。", "The data changed in another window. Reload and try again.");
  }
  return displayError(error);
}

function RuleCreationContent({
  categories,
  initial,
  onConfirm,
  onClose
}: Omit<RuleCreationModalOptions, "app"> & { onClose: () => void }) {
  const [transactionType, setTransactionType] = useState(initial.transaction_type);
  const [counterparty, setCounterparty] = useState(initial.counterparty);
  const [product, setProduct] = useState(initial.product);
  const [categoryKey, setCategoryKey] = useState(initial.category_key);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const availableCategories = categories.filter((category) =>
    category.is_active && category.transaction_type === transactionType
  );

  const submit = async () => {
    const nextCounterparty = counterparty.trim();
    const nextProduct = product.trim();
    const category = availableCategories.find((item) => item.category_key === categoryKey);
    if (!nextCounterparty && !nextProduct) {
      setMessage(t("至少填写交易对方或商品中的一项。", "Enter at least a counterparty or an item."));
      return;
    }
    if (!category) {
      setMessage(t("请选择与收支类型匹配的启用分类。", "Choose an active category matching the transaction type."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await onConfirm({
        transaction_type: transactionType,
        counterparty: nextCounterparty,
        product: nextProduct,
        category_key: category.category_key,
        category: category.name
      });
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return <div className="asset-track-rule-create-content">
    <p>{t("确认后会立即保存规则，并刷新冲突面板。", "The rule is saved immediately after confirmation and the conflict panel is refreshed.")}</p>
    {message && <p className="asset-track-rule-history-message" role="alert">{message}</p>}
    <label>{t("收支", "Type")}
      <select disabled={loading} value={transactionType} onChange={(event) => {
        const next = event.target.value as SavedRule["transaction_type"];
        setTransactionType(next);
        setCategoryKey("");
      }}>
        <option value="支出">{businessLabel("支出")}</option>
        <option value="收入">{businessLabel("收入")}</option>
      </select>
    </label>
    <label>{t("交易对方", "Counterparty")}
      <input disabled={loading} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
    </label>
    <label>{t("商品", "Item")}
      <input disabled={loading} value={product} onChange={(event) => setProduct(event.target.value)} />
    </label>
    <label>{t("目标分类", "Target category")}
      <select disabled={loading} value={categoryKey} onChange={(event) => setCategoryKey(event.target.value)}>
        <option value="">{t("请选择分类", "Choose category")}</option>
        {availableCategories.map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
      </select>
    </label>
    <div className="asset-track-rule-create-actions">
      <button type="button" className="mod-cta" disabled={loading} onClick={() => void submit()}>{loading ? t("正在保存…", "Saving…") : t("确认保存规则", "Save rule")}</button>
      <button type="button" disabled={loading} onClick={onClose}>{t("取消", "Cancel")}</button>
    </div>
  </div>;
}

export class RuleCreationModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: RuleCreationModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(t("创建匹配规则", "Create matching rule"));
    this.modalEl.addClass("asset-track-rule-create-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(RuleCreationContent, {
      categories: this.options.categories,
      initial: this.options.initial,
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
