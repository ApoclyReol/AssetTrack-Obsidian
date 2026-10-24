// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuleAmountConditionInput } from "../../src/ui/RuleAmountConditionInput";
import { RuleCreationContent } from "../../src/ui/RuleCreationModal";
import { EMPTY_RULE_AMOUNT, ruleAmountBounds } from "../../src/domain/ruleAmounts";
import type { RuleAmountFields, SavedRule } from "../../src/types/rules";
import type { CategoryDefinition } from "../../src/types/configuration";
import { setTestLanguage } from "../mocks/obsidian";

const category: CategoryDefinition = { category_key: "subscription", name: "订阅服务", transaction_type: "支出", is_active: true,
  sort_order: 0, necessity: "必要", pattern: "周期", is_big_ticket: false, color: "#123456" };
const initial: SavedRule = { ...EMPTY_RULE_AMOUNT, transaction_type: "支出", match_scope: "merchant", counterparty: "平台", product: "",
  category_key: category.category_key, category: category.name };
afterEach(() => { cleanup(); setTestLanguage("zh-CN"); });

function ControlledAmount({ initialValue = EMPTY_RULE_AMOUNT }: { initialValue?: RuleAmountFields }) {
  const [value, setValue] = useState(initialValue);
  return <><RuleAmountConditionInput value={value} onChange={setValue} label="金额条件" />
    <button disabled={!ruleAmountBounds(value)}>保存</button></>;
}
function mode(value: string) { fireEvent.change(screen.getByRole("combobox", { name: "金额条件方式" }), { target: { value } }); }
function enter(label: string, value: string) { fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } }); }

describe("range amount editing", () => {
  it("saves explicit bounds and endpoint inclusion from the creation dialog", async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(<RuleCreationContent initial={initial} categories={[category]} onConfirm={confirm} onClose={vi.fn()} />);
    mode("between"); enter("金额条件下限", "2"); enter("金额条件上限", "50");
    fireEvent.click(screen.getByRole("checkbox", { name: "包含下限" }));
    expect(screen.getByRole("status").textContent).toBe("(2.00, 50.00]");
    fireEvent.click(screen.getByRole("button", { name: "确认保存规则" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      match_amount_minor: null, match_amount_min_minor: 200, match_amount_max_minor: 5000,
      match_amount_min_exclusive: true, match_amount_max_exclusive: false
    })));
  });

  it("keeps invalid decimal text editable and blocks reversed or empty intervals", async () => {
    const user = userEvent.setup();
    render(<ControlledAmount />);
    mode("between"); enter("金额条件下限", "2"); enter("金额条件上限", "2");
    fireEvent.click(screen.getByRole("checkbox", { name: "包含上限" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "保存" }).disabled).toBe(true);
    enter("金额条件上限", "1");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "保存" }).disabled).toBe(true);
    const upper = screen.getByRole<HTMLInputElement>("textbox", { name: "金额条件上限" });
    await user.clear(upper); await user.type(upper, "50.001");
    expect(upper.value).toBe("50.001"); expect(upper.getAttribute("aria-invalid")).toBe("true");
    await user.keyboard("{Backspace}");
    expect(upper.value).toBe("50.00"); expect(screen.getByRole<HTMLButtonElement>("button", { name: "保存" }).disabled).toBe(false);
  });

  it("clears old bounds on mode changes and renders a persisted condition", () => {
    render(<ControlledAmount initialValue={{ ...EMPTY_RULE_AMOUNT, match_amount_min_minor: 200, match_amount_max_minor: 5000,
      match_amount_min_exclusive: true }} />);
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("between");
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "包含下限" }).checked).toBe(false);
    mode("lt"); expect(screen.queryByRole("textbox", { name: "金额条件下限" })).toBeNull();
    enter("金额条件", "2"); expect(screen.getByRole("status").textContent).toBe("< 2.00");
    mode("gte"); expect(screen.getByRole("status").textContent).toBe("≥ 2.00");
    mode("any"); expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.getByRole("status").textContent).toBe("不限金额");
  });

  it("uses the current exact price as a deliberate replacement for a range", async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(<RuleCreationContent initial={{ ...initial, match_amount_min_minor: 200, match_amount_max_minor: 5000 }}
      suggestedAmount={1990} categories={[category]} onConfirm={confirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "使用当前单笔金额 19.90" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "金额条件方式" }).value).toBe("eq");
    fireEvent.click(screen.getByRole("button", { name: "确认保存规则" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      match_amount_minor: 1990, match_amount_min_minor: null, match_amount_max_minor: null,
      match_amount_min_exclusive: false, match_amount_max_exclusive: false
    })));
  });

  it("localizes the range editor and validation in English", () => {
    setTestLanguage("en");
    render(<RuleCreationContent initial={initial} categories={[category]} onConfirm={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Amount condition mode" }), { target: { value: "between" } });
    expect(screen.getByRole("textbox", { name: "Amount condition lower bound" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Include upper bound" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("reversed or empty intervals");
  });
});
