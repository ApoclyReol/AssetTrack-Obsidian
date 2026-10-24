import { Component, Modal } from "obsidian";
import { t } from "../i18n";

/** Guard every host close; completed actions use the explicit completion path. */
export class ManagedModal extends Modal {
  private interaction: Component | null = null;
  private edited = false;
  private closePrompt: HTMLElement | null = null;

  open(): void {
    super.open();
    this.installInteraction();
  }

  protected installInteraction(): void {
    const container = this.containerEl ?? this.modalEl?.parentElement;
    if (this.interaction || !container || !this.contentEl) return;
    this.modalEl.addClass("asset-track-native-modal");
    this.interaction = new Component();
    this.interaction.load();
    const changed = () => { this.edited = true; };
    this.interaction.registerDomEvent(this.contentEl, "input", changed, true);
    this.interaction.registerDomEvent(this.contentEl, "change", changed, true);
    const guard = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest || this.closePrompt?.contains(target)) return;
      const backdrop = target.closest(".modal-bg");
      const close = target.closest(".modal-close-button");
      const button = target.closest("button");
      const cancel = button && /^(取消(?:修改|删除|合并|添加|移除)?|关闭|稍后|Cancel(?: changes| deletion| merge| addition| removal)?|Close|Later)$/i.test(button.textContent?.trim() ?? "");
      if (!backdrop && !close && !cancel) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.isBusy() || (backdrop && this.edited)) return;
      this.requestClose();
    };
    this.interaction.registerDomEvent(container, "mousedown", guard, true);
    this.interaction.registerDomEvent(container, "click", guard, true);
    this.interaction.registerDomEvent(container, "keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!this.isBusy()) this.requestClose();
    }, true);
  }

  protected isBusy(): boolean {
    return this.contentEl.querySelector('[data-asset-track-busy="true"]') !== null;
  }

  protected markClean(): void { this.edited = false; }

  requestClose(): void {
    this.confirmTaskChange(() => this.completeClose());
  }

  confirmTaskChange(next: () => void): void {
    if (this.isBusy() || this.closePrompt) return;
    if (!this.edited) { next(); return; }
    const overlay = this.modalEl.createDiv({ cls: "asset-track-close-guard" });
    this.closePrompt = overlay;
    const box = overlay.createDiv({ cls: "asset-track-close-guard-card" });
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-label", t("放弃本次修改？", "Discard these changes?"));
    box.createEl("h3", { text: t("放弃本次修改？", "Discard these changes?") });
    const actions = box.createDiv({ cls: "asset-track-rule-create-actions" });
    const keep = actions.createEl("button", { text: t("继续编辑", "Keep editing") });
    const discard = actions.createEl("button", { text: t("放弃修改", "Discard changes"), cls: "mod-warning" });
    keep.addEventListener("click", () => { overlay.remove(); this.closePrompt = null; });
    discard.addEventListener("click", () => {
      this.edited = false; overlay.remove(); this.closePrompt = null; next();
    });
  }

  close(): void { this.requestClose(); }

  protected completeClose(): void {
    this.disposeInteraction();
    super.close();
  }

  onClose(): void { this.disposeInteraction(); }

  private disposeInteraction(): void {
    this.interaction?.unload(); this.interaction = null;
    this.closePrompt?.remove(); this.closePrompt = null;
  }
}
