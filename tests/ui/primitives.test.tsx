// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  IssueList,
  orderedIssues
} from "../../src/ui/editorPrimitives";
import { countAssignedCategories } from "../../src/ui/month/useTransactionOperations";
import type { Transaction } from "../../src/types/transactions";
import { ActionTableHeader, StaticTableHeader } from "../../src/ui/TablePrimitives";
import {
  groupTransactions,
  normalizeProduct
} from "../../src/ui/transactionGrouping";
import {
  calculateVirtualRowRange,
  virtualSpacerBlocks
} from "../../src/ui/virtualRows";

afterEach(cleanup);

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

describe("table header primitives", () => {
  it("renders non-sortable headers with the uniform button treatment", () => {
    render(
      <table>
        <thead>
          <tr>
            <StaticTableHeader label="状态" />
          </tr>
        </thead>
      </table>
    );

    const header = screen.getByRole("columnheader");
    const button = screen.getByRole("button", { name: "状态" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(header.textContent?.trim()).toBe("状态");
    expect(header.querySelector(".asset-track-sort-static")).toBeTruthy();
  });

  it("uses the uniform button treatment for the operation header", () => {
    render(
      <table>
        <thead>
          <tr>
            <ActionTableHeader />
          </tr>
        </thead>
      </table>
    );

    const header = screen.getByRole("columnheader");
    const button = screen.getByRole("button", { name: "操作" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(header.textContent?.trim()).toBe("操作");
    expect(header.classList.contains("asset-track-actions-heading")).toBe(true);
  });
});

function groupedRow(overrides: Partial<Transaction>): Transaction {
  return {
    transaction_date: "2026-01-01",
    type: "支出",
    category: "餐饮基础",
    product: "咖啡",
    amount: 10,
    ...overrides
  };
}

describe("transaction grouping", () => {
  it("groups equivalent product labels for display without removing source rows", () => {
    const rows = [
      groupedRow({ product: "咖啡", amount: 10 }),
      groupedRow({ product: "咖 啡！", amount: 12, transaction_date: "2026-01-03" }),
      groupedRow({ type: "收入", product: "咖啡", amount: 20 })
    ];

    const groups = groupTransactions(rows);

    expect(rows).toHaveLength(3);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      count: 2,
      amount: 22,
      indexes: [0, 1],
      firstDate: "2026-01-01",
      lastDate: "2026-01-03"
    });
  });

  it("normalizes width, case, spaces and punctuation conservatively", () => {
    expect(normalizeProduct(" Ａb C！")).toBe("abc");
  });

  it("reports rule coverage and item-rule coverage for grouped rows", () => {
    const rows = [
      groupedRow({ id: 1, counterparty: "商户甲", product: "咖啡" }),
      groupedRow({ id: 2, counterparty: "商户甲", product: "茶" }),
      groupedRow({ id: 3, counterparty: "商户乙", product: "咖啡" })
    ];
    const groups = groupTransactions(rows, "counterparty", undefined, [{
      id: 7,
      transaction_type: "支出",
      match_scope: "product",
      counterparty: "",
      product: "咖啡",
      category_key: "food",
      category: "餐饮基础"
    }]);

    expect(groups[0]).toMatchObject({
      label: "商户甲",
      count: 2,
      matchedCount: 1,
      unmatchedCount: 1,
      itemRuleCoveredCount: 1,
      ruleCoverage: "partial",
      ruleIds: [7]
    });
    expect(groups[1]).toMatchObject({
      label: "商户乙",
      matchedCount: 1,
      ruleCoverage: "full",
      itemRuleCoveredCount: 1
    });
  });
});

describe("virtual row range", () => {
  it("renders the viewport with overscan", () => {
    expect(calculateVirtualRowRange(10_000, 5_000, 500, 50, 5)).toEqual({
      start: 95,
      end: 115,
      paddingTop: 4_750,
      paddingBottom: 494_250
    });
  });

  it("clamps the range at both ends", () => {
    expect(calculateVirtualRowRange(3, 0, 500, 50, 8)).toEqual({
      start: 0,
      end: 3,
      paddingTop: 0,
      paddingBottom: 0
    });
    expect(calculateVirtualRowRange(0, 0, 500)).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0
    });
  });

  it("represents large spacer heights with a bounded set of CSS blocks", () => {
    const blocks = virtualSpacerBlocks(50_123);
    expect(blocks.reduce((total, block) => total + block, 0)).toBe(50_123);
    expect(blocks.length).toBeLessThanOrEqual(17);
  });
});
