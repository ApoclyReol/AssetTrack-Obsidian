import { Modal, Notice, type App } from "obsidian";
import {
  createElement,
  useEffect,
  useMemo,
  useState
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  CategoryDefinition,
  HistoricalProductStat,
  ProductRenamePreview,
  ProductHistoryQuery,
  ProductHistoryTransaction
} from "../types";
import {
  AssetTrackError,
  type AssetTrackService
} from "../services/AssetTrackService";
import { displayError, t } from "../i18n";
import { normalizeProductKey } from "../domain/rules";
import { StaticTableHeader } from "./TablePrimitives";

export interface ProductRenameModalOptions {
  app: App;
  api: AssetTrackService;
  categories: CategoryDefinition[];
  group: HistoricalProductStat;
  confirmAction: (
    title: string,
    message: string,
    confirmText?: string
  ) => Promise<boolean>;
  onSaved: () => void;
  onDataChanged: () => void;
}

type ProductRenameAggregation = "category-product" | "product";

interface ProductRenameAggregate {
  key: string;
  category_key: string | null;
  category: string;
  product: string;
  variants: string[];
  ids: number[];
  months: Set<string>;
}

function errorMessage(error: unknown): string {
  if (error instanceof AssetTrackError && error.code === "revision_conflict") {
    return t("数据已被其他窗口修改，请重新加载。", "The data changed in another window. Reload and try again.");
  }
  return displayError(error);
}

export function ProductRenameContent({
  api,
  categories,
  group,
  hostWindow,
  confirmAction,
  onSaved,
  onDataChanged,
  onClose
}: Omit<ProductRenameModalOptions, "app"> & {
  hostWindow: Window;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ProductHistoryTransaction[] | null>(null);
  const [aggregation, setAggregation] = useState<ProductRenameAggregation>("category-product");
  const [categoryFilter, setCategoryFilter] = useState(
    group.recommended_category_key ?? "__uncategorized__"
  );
  const [productSearch, setProductSearch] = useState("");
  const [selectedAggregates, setSelectedAggregates] = useState<Set<string>>(new Set());
  const [targetProduct, setTargetProduct] = useState(group.product);
  const [preview, setPreview] = useState<ProductRenamePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const candidateQuery = useMemo<ProductHistoryQuery | null>(() => {
    const search = productSearch.trim();
    if (categoryFilter === "__all__" && !search) return null;
    return {
      transaction_type: group.transaction_type,
      category_key: categoryFilter === "__all__"
        ? undefined
        : categoryFilter === "__uncategorized__"
          ? null
          : categoryFilter,
      product_search: search || undefined
    };
  }, [categoryFilter, group.transaction_type, productSearch]);

  useEffect(() => {
    setSelectedAggregates(new Set());
    setPreview(null);
    if (!candidateQuery) {
      setRows(null);
      setMessage(t(
        "查看全部分类时，请先输入商品搜索条件。",
        "Enter an item search before viewing all categories."
      ));
      return;
    }
    let active = true;
    const timer = hostWindow.setTimeout(() => {
      setLoading(true);
      setMessage(t("正在加载商品候选…", "Loading item candidates…"));
      void api.productHistory(candidateQuery)
        .then((result) => {
          if (!active) return;
          setRows(result.rows);
          setMessage("");
        })
        .catch((error: unknown) => {
          if (active) setMessage(errorMessage(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      hostWindow.clearTimeout(timer);
    };
  }, [api, candidateQuery, hostWindow]);

  const aggregates = useMemo<ProductRenameAggregate[]>(() => {
    const grouped = new Map<string, ProductRenameAggregate>();
    for (const row of rows ?? []) {
      const productKey = normalizeProductKey(row.product);
      const categoryKey = aggregation === "category-product" ? row.category_key : null;
      const key = `${categoryKey ?? ""}\u0000${productKey}`;
      const current = grouped.get(key) ?? {
        key,
        category_key: categoryKey,
        category: row.category,
        product: row.product,
        variants: [],
        ids: [],
        months: new Set<string>()
      };
      if (!current.variants.includes(row.product)) current.variants.push(row.product);
      if (!current.product && row.product) current.product = row.product;
      current.ids.push(row.id);
      current.months.add(row.month);
      if (!current.category && row.category) current.category = row.category;
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((left, right) =>
      right.ids.length - left.ids.length
      || left.category.localeCompare(right.category)
      || left.product.localeCompare(right.product)
    );
  }, [aggregation, rows]);

  const selectedIds = useMemo(() => aggregates
    .filter((aggregate) => selectedAggregates.has(aggregate.key))
    .flatMap((aggregate) => aggregate.ids), [aggregates, selectedAggregates]);
  const allSelected = aggregates.length > 0
    && aggregates.every((aggregate) => selectedAggregates.has(aggregate.key));

  const toggleAll = () => {
    setSelectedAggregates(allSelected
      ? new Set()
      : new Set(aggregates.map((aggregate) => aggregate.key)));
    setPreview(null);
  };

  const toggleAggregate = (key: string) => {
    setSelectedAggregates((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setPreview(null);
  };

  const previewRename = async () => {
    if (!selectedIds.length || !targetProduct.trim()) {
      setMessage(t("请选择商品聚合并填写目标商品名称。", "Select item groups and enter a target item name."));
      return;
    }
    setLoading(true);
    setMessage(t("正在生成商品统一预览…", "Preparing the item rename preview…"));
    try {
      setPreview(await api.previewProductRename({
        transaction_ids: selectedIds,
        target_product: targetProduct
      }));
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const applyRename = async () => {
    if (!preview) return;
    const confirmed = await confirmAction(
      t("确认统一商品名称？", "Confirm item name update?"),
      t(
        `将把 ${preview.transaction_count} 条流水中的商品名称统一为“${preview.target_product}”，涉及 ${preview.month_count} 个月份；分类和规则不会自动改变。`,
        `This will rename the item in ${preview.transaction_count} transactions across ${preview.month_count} months to “${preview.target_product}”. Categories and rules will not change automatically.`
      ),
      t("确认写入", "Apply changes")
    );
    if (!confirmed) return;
    setLoading(true);
    setMessage(t("正在统一商品名称…", "Updating item names…"));
    try {
      const result = await api.applyProductRename({
        transaction_ids: preview.transaction_ids,
        target_product: preview.target_product,
        expected_month_revisions: Object.fromEntries(
          preview.months.map((month) => [month.month, month.revision])
        )
      });
      onSaved();
      onDataChanged();
      new Notice(t(`已更新 ${result.updated_count} 条流水中的商品名称。`, `Updated item names in ${result.updated_count} transactions.`));
      setMessage(t(`已更新 ${result.updated_count} 条流水。`, `Updated ${result.updated_count} transactions.`));
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return <div className="asset-track-product-rename-content">
    <p>{t("可以按“分类 + 商品”或“商品”选择多个聚合。这里只修改商品名称，不会自动修改规则或分类。", "Select multiple groups by category + item or by item. Only item names change; rules and categories are not updated automatically.")}</p>
    {message && <p className="asset-track-rule-history-message" role="status">{message}</p>}
    <div className="asset-track-product-rename-options">
      <label>{t("聚合方式", "Group by")}
        <select value={aggregation} onChange={(event) => {
          setAggregation(event.target.value as ProductRenameAggregation);
          setSelectedAggregates(new Set());
          setPreview(null);
        }}>
          <option value="category-product">{t("分类 + 商品", "Category + item")}</option>
          <option value="product">{t("商品", "Item")}</option>
        </select>
      </label>
      <label>{t("分类范围", "Category scope")}
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          {categories
            .filter((category) => category.transaction_type === group.transaction_type)
            .map((category) => <option key={category.category_key} value={category.category_key}>{category.name}</option>)}
          <option value="__uncategorized__">{t("未分类", "Uncategorized")}</option>
          <option value="__all__">{t("全部分类（需要搜索）", "All categories (search required)")}</option>
        </select>
      </label>
      <label>{t("商品搜索", "Item search")}
        <input
          value={productSearch}
          onChange={(event) => setProductSearch(event.target.value)}
          placeholder={t("输入名称或片段", "Enter a name or fragment")}
        />
      </label>
    </div>
    <div className="asset-track-rule-history-selection-actions">
      <button type="button" disabled={loading || !aggregates.length} onClick={toggleAll}>
        {allSelected ? t("取消全选当前聚合", "Deselect current groups") : t("全选当前聚合", "Select current groups")}
      </button>
      <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedAggregates.size} 个聚合、${selectedIds.length} 条流水`, `${selectedAggregates.size} groups and ${selectedIds.length} transactions selected`)}</span>
    </div>
    <div className="asset-track-table-scroll asset-track-product-rename-scroll">
      {aggregates.length === 0 ? <p className="asset-track-rule-history-empty">{t("没有可编辑的商品聚合。", "No editable item groups found.")}</p> : <table className="asset-track-product-rename-table">
        <thead><tr><StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" /><StaticTableHeader label={t("分类", "Category")} /><StaticTableHeader label={t("原始商品及变体", "Original item and variants")} /><StaticTableHeader label={t("次数", "Occurrences")} className="asset-track-count-column" /><StaticTableHeader label={t("月份数", "Months")} className="asset-track-count-column" /></tr></thead>
        <tbody>{aggregates.map((aggregate) => <tr key={aggregate.key}>
          <td><input className="asset-track-selection-checkbox" type="checkbox" checked={selectedAggregates.has(aggregate.key)} onChange={() => toggleAggregate(aggregate.key)} aria-label={t(`选择${aggregate.category || "未分类"}中的${aggregate.product || "空商品"}`, `Select ${aggregate.product || "empty item"} in ${aggregate.category || "uncategorized"}`)} /></td>
          <td>{aggregate.category || t("未分类", "Uncategorized")}</td>
          <td title={aggregate.variants.join("、")}>{aggregate.product || t("（空商品）", "(empty item)")}{aggregate.variants.length > 1 ? ` · ${aggregate.variants.join("、")}` : ""}</td>
          <td className="asset-track-count-cell">{aggregate.ids.length}</td>
          <td className="asset-track-count-cell">{aggregate.months.size}</td>
        </tr>)}</tbody>
      </table>}
    </div>
    <div className="asset-track-product-rename-form">
      <label>{t("统一为商品名称", "Unified item name")}
        <input value={targetProduct} onChange={(event) => { setTargetProduct(event.target.value); setPreview(null); }} />
      </label>
      <button type="button" className="mod-cta" disabled={loading || !selectedIds.length} onClick={() => void previewRename()}>{t("生成预览", "Preview")}</button>
      <button type="button" disabled={loading} onClick={onClose}>{t("关闭", "Close")}</button>
    </div>
    {preview && <div className="asset-track-backfill-preview" role="status">
      <strong>{t("商品名称预览", "Item name preview")}</strong>
      <p>{t(`将 ${preview.transaction_count} 条流水统一为“${preview.target_product}”，涉及 ${preview.month_count} 个月份。`, `Rename ${preview.transaction_count} transactions to “${preview.target_product}” across ${preview.month_count} months.`)}</p>
      <p>{preview.variants.map((variant) => `${variant.product || t("（空商品）", "(empty item)")} (${variant.occurrences})`).join("、")}</p>
      <p>{preview.months.map((month) => `${month.month} revision ${month.revision} (${month.count})`).join(" · ")}</p>
      <button type="button" className="mod-cta" disabled={loading} onClick={() => void applyRename()}>{t("确认写入", "Apply changes")}</button>
    </div>}
  </div>;
}

export class ProductRenameModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: ProductRenameModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(t("统一商品名称", "Unify item name"));
    this.modalEl.addClass("asset-track-product-rename-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(ProductRenameContent, {
      api: this.options.api,
      categories: this.options.categories,
      group: this.options.group,
      hostWindow,
      confirmAction: this.options.confirmAction,
      onSaved: this.options.onSaved,
      onDataChanged: this.options.onDataChanged,
      onClose: () => this.close()
    }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
