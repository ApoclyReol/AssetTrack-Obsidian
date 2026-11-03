import { ManagedModal } from "./ManagedModal";
import { type App } from "obsidian";
import {
  createElement,
  useState
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  SavedRule,
  RuleAmountFields
} from "../types/rules";
import { RuleAmountConditionInput } from "./RuleAmountConditionInput";
import { RuleRewriteInputs } from "./RuleRewriteEditor";
import type { RuleRewriteFields } from "../types/rules";
import { EMPTY_RULE_AMOUNT, readRuleAmountFields, ruleAmountBounds } from "../domain/ruleAmounts";
import { AssetTrackError } from "../application/errors";
import { businessLabel, displayError, t } from "../i18n";
import { formatRuleAmount } from "./ruleAmountFormat";
import { ruleConflictMessages } from "./rules/ruleConflictMessages";
import { rewriteRuleFields } from "../domain/ruleRewrites";
import { HoverHint } from "./HoverHint";
import { inferRuleScope, inferRuleScopeFromConditions, ruleCategoryType } from "../domain/rules";

export interface RuleCreationModalOptions {
  app: App;
  categories: CategoryDefinition[];
  suggestedAmount?: number | null;
  rules?: SavedRule[];
  confirmLabel?: string;
  initial: Pick<SavedRule, "transaction_type" | "product" | "category_key" | "category">
    & Partial<Pick<SavedRule, "id">>
    & Partial<Pick<SavedRule, "match_scope" | "counterparty">> & RuleAmountFields & RuleRewriteFields;
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

export function RuleCreationContent({
  categories,
  rules = [],
  initial,
  suggestedAmount,
  confirmLabel,
  onConfirm,
  onClose
}: Omit<RuleCreationModalOptions, "app"> & { onClose: () => void }) {
  const editingId = initial.id;
  const [matchAmount, setMatchAmount] = useState<RuleAmountFields>(() => readRuleAmountFields({ ...initial }));
  const [transactionType, setTransactionType] = useState(initial.transaction_type);
  const [counterparty, setCounterparty] = useState(initial.counterparty ?? "");
  const [product, setProduct] = useState(initial.product);
  const [rewrites, setRewrites] = useState<RuleRewriteFields>({ rewrite_merchant: initial.rewrite_merchant ?? "",
    rewrite_product: initial.rewrite_product ?? "", rewrite_empty_mode: initial.rewrite_empty_mode ?? "preserve" });
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
    if (!ruleAmountBounds(matchAmount)) {
      setMessage(t("请输入有效金额或区间，最多两位小数。", "Enter a valid amount or range with up to two decimals."));
      return null;
    }
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
      ...(editingId ? { id: editingId } : {}),
      ...matchAmount,
      transaction_type: transactionType,
      match_scope: nextMatchScope,
      counterparty: nextCounterparty,
      product: nextProduct,
      category_key: category.category_key,
      category: category.name,
      rewrite_merchant: rewrites.rewrite_merchant?.trim() ?? "",
      rewrite_product: rewrites.rewrite_product?.trim() ?? "",
      rewrite_empty_mode: rewrites.rewrite_empty_mode ?? "preserve"
    };
  };

  const category = availableCategories.find((item) => item.category_key === categoryKey);
  const candidate: SavedRule = { ...matchAmount, ...rewrites, id: editingId,
    transaction_type: transactionType, match_scope: inferredMatchScope ?? "product",
    product: product.trim(), counterparty: counterparty.trim(), category_key: categoryKey,
    category: category?.name ?? "" };
  const nextRules = [...rules.filter((rule) => !editingId || rule.id !== editingId), candidate];
  const conflicts = inferredMatchScope && ruleAmountBounds(matchAmount)
    ? ruleConflictMessages(nextRules).filter((conflict) => conflict.indexes.includes(nextRules.length - 1)) : [];
  const conflictingRules = [...new Set(conflicts.flatMap((conflict) => conflict.indexes))]
    .filter((index) => index < nextRules.length - 1)
    .map((index) => ({ rule: nextRules[index], index }));
  const after = rewriteRuleFields(rewrites, { counterparty, product });

  const submit = async () => {
    const rule = buildRule();
    if (!rule || conflicts.length) return;
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

  return <div className="asset-track-rule-create-content" data-asset-track-busy={loading}>
    <div className="asset-track-rule-create-scroll">
    {message && <p className="asset-track-rule-history-message" role="alert">{message}</p>}
    <div className="asset-track-rule-create-columns">
    <section><h3>{t("匹配条件", "Match conditions")} <HoverHint content={t("按商品、交易对手或两者共同匹配。金额可限定适用范围。精确金额优先于区间和不限金额，同档组合优先于商品和交易对手。", "Match an item, counterparty, or both. Exact amounts take precedence over ranges and unrestricted amounts; combined conditions take precedence within each tier.")}><span className="asset-track-help-icon" tabIndex={0}>?</span></HoverHint></h3>
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
    <label>{t("交易对手条件", "Counterparty condition")}
      <input disabled={loading} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
    </label>
    <label>{t("商品", "Item")}
      <input disabled={loading} value={product} onChange={(event) => setProduct(event.target.value)} />
    </label>
    <fieldset className="asset-track-rule-definition-section"><legend>{t("金额条件", "Amount condition")}</legend>
    <div className="asset-track-amount-field">
      <RuleAmountConditionInput value={matchAmount} onChange={setMatchAmount} label={t("金额条件", "Amount condition")} />
    </div>
    {suggestedAmount != null && Number.isSafeInteger(suggestedAmount) && suggestedAmount >= 0 && <button type="button" disabled={loading} onClick={() => setMatchAmount({ ...EMPTY_RULE_AMOUNT, match_amount_minor: suggestedAmount })}>
      {t(`使用当前单笔金额 ${(suggestedAmount / 100).toFixed(2)}`, `Use current transaction amount ${(suggestedAmount / 100).toFixed(2)}`)}
    </button>}
    </fieldset>
    <small>{scopeLabel(inferredMatchScope)}</small>
    </section>
    <section><h3>{t("处理结果", "Result")}</h3>
    <label>{t("目标分类", "Target category")}
      <select disabled={loading} value={categoryKey} onChange={(event) => setCategoryKey(event.target.value)}>
        <option value="">{t("请选择分类", "Choose category")}</option>
        {availableCategories.map((item) => <option key={item.category_key} value={item.category_key}>{item.name}</option>)}
      </select>
    </label>
    <RuleRewriteInputs value={rewrites} onChange={setRewrites} disabled={loading} />
    <dl className="asset-track-rule-result-fields">
      <dt>{t("交易对手", "Counterparty")}</dt><dd className={after.counterparty !== counterparty ? "asset-track-rule-field-changed" : ""}>{after.counterparty || "—"}</dd>
      <dt>{t("商品", "Item")}</dt><dd className={after.product !== product ? "asset-track-rule-field-changed" : ""}>{after.product || "—"}</dd>
      <dt>{t("分类", "Category")}</dt><dd className={category?.name !== initial.category ? "asset-track-rule-field-changed" : ""}>{category?.name || "—"}</dd>
    </dl>
    </section></div>
    {editingId != null && <small>{t(`更新规则 #${editingId}`, `Update rule #${editingId}`)}</small>}
    </div>
    {conflictingRules.length > 0 && <div className="asset-track-rule-conflict-notice" role="alert">
      {conflictingRules.map(({ rule, index }) => <p key={index}>
        {t(`与${rule.id != null ? `规则#${rule.id}` : `新规则${index + 1}`}冲突，`,
          `Conflicts with ${rule.id != null ? `rule #${rule.id}` : `new rule ${index + 1}`}, `)}
        {inferRuleScope(rule) !== "merchant" && rule.product ? rule.product : t("不限商品", "Any item")}
        {" · "}{inferRuleScope(rule) !== "product" && rule.counterparty ? rule.counterparty : t("不限交易对手", "Any counterparty")}
        {" · "}{formatRuleAmount(rule)}
        {t(`，已归类到「${rule.category || "未分类"}」。`, `, assigned to “${rule.category || "Uncategorized"}”.`)}
      </p>)}
    </div>}
    <div className="asset-track-rule-create-actions">
      <button type="button" className="mod-cta" disabled={loading || conflicts.length > 0} onClick={() => void submit()}>{loading ? t("正在保存…", "Saving…") : confirmLabel ?? t("确认保存规则", "Save rule")}</button>
      <button type="button" disabled={loading} onClick={onClose}>{t("取消", "Cancel")}</button>
    </div>
  </div>;
}

export class RuleCreationModal extends ManagedModal {
  private root: Root | null = null;

  constructor(private readonly options: RuleCreationModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.installInteraction();
    this.setTitle(this.options.initial.id
      ? t("编辑匹配规则", "Edit matching rule")
      : t("创建匹配规则", "Create matching rule"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-rule-create-modal", "asset-track-rule-definition-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(RuleCreationContent, {
      categories: this.options.categories,
      rules: this.options.rules,
      confirmLabel: this.options.confirmLabel,
      suggestedAmount: this.options.suggestedAmount,
      initial: this.options.initial,
      onConfirm: this.options.onConfirm,
      onClose: () => this.completeClose()
    }));
  }

  onClose(): void {
    super.onClose();
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
