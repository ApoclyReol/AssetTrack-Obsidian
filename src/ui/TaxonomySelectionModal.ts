import { Modal, type App } from "obsidian";
import type { AttributeGroup, AttributeOption, TagDefinition } from "../types/configuration";
import { displayError, t } from "../i18n";

type Selection = {
  app: App;
  title: string;
  selected: string[];
  onApply: (keys: string[]) => void;
} & ({ kind: "attributes"; groups: AttributeGroup[]; options: AttributeOption[] }
  | { kind: "tags"; tags: TagDefinition[] });

export class TaxonomySelectionModal extends Modal {
  constructor(private readonly config: Selection) {
    super(config.app);
  }

  onOpen(): void {
    const selection = this.config;
    this.modalEl.addClass("asset-track-native-modal", "asset-track-taxonomy-selection-modal");
    const title = typeof selection.title === "string" ? selection.title.trim() : "";
    this.setTitle(title || t("编辑属性和标签", "Edit attributes and tags"));
    this.contentEl.empty();
    const status = this.contentEl.createEl("p", { text: t("正在载入可选项…", "Loading choices…") });
    try {
    const controls = this.contentEl.createDiv({ cls: "asset-track-taxonomy-selection-list" });
    const selected = new Set(Array.isArray(selection.selected) ? selection.selected : []);
    if (selection.kind === "attributes") {
      const groups = Array.isArray(selection.groups) ? selection.groups : [];
      const options = Array.isArray(selection.options) ? selection.options : [];
      groups.filter((group) => group.is_active || options.some((option) =>
        option.group_key === group.group_key && selected.has(option.attribute_key))).forEach((group) => {
        const fieldset = controls.createEl("fieldset");
        const groupLabel = typeof group.name === "string" ? group.name.trim() : "";
        fieldset.createEl("legend", { text: groupLabel || t("未命名属性名称", "Unnamed attribute name") });
        const choices = options.filter((option) =>
          option.group_key === group.group_key && (option.is_active || selected.has(option.attribute_key)));
        const groupName = `attribute-${group.group_key}`;
        const addChoice = (key: string, label: string): void => {
          const wrapper = fieldset.createEl("label");
          const input = wrapper.createEl("input", { type: "radio" });
          input.name = groupName;
          input.value = key;
          input.checked = key ? selected.has(key) : !choices.some((option) => selected.has(option.attribute_key));
          wrapper.createSpan({ text: label?.trim() || t("未命名", "Unnamed") });
        };
        addChoice("", t("未设置", "None"));
        choices.forEach((option) => addChoice(
          option.attribute_key,
          typeof option.name === "string" ? option.name : t("未命名", "Unnamed")
        ));
      });
      if (!groups.some((group) => group.is_active || options.some((option) =>
        option.group_key === group.group_key && selected.has(option.attribute_key)))) {
        controls.createEl("p", {
          cls: "asset-track-taxonomy-selection-empty",
          text: t("暂无可编辑的分类属性。", "No editable category attributes are available.")
        });
      }
    } else {
      const tags = Array.isArray(selection.tags) ? selection.tags : [];
      const editableTags = tags.filter((tag) => tag.is_active || selected.has(tag.tag_key));
      // A month draft may be restored from an older runtime where the
      // optional activity flag was not normalized to a boolean.  The tag
      // definitions are still valid choices, so do not turn a non-empty
      // definition list into an empty editor just because that flag is
      // temporarily missing or encoded differently.
      const visibleTags = editableTags.length > 0 ? editableTags : tags;
      visibleTags.forEach((tag) => {
        const wrapper = controls.createEl("label");
        const input = wrapper.createEl("input", { type: "checkbox" });
        input.value = tag.tag_key;
        input.checked = selected.has(tag.tag_key);
        const tagName = typeof tag.name === "string" ? tag.name.trim() : "";
        wrapper.createSpan({ text: tagName || tag.tag_key || t("未命名标签", "Unnamed tag") });
      });
      if (visibleTags.length === 0) {
        controls.createEl("p", {
          cls: "asset-track-taxonomy-selection-empty",
          text: t("暂无可编辑的流水标签。", "No editable transaction tags are available.")
        });
      }
    }
    const actions = this.contentEl.createDiv({ cls: "asset-track-rule-create-actions" });
    const apply = actions.createEl("button", { text: t("应用到草稿", "Apply to draft"), cls: "mod-cta" });
    apply.type = "button";
    apply.addEventListener("click", () => {
      const inputs = Array.from(controls.querySelectorAll<HTMLInputElement>("input:checked"));
      this.config.onApply(inputs.map((input) => input.value).filter(Boolean));
      this.close();
    });
    const cancel = actions.createEl("button", { text: t("取消", "Cancel") });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close());
    status.remove();
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.createEl("p", {
        cls: "asset-track-taxonomy-selection-empty",
        text: t(`无法载入选项：${displayError(error)}`, `Unable to load choices: ${displayError(error)}`)
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
