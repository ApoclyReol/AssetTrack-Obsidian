import { Modal, type App } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConfigurationEditorPort } from "../services/ports";
import type { AttributeGroup, AttributeOption, CategoryDefinition } from "../types/configuration";
import { businessLabel, t } from "../i18n";
import { HistoryBackfillContent } from "./configuration/RuleHistoryWorkspace";

export interface CategoryEditorModalOptions {
  app: App;
  api: ConfigurationEditorPort;
  category: CategoryDefinition;
  categories: CategoryDefinition[];
  groups: AttributeGroup[];
  options: AttributeOption[];
  onApply: (category: CategoryDefinition) => void;
  onRemove: () => void;
  onSavedHistory: () => void;
  onDataChanged: () => void;
  onOpenRules: () => void;
  isNew?: boolean;
}

export class CategoryEditorModal extends Modal {
  private root: Root | null = null;
  private draft: CategoryDefinition;
  private closed = false;

  constructor(private readonly options: CategoryEditorModalOptions) {
    super(options.app);
    this.draft = { ...options.category, attribute_keys: [...(options.category.attribute_keys ?? [])] };
  }

  onOpen(): void {
    this.modalEl.addClass("asset-track-native-modal", "asset-track-category-editor-modal");
    this.setTitle(this.options.isNew ? t("新增分类", "Add category")
      : t(`编辑分类“${this.draft.name}”`, `Edit category “${this.draft.name}”`));
    this.contentEl.createEl("p", { text: t("正在载入属性…", "Loading attributes…") });
    if (!this.options.api.taxonomy) { this.render(); return; }
    void this.options.api.taxonomy().then((workspace) => {
      if (this.closed) return;
      this.options.groups = workspace.groups;
      this.options.options = workspace.options;
      this.render();
    }).catch(() => { if (!this.closed) this.render(); });
  }

  private render(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    this.renderTabs("category");
    this.renderFields();
  }

  private renderTabs(active: "category" | "history"): void {
    const tabs = this.contentEl.createDiv({ cls: "asset-track-editor-modal-tabs" });
    tabs.setAttribute("role", "tablist");
    const editor = tabs.createEl("button", { text: t("分类与属性", "Category and attributes") });
    editor.type = "button";
    editor.setAttribute("role", "tab");
    editor.setAttribute("aria-selected", String(active === "category"));
    editor.tabIndex = active === "category" ? 0 : -1;
    if (active === "category") editor.addClass("is-active");
    editor.addEventListener("click", () => this.render());
    editor.addEventListener("keydown", (event) => {
      if (this.options.isNew || (event.key !== "ArrowRight" && event.key !== "End")) return;
      event.preventDefault();
      this.renderHistory();
      this.contentEl.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
    if (!this.options.isNew) {
      const history = tabs.createEl("button", { text: t("迁移历史流水", "Migrate history") });
      history.type = "button";
      history.setAttribute("role", "tab");
      history.setAttribute("aria-selected", String(active === "history"));
      history.tabIndex = active === "history" ? 0 : -1;
      if (active === "history") history.addClass("is-active");
      history.addEventListener("click", () => this.renderHistory());
      history.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "Home") return;
        event.preventDefault();
        this.render();
        this.contentEl.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
      });
    }
  }

  private renderFields(): void {
    const form = this.contentEl.createDiv({ cls: "asset-track-category-editor-fields asset-track-editor-modal-section" });
    if (this.options.isNew) {
      const basics = form.createDiv({ cls: "asset-track-category-editor-basic-grid" });
      const name = basics.createEl("label", { text: t("分类名称", "Category name") });
      const nameInput = name.createEl("input", { type: "text" });
      nameInput.value = this.draft.name;
      nameInput.addEventListener("input", () => { this.draft.name = nameInput.value; });
    }
    if (this.options.isNew) {
      const core = form.createDiv({ cls: "asset-track-category-editor-core-grid" });
      const kind = core.createEl("label", { text: t("收支", "Type") });
      const kindInput = kind.createEl("select");
      (["支出", "收入"] as const).forEach((value) => kindInput.createEl("option", { value, text: businessLabel(value) }));
      kindInput.value = this.draft.transaction_type;
      kindInput.addEventListener("change", () => { this.draft.transaction_type = kindInput.value as "支出" | "收入"; });
      const color = core.createEl("label", { text: t("颜色", "Color") });
      const colorInput = color.createEl("input", { type: "color" });
      colorInput.value = this.draft.color;
      colorInput.addEventListener("input", () => { this.draft.color = colorInput.value; });
    }
    const attributes = this.contentEl.createEl("fieldset", { cls: "asset-track-category-attributes asset-track-editor-modal-section" });
    attributes.createEl("legend", { text: t("分类属性", "Category attributes") });
    attributes.createEl("p", { cls: "asset-track-modal-subtitle", text: t("每个属性名称最多选择一个属性值；留空表示不设置。", "Choose at most one value per attribute name; leave it unset when it does not apply.") });
    const selected = new Set(this.draft.attribute_keys ?? []);
    this.options.groups.forEach((group) => {
      // Attribute definitions are user managed.  A category editor must be
      // able to preserve and change every definition currently present in the
      // workspace, including definitions created before an older inactive
      // flag was removed from the configuration UI.
      const choices = this.options.options.filter((option) => option.group_key === group.group_key);
      const fieldset = attributes.createEl("fieldset");
      fieldset.createEl("legend", { text: group.name || t("未命名属性名称", "Unnamed attribute name") });
      const groupName = `category-${this.draft.category_key}-${group.group_key}`;
      const addChoice = (value: string, label: string): void => {
        const wrapper = fieldset.createEl("label");
        const input = wrapper.createEl("input", { type: "radio" });
        input.name = groupName;
        input.value = value;
        input.checked = value ? selected.has(value) : !choices.some((choice) => selected.has(choice.attribute_key));
        input.addEventListener("change", () => {
          this.draft.attribute_keys = (this.draft.attribute_keys ?? [])
            .filter((key) => !choices.some((choice) => choice.attribute_key === key));
          if (value) this.draft.attribute_keys.push(value);
        });
        wrapper.createSpan({ text: label });
      };
      addChoice("", t("未设置", "None"));
      choices.forEach((choice) => addChoice(choice.attribute_key, choice.name || choice.attribute_key));
    });
    if (!attributes.querySelector("fieldset")) attributes.createEl("p", { text: t("暂无可选属性。", "No attributes are available.") });
    const actions = this.contentEl.createDiv({ cls: "asset-track-rule-create-actions" });
    const apply = actions.createEl("button", { text: this.options.isNew ? t("添加到草稿", "Add to draft") : t("应用到分类草稿", "Apply to category draft"), cls: "mod-cta" });
    apply.type = "button";
    apply.addEventListener("click", () => {
      this.options.onApply({ ...this.draft, attribute_keys: [...(this.draft.attribute_keys ?? [])] });
      this.close();
    });
    if (!this.options.isNew) {
      const remove = actions.createEl("button", { text: t("移除分类", "Remove category"), cls: "mod-warning" });
      remove.type = "button";
      remove.addEventListener("click", () => this.renderRemoval());
    }
  }

  private renderRemoval(): void {
    this.contentEl.querySelector(".asset-track-inline-confirmation")?.remove();
    const confirmation = this.contentEl.createDiv({ cls: "asset-track-inline-confirmation" });
    const transactionCount = this.options.category.transaction_count ?? 0;
    const ruleCount = this.options.category.rule_count ?? 0;
    confirmation.createEl("p", { text: transactionCount || ruleCount
      ? t("此分类仍被历史流水或规则引用。请先处理关联后再移除。",
        "This category is still used by historical transactions or rules. Resolve those references before removing it.")
      : t(`确认移除分类“${this.draft.name || this.draft.category_key}”？保存分类后生效。`,
        `Remove category “${this.draft.name || this.draft.category_key}”? It will take effect after saving categories.`) });
    if (ruleCount) {
      const rules = confirmation.createEl("button", { text: t("查看规则", "View rules") });
      rules.type = "button";
      rules.addEventListener("click", this.options.onOpenRules);
    }
    if (!transactionCount && !ruleCount) {
      const confirm = confirmation.createEl("button", { text: t("确认移除", "Confirm removal"), cls: "mod-warning" });
      confirm.type = "button";
      confirm.addEventListener("click", () => { this.options.onRemove(); this.close(); });
    }
    const cancel = confirmation.createEl("button", { text: t("取消", "Cancel") });
    cancel.type = "button";
    cancel.addEventListener("click", () => confirmation.remove());
  }

  private renderHistory(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    this.renderTabs("history");
    const hostWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!hostWindow) return;
    const host = this.contentEl.createDiv();
    this.root = createRoot(host);
    this.root.render(createElement(HistoryBackfillContent, {
      api: this.options.api,
      categories: this.options.categories,
      mode: "category",
      embedded: true,
      initialQuery: { category_key: this.options.category.category_key },
      hostWindow,
      confirmAction: async () => true,
      onSaved: () => {
        this.options.onSavedHistory();
        hostWindow.setTimeout(() => this.close(), 0);
      },
      onDataChanged: this.options.onDataChanged
    }));
  }

  onClose(): void {
    this.closed = true;
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
