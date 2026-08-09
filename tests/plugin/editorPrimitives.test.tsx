// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  IssueList,
  orderedIssues
} from "../../src/ui/editorPrimitives";
import { countAssignedCategories } from "../../src/ui/month/useTransactionOperations";
import type { Transaction } from "../../src/types/transactions";

const rows: Transaction[] = Array.from({ length: 12 }, (_, index) => ({
  client_id: `draft-${index}`,
  transaction_date: "2026-07-01",
  type: "支出",
  category_key: null,
  category: "",
  product: `商品${index + 1}`,
  amount: 10
}));

describe("editor issue presentation", () => {
  afterEach(cleanup);

  it("shows at most ten issues and keeps blocking errors first", () => {
    const issues = [
      ...Array.from({ length: 10 }, (_, index) => ({
        row_index: index,
        type: "支出",
        field: "金额",
        issue: `金额错误${index + 1}`,
        severity: "错误",
        blocking: true
      })),
      {
        row_index: 10,
        type: "支出",
        field: "商品",
        issue: "商品为空",
        severity: "警告",
        blocking: false
      },
      {
        row_index: 11,
        type: "支出",
        field: "金额",
        issue: "金额为 0",
        severity: "警告",
        blocking: false
      }
    ];

    render(<IssueList issues={issues} rows={rows} />);

    const alert = screen.getByRole("alert");
    const listItems = within(alert).getAllByRole("listitem");
    expect(listItems).toHaveLength(10);
    expect(listItems[0].textContent).toContain("［错误］");
    expect(within(alert).getByText(/共 12 项问题，其中 10 项会阻止保存/)).toBeTruthy();
    expect(within(alert).getByText(/其余 2 项已省略/)).toBeTruthy();
  });

  it("orders warnings by their field priority while preserving ties", () => {
    const issues = [
      { field: "金额", issue: "金额为 0", severity: "警告", blocking: false },
      { field: "商品", issue: "商品为空", severity: "警告", blocking: false },
      { field: "分类", issue: "分类为空", severity: "警告", blocking: false }
    ];

    expect(orderedIssues(issues).map(({ issue }) => issue.field)).toEqual([
      "分类",
      "商品",
      "金额"
    ]);
  });

  it("counts only canonical category keys as assigned categories", () => {
    expect(countAssignedCategories([
      { category_key: null },
      { category_key: "" },
      { category_key: "  " },
      { category_key: "cat-food" }
    ])).toBe(1);
  });
});
