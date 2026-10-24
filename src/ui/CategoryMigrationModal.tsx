import type { App } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConfigurationEditorPort } from "../services/ports";
import type { CategoryDefinition } from "../types/configuration";
import { t } from "../i18n";
import { ManagedModal } from "./ManagedModal";
import { HistoryBackfillContent } from "./configuration/RuleHistoryWorkspace";

export class CategoryMigrationModal extends ManagedModal {
  private root: Root | null = null;
  constructor(private readonly options: { app: App; api: ConfigurationEditorPort; category: CategoryDefinition;
    categories: CategoryDefinition[]; onSaved: () => void; onDataChanged: () => void }) { super(options.app); }
  onOpen(): void {
    this.installInteraction();
    this.setTitle(t("迁移历史流水", "Migrate historical transactions"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-rule-history-modal");
    const hostWindow = this.contentEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(HistoryBackfillContent, { api: this.options.api, categories: this.options.categories,
      mode: "category", embedded: true, initialQuery: { category_key: this.options.category.category_key }, hostWindow,
      confirmAction: async () => true, onSaved: this.options.onSaved, onDataChanged: this.options.onDataChanged }));
  }
  onClose(): void { super.onClose(); this.root?.unmount(); this.root = null; this.contentEl.empty(); }
}
