import {
  App,
  Modal,
  Setting
} from "obsidian";

class ConfirmationModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmText: string,
    private readonly resolveResult: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("取消").onClick(() => this.finish(false))
      )
      .addButton((button) => {
        button.buttonEl.addClass("mod-warning");
        button
          .setCta()
          .setButtonText(this.confirmText)
          .onClick(() => this.finish(true));
        button.buttonEl.focus();
      });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.resolveResult(false);
  }

  private finish(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveResult(confirmed);
    this.close();
  }
}

export function confirmAction(
  app: App,
  title: string,
  message: string,
  confirmText = "继续"
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmationModal(
      app,
      title,
      message,
      confirmText,
      resolve
    ).open();
  });
}
