import type { App } from "obsidian";
import type { MonthCreationPolicy } from "../types/configuration";
import { t } from "../i18n";
import { isMonth } from "../domain/dates";
import { ManagedModal } from "./ManagedModal";

export class MonthCreationModal extends ManagedModal {
  constructor(app: App, private readonly policy: MonthCreationPolicy,
    private readonly onChoose: (month: string | null) => void) { super(app); }

  onOpen(): void {
    this.installInteraction();
    this.setTitle(t("创建月份", "Create month"));
    this.modalEl.addClass("asset-track-native-modal", "asset-track-month-create-modal");
    const label = this.contentEl.createEl("label", { text: t("月份", "Month") });
    const input = label.createEl("input", { type: "month", value: this.policy.next_target });
    input.max = this.policy.max_creatable_month;
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    error.hidden = true;
    const actions = this.contentEl.createDiv({ cls: "asset-track-rule-create-actions" });
    const cancel = actions.createEl("button", { text: t("取消", "Cancel") });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: t("创建月份", "Create month"), cls: "mod-cta" });
    confirm.addEventListener("click", () => {
      const month = input.value;
      if (!isMonth(month) || month > this.policy.max_creatable_month || this.policy.months.includes(month)) {
        error.hidden = false;
        error.setText(this.policy.months.includes(month)
          ? t("该月份已存在，请选择其他月份。", "This month already exists. Choose another month.")
          : t("请选择允许范围内的有效月份。", "Choose a valid month within the allowed range."));
        return;
      }
      this.onChoose(month);
      this.completeClose();
    });
  }

  requestClose(): void { this.completeClose(); }

  onClose(): void { super.onClose(); this.contentEl.empty(); this.onChoose(null); }
}
