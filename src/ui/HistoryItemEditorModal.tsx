import { Modal, type App } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConfigurationEditorPort } from "../services/ports";
import type { CategoryDefinition } from "../types/configuration";
import type { HistoricalProductStat, SavedRule } from "../types/rules";
import { t } from "../i18n";
import { CounterpartyRenameContent } from "./CounterpartyRenameModal";
import { ProductRenameContent } from "./ProductRenameModal";
import { RuleCreationContent } from "./RuleCreationModal";
import { HistoryBackfillContent } from "./configuration/RuleHistoryWorkspace";

export interface HistoryItemEditorModalOptions {
  app: App;
  api: ConfigurationEditorPort;
  categories: CategoryDefinition[];
  group: HistoricalProductStat;
  groupBy: "product" | "counterparty";
  onSaved: () => void;
  onDataChanged: () => void;
  onCreateRule?: (rule: SavedRule) => Promise<void>;
}

function HistoryItemEditorContent({ options, hostWindow, onClose }: {
  options: HistoryItemEditorModalOptions;
  hostWindow: Window;
  onClose: () => void;
}) {
  const { api, group, groupBy, categories, onSaved, onDataChanged } = options;
  const groupName = groupBy === "product" ? t("商品", "Item") : t("交易对手", "Counterparty");
  const initialQuery = { transaction_type: group.transaction_type, product_key: group.product_key,
    group_by: groupBy, read_scope: "all" as const };
  const suggestion = group.rule_suggestion;
  return <div className="asset-track-history-item-editor">
    <section className="asset-track-history-item-editor-section">
      <h3>{t(`编辑${groupName}`, `Edit ${groupName.toLowerCase()}`)}</h3>
      {groupBy === "product"
        ? <ProductRenameContent api={api} group={group} hostWindow={hostWindow} onSaved={onSaved} onDataChanged={onDataChanged} onClose={onClose} />
        : <CounterpartyRenameContent api={api} group={group} hostWindow={hostWindow} onSaved={onSaved} onDataChanged={onDataChanged} onClose={onClose} />}
    </section>
    <section className="asset-track-history-item-editor-section">
      <h3>{t("批量修改历史分类", "Edit historical categories")}</h3>
      <HistoryBackfillContent api={api} categories={categories} mode="product"
        initialQuery={initialQuery} detailOnly detailGroup={group} groupBy={groupBy} hostWindow={hostWindow}
        confirmAction={async () => true} onSaved={onSaved} onDataChanged={onDataChanged} onClose={onClose} />
    </section>
    {suggestion && group.unmatched_occurrences > 0 && options.onCreateRule && <section className="asset-track-history-item-editor-section">
      <h3>{t("创建匹配规则", "Create matching rule")}</h3>
      <RuleCreationContent
        categories={categories}
        initial={{ transaction_type: group.transaction_type,
          match_scope: suggestion.match_scope ?? (groupBy === "counterparty" ? "merchant" : "product"),
          counterparty: suggestion.counterparty ?? (groupBy === "counterparty" ? group.product : ""),
          product: suggestion.product ?? (groupBy === "product" ? group.product : ""),
          category_key: suggestion.category_key ?? group.recommended_category_key ?? "",
          category: suggestion.category ?? group.recommended_category }}
        onConfirm={options.onCreateRule} onClose={onClose} />
    </section>}
  </div>;
}

export class HistoryItemEditorModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly options: HistoryItemEditorModalOptions) { super(options.app); }

  onOpen(): void {
    this.modalEl.addClass("asset-track-native-modal", "asset-track-rule-history-modal", "asset-track-history-item-editor-modal");
    this.setTitle(this.options.groupBy === "product" ? t("编辑商品", "Edit item") : t("编辑交易对手", "Edit counterparty"));
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(HistoryItemEditorContent, { options: this.options, hostWindow, onClose: () => this.close() }));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
