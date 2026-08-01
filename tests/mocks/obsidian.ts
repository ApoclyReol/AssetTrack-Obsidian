let language = "zh-CN";

export function getLanguage(): string {
  return language;
}

export function setTestLanguage(value: string): void {
  language = value;
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
