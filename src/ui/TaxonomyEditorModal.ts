import { Modal, type App } from "obsidian";
import type { AttributeGroup, AttributeOption, TagDefinition } from "../types/configuration";
import { t } from "../i18n";

interface TaxonomyRemovalDecision {
  action: "clear" | "transfer";
  target_key?: string;
}

type TaxonomyTransferKind = "attribute" | "tag";

export type StagedTaxonomyRemoval = {
  kind: "group" | "option" | "tag";
  key: string;
  decision: TaxonomyRemovalDecision;
};

type EditorBase = {
  app: App;
  groups: AttributeGroup[];
  options: AttributeOption[];
  tags: TagDefinition[];
};

type EditorOptions = EditorBase & ({
  kind: "group";
  group: AttributeGroup;
  onApply: (group: AttributeGroup | null, values: AttributeOption[], removals: StagedTaxonomyRemoval[]) => void;
} | {
  kind: "option";
  option: AttributeOption;
  onApply: (option: AttributeOption | null, removals: StagedTaxonomyRemoval[]) => void;
} | {
  kind: "tag";
  tag: TagDefinition;
  onApply: (tag: TagDefinition | null, removals: StagedTaxonomyRemoval[]) => void;
});

/** Compact editor for a value chip and destructive taxonomy confirmation. */
export class TaxonomyEditorModal extends Modal {
  private optionDraft: AttributeOption | null = null;

  constructor(private readonly editor: EditorOptions) {
    super(editor.app);
    if (editor.kind === "option") this.optionDraft = { ...editor.option };
  }

  onOpen(): void {
    this.modalEl.addClass("asset-track-native-modal", "asset-track-taxonomy-editor-modal");
    this.setTitle(this.editor.kind === "option"
      ? t("编辑属性值", "Edit attribute value")
      : this.editor.kind === "group"
        ? t("移除属性名称", "Remove attribute name")
        : t("移除标签", "Remove tag"));
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    if (this.editor.kind === "option") this.renderOption();
    else if (this.editor.kind === "group") this.renderGroupRemoval();
    else this.renderTagRemoval();
  }

  private renderOption(): void {
    const editor = this.editor;
    const option = this.optionDraft;
    if (!option || editor.kind !== "option") return;
    const section = this.contentEl.createDiv({ cls: "asset-track-taxonomy-editor-section" });
    section.createEl("p", { text: t(
      "修改属性值名称，或移除这个属性值。已有分类引用可以清理或转移。",
      "Rename or remove this attribute value. Existing category references can be cleared or transferred."
    ) });
    const label = section.createEl("label", { text: t("属性值", "Attribute value") });
    const input = label.createEl("input", { type: "text" });
    input.value = option.name;
    input.setAttribute("aria-label", t("属性值", "Attribute value"));
    input.addEventListener("input", () => { option.name = input.value; });
    const actions = this.contentEl.createDiv({ cls: "asset-track-rule-create-actions" });
    const apply = actions.createEl("button", { text: t("应用", "Apply"), cls: "mod-cta" });
    apply.type = "button";
    apply.addEventListener("click", () => {
      editor.onApply({ ...option, name: option.name.trim() }, []);
      this.close();
    });
    const remove = actions.createEl("button", { text: t("移除", "Remove"), cls: "mod-warning" });
    remove.type = "button";
    remove.addEventListener("click", () => this.confirmRemoval(
      option.attribute_key,
      option.name,
      option.category_count ?? 0,
      "attribute",
      editor.options
        .filter((candidate) => candidate.group_key === option.group_key
          && candidate.attribute_key !== option.attribute_key && candidate.is_active)
        .map((candidate) => ({ key: candidate.attribute_key, name: candidate.name })),
      (decision) => {
        editor.onApply(null, [{ kind: "option", key: option.attribute_key, decision }]);
        this.close();
      }
    ));
    const cancel = actions.createEl("button", { text: t("取消", "Cancel") });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close());
    input.focus();
  }

  private renderGroupRemoval(): void {
    const editor = this.editor;
    if (editor.kind !== "group") return;
    const section = this.contentEl.createDiv({ cls: "asset-track-taxonomy-editor-section" });
    section.createEl("p", { text: t(
      `移除属性名称“${editor.group.name || editor.group.group_key}”。已有分类中的属性将需要清理或转移到其他属性值。`,
      `Remove “${editor.group.name || editor.group.group_key}”. Existing category attributes must be cleared or transferred to another value.`
    ) });
    const actions = this.contentEl.createDiv({ cls: "asset-track-rule-create-actions" });
    const remove = actions.createEl("button", { text: t("移除", "Remove"), cls: "mod-warning" });
    remove.type = "button";
    remove.addEventListener("click", () => this.confirmRemoval(
      editor.group.group_key,
      editor.group.name,
      editor.group.usage_count ?? 0,
      "attribute",
      editor.options
        .filter((candidate) => candidate.group_key !== editor.group.group_key && candidate.is_active)
        .map((candidate) => ({
          key: candidate.attribute_key,
          name: `${editor.groups.find((group) => group.group_key === candidate.group_key)?.name ?? ""} · ${candidate.name}`
        })),
      (decision) => {
        editor.onApply(null, [], [{ kind: "group", key: editor.group.group_key, decision }]);
        this.close();
      }
    ));
    const cancel = actions.createEl("button", { text: t("取消", "Cancel") });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close());
  }

  private renderTagRemoval(): void {
    const editor = this.editor;
    if (editor.kind !== "tag") return;
    const section = this.contentEl.createDiv({ cls: "asset-track-taxonomy-editor-section" });
    section.createEl("p", { text: t(
      `移除标签“${editor.tag.name || editor.tag.tag_key}”。已有流水中的标签可以清理或转移到其他标签。`,
      `Remove “${editor.tag.name || editor.tag.tag_key}”. Existing transaction tags can be cleared or transferred to another tag.`
    ) });
    const actions = this.contentEl.createDiv({ cls: "asset-track-rule-create-actions" });
    const remove = actions.createEl("button", { text: t("移除", "Remove"), cls: "mod-warning" });
    remove.type = "button";
    remove.addEventListener("click", () => this.confirmRemoval(
      editor.tag.tag_key,
      editor.tag.name,
      editor.tag.transaction_count ?? 0,
      "tag",
      editor.tags
        .filter((candidate) => candidate.tag_key !== editor.tag.tag_key && candidate.is_active)
        .map((candidate) => ({ key: candidate.tag_key, name: candidate.name })),
      (decision) => {
        editor.onApply(null, [{ kind: "tag", key: editor.tag.tag_key, decision }]);
        this.close();
      }
    ));
    const cancel = actions.createEl("button", { text: t("取消", "Cancel") });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close());
  }

  private confirmRemoval(
    key: string,
    name: string,
    count: number,
    transferKind: TaxonomyTransferKind,
    targets: Array<{ key: string; name: string }>,
    onConfirm: (decision: TaxonomyRemovalDecision) => void
  ): void {
    this.contentEl.querySelector(".asset-track-inline-confirmation")?.remove();
    const box = this.contentEl.createDiv({ cls: "asset-track-inline-confirmation" });
    box.createEl("p", { text: t(
      transferKind === "attribute"
        ? `确认移除“${name || key}”？已有分类属性将按下方选择处理，保存后生效。`
        : `确认移除“${name || key}”？已有流水标签将按下方选择处理，保存后生效。`,
      transferKind === "attribute"
        ? `Remove “${name || key}”? Existing category attributes will be handled using the choice below. Changes take effect after saving.`
        : `Remove “${name || key}”? Existing transaction tags will be handled using the choice below. Changes take effect after saving.`
    ) });
    if (count && targets.length) {
      const label = box.createEl("label", { text: transferKind === "attribute"
        ? t("原有属性转移到", "Transfer existing attributes to")
        : t("原有标签转移到", "Transfer existing tags to") });
      const select = label.createEl("select");
      targets.forEach((target) => select.createEl("option", { value: target.key, text: target.name || target.key }));
      const transfer = box.createEl("button", { text: t("确认转移并移除", "Transfer and remove"), cls: "mod-warning" });
      transfer.type = "button";
      transfer.addEventListener("click", () => onConfirm({ action: "transfer", target_key: select.value }));
    }
    const clear = box.createEl("button", { text: count ? t("确认清理并移除", "Clear and remove") : t("确认移除", "Confirm removal"), cls: "mod-warning" });
    clear.type = "button";
    clear.addEventListener("click", () => onConfirm({ action: "clear" }));
    const cancel = box.createEl("button", { text: t("取消", "Cancel") });
    cancel.type = "button";
    cancel.addEventListener("click", () => box.remove());
  }

  onClose(): void { this.contentEl.empty(); }
}
