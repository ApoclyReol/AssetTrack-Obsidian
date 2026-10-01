// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { ConfigurationEditorPort } from "../../src/services/ports";
import type { CategoryDefinition } from "../../src/types/configuration";
import { CategoryEditorModal } from "../../src/ui/CategoryEditorModal";
import { TaxonomySelectionModal } from "../../src/ui/TaxonomySelectionModal";

const original = new Map<string, PropertyDescriptor | undefined>();

function appendFixtureElement(parent: HTMLElement, tag: string,
  options?: { text?: string; cls?: string; type?: string }): HTMLElement {
  const child = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
  if (options?.text) child.textContent = options.text;
  if (options?.cls) child.className = options.cls;
  if (options?.type) child.setAttribute("type", options.type);
  parent.appendChild(child);
  return child;
}

function fixtureDiv(): HTMLDivElement {
  return document.createRange().createContextualFragment("<div></div>").firstElementChild as HTMLDivElement;
}

beforeAll(() => {
  const prototype = HTMLElement.prototype;
  for (const name of ["createEl", "createDiv", "createSpan", "empty", "addClass"]) {
    original.set(name, Object.getOwnPropertyDescriptor(prototype, name));
  }
  Object.defineProperty(prototype, "createEl", { configurable: true, value: function (
    this: HTMLElement, tag: string, options?: { text?: string; cls?: string; type?: string }
  ) {
    return appendFixtureElement(this, tag, options);
  } });
  Object.defineProperty(prototype, "createDiv", { configurable: true, value: function (
    this: HTMLElement, options?: { cls?: string }
  ) { return appendFixtureElement(this, "div", options); } });
  Object.defineProperty(prototype, "createSpan", { configurable: true, value: function (
    this: HTMLElement, options?: { text?: string }
  ) { return appendFixtureElement(this, "span", options); } });
  Object.defineProperty(prototype, "empty", { configurable: true, value: function (this: HTMLElement) {
    this.replaceChildren();
  } });
  Object.defineProperty(prototype, "addClass", { configurable: true, value: function (
    this: HTMLElement, name: string
  ) { this.classList.add(name); } });
});

afterAll(() => {
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

describe("taxonomy selection window", () => {
  it("loads saved category attributes when the editor opens", async () => {
    const category: CategoryDefinition = { category_key: "food", name: "餐饮", description: "", transaction_type: "支出",
      necessity: "不适用", pattern: "不适用", is_big_ticket: false, color: "#123456",
      is_active: true, sort_order: 0, attribute_keys: ["necessary"] };
    const api = { taxonomy: async () => ({ attribute_revision: 1, tag_revision: 1,
      groups: [{ group_key: "necessity", name: "必要性", selection_mode: "single", is_active: true, sort_order: 0 }],
      options: [{ attribute_key: "necessary", group_key: "necessity", name: "必要", is_active: true, sort_order: 0 }],
      tags: [] }) } as unknown as ConfigurationEditorPort;
    const modal = new CategoryEditorModal({ app: {} as App, api, category, categories: [category],
      groups: [], options: [], onApply: vi.fn(), onRemove: vi.fn(), onSavedHistory: vi.fn(),
      onDataChanged: vi.fn(), onOpenRules: vi.fn() });
    const contentEl = fixtureDiv();
    Object.assign(modal, { contentEl, modalEl: fixtureDiv() });
    modal.onOpen();
    await vi.waitFor(() => expect(contentEl.textContent).toContain("必要性"));
    expect(Array.from(contentEl.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find((input) => input.value === "necessary")?.checked).toBe(true);
  });

  it("loads existing tags and applies the checked set", () => {
    const onApply = vi.fn();
    const modal = new TaxonomySelectionModal({
      app: {} as App, kind: "tags", title: "编辑标签", selected: ["travel"],
      tags: [
        { tag_key: "travel", name: "旅行", color: "#123456", is_active: true, sort_order: 0 },
        { tag_key: "work", name: "工作", color: "#654321", is_active: true, sort_order: 1 }
      ], onApply
    });
    const contentEl = fixtureDiv();
    Object.assign(modal, { contentEl, modalEl: fixtureDiv() });
    modal.onOpen();
    expect(contentEl.textContent).toContain("旅行");
    expect(contentEl.querySelector<HTMLInputElement>('input[value="travel"]')?.checked).toBe(true);
    const work = contentEl.querySelector<HTMLInputElement>('input[value="work"]');
    if (!work) throw new Error("work tag did not render");
    work.checked = true;
    Array.from(contentEl.querySelectorAll("button")).find((button) => button.textContent === "应用到草稿")?.click();
    expect(onApply).toHaveBeenCalledWith(["travel", "work"]);
  });
});
