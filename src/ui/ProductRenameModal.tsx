import { Modal, Notice, type App } from "obsidian";
import {
  createElement,
  useEffect,
  useState
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  HistoricalProductStat
} from "../types/rules";
import type {
  ProductRenamePreview,
  ProductHistoryTransaction
} from "../types/history";

export type ProductRenameGroup = Pick<HistoricalProductStat, "transaction_type" | "product_key" | "product">;
import type { ConfigurationEditorPort } from "../services/ports";
import { AssetTrackError } from "../application/errors";
import { displayError, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { StaticTableHeader } from "./TablePrimitives";

export interface ProductRenameModalOptions {
  app: App;
  api: ConfigurationEditorPort;
  group: ProductRenameGroup;
  onSaved: () => void;
  onDataChanged: () => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof AssetTrackError && error.code === "revision_conflict") {
    return t("数据已被其他窗口修改，请重新加载。", "The data changed in another window. Reload and try again.");
  }
  return displayError(error);
}

export function ProductRenameContent({
  api,
  group,
  hostWindow,
  onSaved,
  onDataChanged,
  onClose
}: Omit<ProductRenameModalOptions, "app"> & {
  hostWindow: Window;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ProductHistoryTransaction[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [targetProduct, setTargetProduct] = useState(group.product);
  const [preview, setPreview] = useState<ProductRenamePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const timer = hostWindow.setTimeout(() => {
      setLoading(true);
      setMessage(t("正在加载当前商品名的流水…", "Loading transactions for the current item name…"));
      void api.productHistory({
        transaction_type: group.transaction_type,
        product_key: group.product_key
      })
        .then((result) => {
          if (!active) return;
          setRows(result.rows);
          setSelectedIds(new Set());
          setPreview(null);
          setMessage("");
        })
        .catch((error: unknown) => {
          if (active) setMessage(errorMessage(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      hostWindow.clearTimeout(timer);
    };
  }, [api, group.product_key, group.transaction_type, hostWindow]);

  const visibleRows = rows ?? [];
  const selectedRows = visibleRows.filter((row) => selectedIds.has(row.id));
  const allSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedIds.has(row.id));

  const toggleAll = () => {
    setSelectedIds(allSelected
      ? new Set()
      : new Set(visibleRows.map((row) => row.id)));
    setPreview(null);
  };

  const toggleRow = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreview(null);
  };

  const previewRename = async () => {
    if (!selectedRows.length || !targetProduct.trim()) {
      setMessage(t("请选择流水并填写目标商品名称。", "Select transactions and enter a target item name."));
      return;
    }
    setLoading(true);
    setMessage(t("正在准备修改预览…", "Preparing the item edit preview…"));
    try {
      setPreview(await api.previewProductRename({
        transaction_ids: selectedRows.map((row) => row.id),
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
    setLoading(true);
    setMessage(t("正在修改商品名称…", "Updating item names…"));
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
      new Notice(t(`已修改 ${result.updated_count} 条流水中的商品名称。`, `Updated item names in ${result.updated_count} transactions.`));
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return <div className="asset-track-product-rename-content">
    <p>{t(`当前商品名：${group.product || "（空商品）"}。选择需要修改的流水，再填写新的商品名。交易对手和分类只作为流水信息保留。`, `Current item name: ${group.product || "(empty item)"}. Select transactions to edit, then enter the new item name. Counterparties and categories remain transaction data.`)}</p>
    {message && <p className="asset-track-rule-history-message" role="status">{message}</p>}
    <div className="asset-track-rule-history-selection-actions">
      <button type="button" disabled={loading || !visibleRows.length} onClick={toggleAll}>
        {allSelected ? t("取消全选流水", "Deselect all transactions") : t("全选流水", "Select all transactions")}
      </button>
      <span className="asset-track-selected-count" role="status">{t(`已选择 ${selectedRows.length} 条流水`, `${selectedRows.length} transactions selected`)}</span>
    </div>
    <div className="asset-track-table-scroll asset-track-product-rename-scroll">
      {!rows ? null : !visibleRows.length ? <p className="asset-track-rule-history-empty">{t("没有找到当前商品名的流水。", "No transactions found for this item name.")}</p> : <table className="asset-track-product-rename-table">
        <thead><tr>
          <StaticTableHeader label={t("选择", "Select")} className="asset-track-checkbox-heading" />
          <StaticTableHeader label={t("日期", "Date")} className="asset-track-date-column" />
          <StaticTableHeader label={t("交易对手", "Counterparty")} />
          <StaticTableHeader label={t("当前商品名", "Current item")} />
          <StaticTableHeader label={t("分类", "Category")} />
          <StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" />
        </tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row.id}>
          <td><input className="asset-track-selection-checkbox" type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleRow(row.id)} aria-label={t(`选择 ${row.transaction_date} 的流水`, `Select transaction on ${row.transaction_date}`)} /></td>
          <td className="asset-track-date-cell">{row.transaction_date}</td>
          <td>{row.counterparty || t("（空）", "(empty)")}</td>
          <td>{row.product || t("（空商品）", "(empty item)")}</td>
          <td>{row.category || t("未分类", "Uncategorized")}</td>
          <td className="asset-track-amount-cell">{money(row.amount, row.type)}</td>
        </tr>)}</tbody>
      </table>}
    </div>
    <div className="asset-track-product-rename-form">
      <label>{t("修改为商品名称", "Change to item name")}
        <input value={targetProduct} onChange={(event) => { setTargetProduct(event.target.value); setPreview(null); }} />
      </label>
      <button type="button" className="mod-cta" disabled={loading || !selectedRows.length} onClick={() => void previewRename()}>{t("修改商品", "Edit item")}</button>
      {preview && <button type="button" className="mod-warning" disabled={loading} onClick={() => void applyRename()}>{t(`确认修改 ${preview.transaction_count} 条`, `Confirm ${preview.transaction_count} edits`)}</button>}
      <button type="button" disabled={loading} onClick={onClose}>{t("关闭", "Close")}</button>
    </div>
  </div>;
}

export class ProductRenameModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: ProductRenameModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(t("编辑商品", "Edit item"));
    this.modalEl.addClass("asset-track-product-rename-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(ProductRenameContent, {
      api: this.options.api,
      group: this.options.group,
      hostWindow,
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
