import { Modal } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../i18n";
import { HistoryBackfillContent } from "./configuration/RuleHistoryWorkspace";
import type { RuleHistoryModalOptions } from "./configuration/ruleHistoryTypes";

export { HistoryBackfillContent } from "./configuration/RuleHistoryWorkspace";
export type { RuleHistoryModalOptions } from "./configuration/ruleHistoryTypes";
export {
  ProductRenameContent,
  ProductRenameModal,
  type ProductRenameGroup,
  type ProductRenameModalOptions
} from "./ProductRenameModal";
export {
  CounterpartyRenameContent,
  CounterpartyRenameModal,
  type CounterpartyRenameGroup,
  type CounterpartyRenameModalOptions
} from "./CounterpartyRenameModal";
export { RuleCreationModal, type RuleCreationModalOptions } from "./RuleCreationModal";

export class RuleHistoryModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: RuleHistoryModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle(
      this.options.mode === "category"
        ? t("迁移分类历史引用", "Migrate category history")
        : this.options.detailOnly
          ? t("编辑分类", "Edit category")
        : t("商品总览", "Item overview")
    );
    this.modalEl.addClass("asset-track-rule-history-modal");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(HistoryBackfillContent, {
      api: this.options.api,
      categories: this.options.categories,
      mode: this.options.mode,
      initialQuery: this.options.initialQuery,
      detailOnly: this.options.detailOnly,
      detailGroup: this.options.detailGroup,
      hostWindow,
      confirmAction: this.options.confirmAction,
      onSaved: this.options.onSaved,
      onDataChanged: this.options.onDataChanged,
      onOpenProductRename: this.options.onOpenProductRename,
      onOpenCounterpartyRename: this.options.onOpenCounterpartyRename,
      onClose: () => this.close()
    }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
