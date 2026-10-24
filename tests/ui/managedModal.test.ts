// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

vi.mock("obsidian", () => {
  const element = (tag = "div"): HTMLElement => {
    const range = document.createRange();
    const fragment = tag === "button" ? range.createContextualFragment("<button></button>")
      : tag === "h3" ? range.createContextualFragment("<h3></h3>") : range.createContextualFragment("<div></div>");
    const el = fragment.firstElementChild as HTMLElement;
    Object.assign(el, {
      addClass: (...names: string[]) => el.classList.add(...names),
      createDiv: (options: { cls?: string } = {}) => { const child = element(); child.className = options.cls ?? ""; el.append(child); return child; },
      createEl: (name: string, options: { cls?: string; text?: string } = {}) => { const child = element(name); child.className = options.cls ?? ""; child.textContent = options.text ?? ""; el.append(child); return child; }
    });
    return el;
  };
  class Modal {
    containerEl!: HTMLElement; modalEl!: HTMLElement; contentEl!: HTMLElement;
    constructor(_app: unknown) {}
    onOpen(): void {}
    onClose(): void {}
    open(): void {
      this.containerEl = element(); this.modalEl = element(); this.contentEl = element();
      this.containerEl.append(document.createRange().createContextualFragment('<div class="modal-bg"></div>'));
      const close = element("button"); close.className = "modal-close-button"; close.textContent = "×";
      close.addEventListener("click", () => this.close());
      this.modalEl.append(close, this.contentEl); this.containerEl.append(this.modalEl); document.body.append(this.containerEl);
      this.onOpen();
    }
    close(): void { this.onClose(); this.containerEl.remove(); }
  }
  class Component {
    private cleanups: Array<() => void> = [];
    load(): void {}
    unload(): void { this.cleanups.forEach(cleanup => cleanup()); this.cleanups = []; }
    registerDomEvent(target: HTMLElement, type: string, callback: EventListener, options?: boolean): void {
      target.addEventListener(type, callback, options);
      this.cleanups.push(() => target.removeEventListener(type, callback, options));
    }
  }
  return { Modal, Component, getLanguage: () => "zh-CN" };
});

import { ManagedModal } from "../../src/ui/ManagedModal";
class Editor extends ManagedModal {
  onOpen(): void { this.installInteraction(); this.contentEl.append(document.createRange().createContextualFragment('<input value="原值"><button>取消修改</button>')); }
  onClose(): void { super.onClose(); }
  finish(): void { this.completeClose(); }
}
function open() { const modal = new Editor({} as App); modal.open(); return modal; }
function edit(modal: Editor) { const input = modal.contentEl.querySelector("input")!; input.value = "修改"; input.dispatchEvent(new Event("input", { bubbles: true })); }
const click = (modal: Editor, selector: string) => modal.containerEl.querySelector<HTMLElement>(selector)!.click();
afterEach(() => { document.body.replaceChildren(); });
describe("native modal mouse-close policy", () => {
  it("keeps edited input until an explicit discard and supports continuing", () => {
    const modal = open(); edit(modal); click(modal, ".modal-close-button");
    expect(modal.modalEl.querySelector('[role="alertdialog"]')).not.toBeNull();
    click(modal, ".asset-track-close-guard-card button:first-child");
    expect(modal.contentEl.querySelector("input")!.value).toBe("修改");
    expect(modal.modalEl.querySelector('[role="alertdialog"]')).toBeNull();
    click(modal, ".modal-close-button"); click(modal, ".asset-track-close-guard-card button:last-child");
    expect(document.body.contains(modal.containerEl)).toBe(false);
  });
  it("blocks backdrop dismissal after an edit and allows closing untouched forms", () => {
    const modal = open(); edit(modal); click(modal, ".modal-bg");
    expect(document.body.contains(modal.containerEl)).toBe(true);
    modal.finish();
    const untouched = open(); click(untouched, ".modal-close-button");
    expect(document.body.contains(untouched.containerEl)).toBe(false);
  });
  it("does not mistake deselection controls for cancellation", () => {
    const modal = open(); edit(modal);
    const deselect = document.createRange().createContextualFragment('<button>取消全选流水</button>').firstElementChild as HTMLButtonElement;
    const action = vi.fn(); deselect.addEventListener("click", action);
    modal.contentEl.append(deselect); deselect.click();
    expect(action).toHaveBeenCalledOnce();
    expect(document.body.contains(modal.containerEl)).toBe(true);
    expect(modal.modalEl.querySelector('[role="alertdialog"]')).toBeNull();
    modal.finish();
  });
  it("guards host close calls independently of DOM event routing", () => {
    const modal = open(); edit(modal); modal.close();
    expect(document.body.contains(modal.containerEl)).toBe(true);
    expect(modal.modalEl.querySelector('[role="alertdialog"]')).not.toBeNull();
    modal.finish();
    expect(document.body.contains(modal.containerEl)).toBe(false);
  });
  it("locks native close and cancellation while submitting", () => {
    const modal = open(); modal.contentEl.setAttribute("data-asset-track-busy", "true");
    // Real busy flags live on a content child, as React roots do.
    modal.contentEl.querySelector("input")!.setAttribute("data-asset-track-busy", "true");
    click(modal, ".modal-close-button"); click(modal, ".modal-bg");
    expect(document.body.contains(modal.containerEl)).toBe(true);
    expect(modal.modalEl.querySelector('[role="alertdialog"]')).toBeNull();
    modal.finish();
  });
});
