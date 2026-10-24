// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuleRewriteContent } from "../../src/ui/RuleRewriteEditor";
import { setTestLanguage } from "../mocks/obsidian";

afterEach(() => { cleanup(); setTestLanguage("zh-CN"); });
describe("rewrite settings dialog", () => {
  it("defaults to preserving blanks, then applies all three settings together", () => {
    const confirm = vi.fn();
    render(<RuleRewriteContent value={{ rewrite_product: "旧名称" }} onConfirm={confirm} onClose={vi.fn()} />);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "重写内容留空时" }).value).toBe("preserve");
    fireEvent.change(screen.getByRole("textbox", { name: "重写商品" }), { target: { value: "会员" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "clear" } });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用到规则草稿" }));
    expect(confirm).toHaveBeenCalledWith({ rewrite_merchant: "", rewrite_product: "会员", rewrite_empty_mode: "clear" });
  });
  it("does not change the rule when cancelling edits and localizes all controls", () => {
    setTestLanguage("en");
    const value = { rewrite_merchant: "平台", rewrite_empty_mode: "clear" as const };
    const confirm = vi.fn(); const close = vi.fn();
    render(<RuleRewriteContent value={value} onConfirm={confirm} onClose={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Rewrite counterparty" }), { target: { value: "新平台" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(value.rewrite_merchant).toBe("平台");
  });
});
