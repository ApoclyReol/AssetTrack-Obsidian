import { ManagedModal } from "./ManagedModal";
import { type App } from "obsidian";
import { createElement, useState } from "react";
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

export function HistoryItemEditorContent({ options, hostWindow, onSwitch, onCommitted }: {
  options: HistoryItemEditorModalOptions;
  hostWindow: Window;
  onSwitch: (next: () => void) => void;
  onCommitted: () => void;
}) {
  const { api, group, groupBy, categories, onSaved: notifySaved, onDataChanged } = options;
  const [task, setTask] = useState<"name" | "category" | "rule">("name");
  const [generation, setGeneration] = useState(0);
  const onSaved = () => { onCommitted(); notifySaved(); setGeneration(value => value + 1); };
  const onClose = () => {};
  const groupName = groupBy === "product" ? t("商品", "Item") : t("交易对手", "Counterparty");
  const initialQuery = { transaction_type: group.transaction_type, product_key: group.product_key,
    group_by: groupBy, read_scope: "all" as const };
  const suggestion = group.rule_suggestion;
  return <div className="asset-track-history-item-editor">
    <div className="asset-track-editor-modal-tabs">{(["name", "category", "rule"] as const).filter(value => value !== "rule" || Boolean(options.onCreateRule)).map(value =>
      <button key={value} type="button" className={task === value ? "is-active" : ""} onClick={() => onSwitch(() => setTask(value))}>
        {value === "name" ? t("名称", "Name") : value === "category" ? t("历史分类", "Historical category") : t("匹配规则", "Matching rule")}</button>)}</div>
    {task === "name" && <div key={`name-${generation}`}>
    <section className="asset-track-history-item-editor-section">
      <h3>{t(`编辑${groupName}`, `Edit ${groupName.toLowerCase()}`)}</h3>
      {groupBy === "product"
        ? <ProductRenameContent api={api} group={group} hostWindow={hostWindow} onSaved={onSaved} onDataChanged={onDataChanged} onClose={onClose} />
        : <CounterpartyRenameContent api={api} group={group} hostWindow={hostWindow} onSaved={onSaved} onDataChanged={onDataChanged} onClose={onClose} />}
    </section>
    </div>}
    {task === "category" && <section key={`category-${generation}`} className="asset-track-history-item-editor-section">
      <h3>{t("批量修改历史分类", "Edit historical categories")}</h3>
      <HistoryBackfillContent api={api} categories={categories} mode="product"
        initialQuery={initialQuery} detailOnly detailGroup={group} groupBy={groupBy} hostWindow={hostWindow}
        confirmAction={async () => true} onSaved={onSaved} onDataChanged={onDataChanged} onClose={onClose} />
    </section>}
    {task === "rule" && options.onCreateRule && <section className="asset-track-history-item-editor-section">
      <h3>{t("创建匹配规则", "Create matching rule")}</h3>
      {suggestion && group.unmatched_occurrences > 0 ? <RuleCreationContent
        categories={categories}
        initial={{ transaction_type: group.transaction_type,
          match_scope: suggestion.match_scope ?? (groupBy === "counterparty" ? "merchant" : "product"),
          counterparty: suggestion.counterparty ?? (groupBy === "counterparty" ? group.product : ""),
          product: suggestion.product ?? (groupBy === "product" ? group.product : ""),
          category_key: suggestion.category_key ?? group.recommended_category_key ?? "",
          category: suggestion.category ?? group.recommended_category }}
        onConfirm={async rule => { await options.onCreateRule?.(rule); onSaved(); }} onClose={onClose} /> : <p role="status">{group.unmatched_occurrences === 0
          ? t("当前流水已全部命中规则。如需调整，请前往配置中的匹配规则。", "All current transactions match rules. To adjust them, open Matching rules in Configuration.")
          : t("暂无可用的规则建议，请前往配置中的匹配规则手动新增。", "No rule suggestion is available. Add a rule manually in Matching rules under Configuration.")}</p>}
    </section>}
  </div>;
}

export class HistoryItemEditorModal extends ManagedModal {
  private root: Root | null = null;

  constructor(private readonly options: HistoryItemEditorModalOptions) { super(options.app); }

  onOpen(): void {
    this.installInteraction();
    this.modalEl.addClass("asset-track-native-modal", "asset-track-rule-history-modal", "asset-track-history-item-editor-modal");
    this.setTitle(this.options.groupBy === "product" ? t("编辑商品", "Edit item") : t("编辑交易对手", "Edit counterparty"));
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    this.root = createRoot(this.contentEl);
    this.root.render(createElement(HistoryItemEditorContent, { options: this.options, hostWindow, onSwitch: (next: () => void) => this.confirmTaskChange(next), onCommitted: () => this.markClean() }));
  }

  onClose(): void {
    super.onClose();
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
