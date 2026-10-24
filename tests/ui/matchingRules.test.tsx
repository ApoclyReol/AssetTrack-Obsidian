// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { CategoryDefinition } from "../../src/types/configuration";
import type { SavedRule } from "../../src/types/rules";
import { MatchingRulesTable } from "../../src/ui/rules/MatchingRulesTable";

const categories: CategoryDefinition[] = [
  {
    category_key: "food",
    name: "餐饮",
    description: "",
    transaction_type: "支出",
    necessity: "必要",
    pattern: "日常",
    is_big_ticket: false,
    color: "#ffffff",
    is_active: true,
    sort_order: 0
  },
  {
    category_key: "transport",
    name: "交通",
    description: "",
    transaction_type: "支出",
    necessity: "可控",
    pattern: "日常",
    is_big_ticket: false,
    color: "#000000",
    is_active: true,
    sort_order: 1
  }
];

const rules: SavedRule[] = [
  {
    id: 1,
    transaction_type: "支出",
    match_scope: "product",
    counterparty: "商户甲",
    product: "咖啡",
    category_key: "food",
    category: "餐饮",
    occurrences: 3,
    last_month: "2026-06"
  },
  {
    id: 2,
    transaction_type: "收入",
    match_scope: "merchant",
    counterparty: "支付宝",
    product: "",
    category_key: "food",
    category: "餐饮",
    occurrences: 12,
    last_month: "2026-08"
  },
  {
    id: 3,
    transaction_type: "支出",
    match_scope: "merchant_product",
    counterparty: "商户乙",
    product: "公交",
    category_key: "transport",
    category: "交通",
    rule_status: "冲突",
    occurrences: 1,
    last_month: "2026-07"
  }
];

function renderTable(onSort = vi.fn(), onChange = vi.fn()) {
  return render(
    <MatchingRulesTable
      rules={rules}
      categories={categories}
      sort={null}
      onSort={onSort}
      onChange={onChange}
      onRemove={vi.fn()}
      showSectionActions
      dirty={false}
      pageState={{ kind: "idle" }}
      saveState={{ kind: "idle" }}
      onReload={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(undefined)}
      sectionRef={{ current: null }}
    />
  );
}

describe("matching rules table controls", () => {
  afterEach(cleanup);

  it("identifies both saved rules and highlights conflicts immediately after editing", () => {
    function EditableTable() {
      const [draft, setDraft] = useState<SavedRule[]>([13, 27].map((id, index) => ({ ...rules[0], id,
        counterparty: "", product: index === 0 ? "咖啡" : "茶" })));
      return <MatchingRulesTable rules={draft} categories={categories} sort={null} onSort={vi.fn()} onChange={setDraft}
        showSectionActions dirty pageState={{ kind: "idle" }} saveState={{ kind: "idle" }}
        onReload={vi.fn()} onSave={vi.fn()} sectionRef={{ current: null }} />;
    }
    const { container } = render(<EditableTable />);
    fireEvent.change(screen.getByRole("textbox", { name: "#27商品条件" }), { target: { value: "咖啡" } });
    expect(screen.getByRole("alert").textContent).toContain("#13");
    expect(screen.getByRole("alert").textContent).toContain("#27");
    expect(container.querySelectorAll(".asset-track-rule-conflict-row")).toHaveLength(2);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "保存规则" }).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "#27商品条件" }), { target: { value: "新茶" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "保存规则" }).disabled).toBe(false);
  });

  it("filters rules by the searchable rule content", () => {
    renderTable();
    const toolbar = screen.getByRole("region", { name: "规则筛选与分组" });

    fireEvent.change(within(toolbar).getByRole("searchbox", { name: "搜索" }), {
      target: { value: "支付宝" }
    });

    expect(screen.getByText("显示 1 / 3 条规则")).toBeTruthy();
    expect(screen.getByLabelText("#2商品条件")).toBeTruthy();
    expect(screen.queryByLabelText("#1商品条件")).toBeNull();
  });

  it("supports grouping by category and sorting by problem status", () => {
    const onSort = vi.fn();
    const { container } = renderTable(onSort);
    const toolbar = screen.getByRole("region", { name: "规则筛选与分组" });

    fireEvent.change(within(toolbar).getByRole("combobox", { name: "分组" }), {
      target: { value: "category" }
    });
    expect(container.querySelectorAll(".asset-track-rule-group-row")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /状态.*排序/ }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "status", direction: "asc" });
    expect(within(toolbar).queryByRole("combobox", { name: "排序" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重置视图" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编号排序" }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "id", direction: "asc" });
    expect(within(toolbar).getAllByRole("combobox")).toHaveLength(5);
  });

  it("shows classification filters directly", () => {
    const { container } = renderTable();
    const toolbar = screen.getByRole("region", { name: "规则筛选与分组" });

    fireEvent.change(within(toolbar).getByRole("combobox", { name: "状态" }), {
      target: { value: "冲突" }
    });

    expect(screen.getByText("显示 1 / 3 条规则")).toBeTruthy();
    expect(container.querySelector(".asset-track-rule-status.is-conflict")?.textContent).toBe("冲突");
  });
});
