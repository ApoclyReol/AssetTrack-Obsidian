import { Modal, type App } from "obsidian";
import {
  createElement,
  useState
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  SavedRule
} from "../types/rules";
import { AssetTrackError } from "../application/errors";
import { businessLabel, displayError, t } from "../i18n";
import { inferRuleScopeFromConditions, ruleCategoryType } from "../domain/rules";

export interface RuleCreationModalOptions {
  app: App;
  categories: CategoryDefinition[];
  initial: Pick<SavedRule, "transaction_type" | "product" | "category_key" | "category">
    & Partial<Pick<SavedRule, "id">>
    & Partial<Pick<SavedRule, "match_scope" | "counterparty" | "rewrite_merchant" | "rewrite_product">>;
  onConfirm: (rule: SavedRule) => void | Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof AssetTrackError && error.code === "revision_conflict") {
    return t("数据已被其他窗口修改，请重新加载。", "The data changed in another window. Reload and try again.");
  }
  return displayError(error);
}

function scopeLabel(value: SavedRule["match_scope"] | null): string {
  return value === "merchant_product"
    ? t("交易对手 + 商品", "Counterparty + item")
    : value === "merchant"
      ? t("仅交易对手", "Counterparty only")
      : value === "product"
        ? t("仅商品", "Item only")
        : t("待填写", "Incomplete");
}

function RuleCreationContent({
  categories,
  initial,
  onConfirm,
  onClose
}: Omit<RuleCreationModalOptions, "app"> & { onClose: () => void }) {
  const [transactionType, setTransactionType] = useState(initial.transaction_type);
  const [counterparty, setCounterparty] = useState(initial.counterparty ?? "");
  const [product, setProduct] = useState(initial.product);
  const [rewriteMerchant, setRewriteMerchant] = useState(initial.rewrite_merchant ?? "");
  const [rewriteProduct, setRewriteProduct] = useState(initial.rewrite_product ?? "");
  const [categoryKey, setCategoryKey] = useState(initial.category_key);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const inferredMatchScope = inferRuleScopeFromConditions({
    counterparty,
    product
  });
  const availableCategories = categories.filter((category) =>
    category.is_active && category.transaction_type === ruleCategoryType(transactionType)
  );

  const buildRule = (): SavedRule | null => {
    const nextCounterparty = counterparty.trim();
    const nextProduct = product.trim();
    const nextMatchScope = inferRuleScopeFromConditions({
      counterparty: nextCounterparty,
      product: nextProduct
    });
    const category = availableCategories.find((item) => item.category_key === categoryKey);
    if (!nextMatchScope) {
      setMessage(t("请至少填写交易对手或商品条件。", "Enter at least a counterparty or item condition."));
      return null;
    }
    if (!category) {
      setMessage(t("请选择与收支类型匹配的启用分类。", "Choose an active category matching the transaction type."));
      return null;
    }
    return {
      ...(initial.id ? { id: initial.id } : {}),
      transaction_type: transactionType,
      match_scope: nextMatchScope,
      counterparty: nextCounterparty,
      product: nextProduct,
      category_key: category.category_key,
      category: category.name,
      rewrite_merchant: rewriteMerchant.trim(),
      rewrite_product: rewriteProduct.trim()
    };
  };

  const submit = async () => {
    const rule = buildRule();
    if (!rule) return;
    setLoading(true);
    setMessage("");
    try {
      await onConfirm(rule);
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return <div className="asset-track-rule-create-content">
    <p>{t("规则保存不会自动改写历史流水；如需使用，请在流水页单独应用规则。", "Saving a rule does not rewrite historical transactions. Apply it separately from the transaction page when needed.")}</p>
    {message && <p className="asset-track-rule-history-message" role="alert">{message}</p>}
    <label>{t("收支", "Type")}
      <select disabled={loading} value={transactionType} onChange={(event) => {
        const next = event.target.value as SavedRule["transaction_type"];
        setTransactionType(next);
        setCategoryKey("");
      }}>
        <option value="支出">{businessLabel("支出")}</option>
        <option value="收入">{businessLabel("收入")}</option>
        <option value="代付">{businessLabel("代付")}</option>
      </select>
    </label>
    <label>{t("匹配范围", "Match scope")}
      <span className="asset-track-readonly-field">{scopeLabel(inferredMatchScope)}</span>
    </label>
    <label>{t("交易对手条件", "Counterparty condition")}
      <input disabled={loading} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
    </label>
    <label>{t("商品", "Item")}
      <input disabled={loading} value={product} onChange={(event) => setProduct(event.target.value)} />
    </label>
    <label>{t("重写交易对手（可选）", "Rewrite counterparty (optional)")}
      <input disabled={loading} value={rewriteMerchant} onChange={(event) => setRewriteMerchant(event.target.value)} />
    </label>
    <label>{t("重写商品（可选）", "Rewrite item (optional)")}
      <input disabled={loading} value={rewriteProduct} onChange={(event) => setRewriteProduct(event.target.value)} />
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
    this.setTitle(this.options.initial.id
      ? t("编辑匹配规则", "Edit matching rule")
      : t("创建匹配规则", "Create matching rule"));
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
