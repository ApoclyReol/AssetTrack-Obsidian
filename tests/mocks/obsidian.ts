import { vi } from "vitest";

let language = "zh-CN";

export function getLanguage(): string {
  return language;
}

export function setTestLanguage(value: string): void {
  language = value;
}

export const requestUrl = vi.fn();

export class App {}

export class Plugin {
  app: unknown = {};
  manifest = { version: "0.0.0" };

  async loadData(): Promise<unknown> { return null; }

  async saveData(_data: unknown): Promise<void> {}

  registerView(): void {}

  addSettingTab(): void {}

  addRibbonIcon(): void {}

  addCommand(): void {}
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: HTMLDivElement;

  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createRange().createContextualFragment(
      "<div></div>",
    ).firstElementChild as HTMLDivElement;
  }

  display(): void {}
}

export class Setting {
  constructor(_containerEl?: HTMLElement) {}

  setName(): this { return this; }

  setDesc(): this { return this; }

  addText(): this { return this; }

  addTextArea(): this { return this; }

  addDropdown(): this { return this; }

  addButton(): this { return this; }
}

export class SettingPage {}

export class FileSystemAdapter {
  getFullPath(path: string): string { return path; }

  getBasePath(): string { return ""; }
}

export class Modal {
  constructor(_app?: unknown) {}

  open(): void {}

  close(): void {}

  setTitle(_title: string): void {}
}

export class Notice {
  constructor(_message: string) {}
}

export class WorkspaceLeaf {
  app: unknown;

  constructor(app: unknown = {}) {
    this.app = app;
  }
}

export class ItemView {
  app: unknown;
  leaf: WorkspaceLeaf;
  containerEl: HTMLDivElement;
  contentEl: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    const fragment = document.createRange().createContextualFragment(
      "<div><div></div></div>",
    );
    this.containerEl = fragment.firstElementChild as HTMLDivElement;
    this.contentEl = this.containerEl.firstElementChild as HTMLDivElement;
  }

  async setState(_state: unknown, _result: unknown): Promise<void> {}

  setEphemeralState(_state: unknown): void {}

  registerDomEvent(): void {}
}
