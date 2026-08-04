import {
  App,
  Modal,
  Setting
} from "obsidian";
import { t } from "../i18n";

export interface ChoiceAction<T extends string = string> {
  value: T;
  text: string;
  className?: string;
  cta?: boolean;
}

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
    this.modalEl.addClass("asset-track-confirmation-modal");
    this.setTitle(this.title);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("取消", "Cancel")).onClick(() => this.finish(false))
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

class InformationModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly actions: Array<{ text: string; onClick?: () => void }>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("asset-track-confirmation-modal");
    this.setTitle(this.title);
    this.contentEl.createEl("p", { text: this.message });
    const setting = new Setting(this.contentEl);
    this.actions.forEach((action, index) => {
      setting.addButton((button) => {
        if (index === 0) button.setCta();
        button
          .setButtonText(action.text)
          .onClick(() => {
            if (this.settled) return;
            this.settled = true;
            this.close();
            action.onClick?.();
          });
        if (index === 0) button.buttonEl.focus();
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ChoiceModal<T extends string> extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly actions: Array<ChoiceAction<T>>,
    private readonly resolveResult: (choice: T | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("asset-track-confirmation-modal");
    this.setTitle(this.title);
    this.contentEl.createEl("p", { text: this.message });
    const setting = new Setting(this.contentEl);
    this.actions.forEach((action, index) => {
      setting.addButton((button) => {
        if (action.className) button.buttonEl.addClass(action.className);
        if (action.cta) button.setCta();
        button.setButtonText(action.text).onClick(() => this.finish(action.value));
        if (index === 0) button.buttonEl.focus();
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.resolveResult(null);
  }

  private finish(choice: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveResult(choice);
    this.close();
  }
}

export function confirmAction(
  app: App,
  title: string,
  message: string,
  confirmText = t("继续", "Continue")
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

export function chooseAction<T extends string>(
  app: App,
  title: string,
  message: string,
  actions: Array<ChoiceAction<T>>
): Promise<T | null> {
  return new Promise((resolve) => {
    new ChoiceModal(app, title, message, actions, resolve).open();
  });
}

export function alertAction(
  app: App,
  title: string,
  message: string,
  actions: Array<{ text: string; onClick?: () => void }>
): void {
  new InformationModal(app, title, message, actions).open();
}
