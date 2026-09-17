// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CategoryDefinition
} from "../../src/types/configuration";
import type {
  DebtRecord
} from "../../src/types/month";
import type {
  Transaction
} from "../../src/types/transactions";
import type {
  MonthWorkspace
} from "../../src/types/month";
import { MonthDebtSection } from "../../src/ui/MonthDebtSection";
import { TransactionSummaryTable, TransactionTable } from "../../src/ui/TransactionTables";
import { MonthEditorTransactionsSection } from "../../src/ui/month/MonthEditorTransactionsSection";

afterEach(cleanup);

describe("month debt and special transaction rows", () => {
  it("blocks editing a debt that is already paid in a future month", () => {
    const row: DebtRecord = {
      id: 1,
      description: "信用借款",
      counterparty: "银行",
      amount: 200,
      start_date: "2026-01-01",
      is_paid: false,
      paid_date: "2026-02-28"
    };
    const onChange = vi.fn();
    const onBlocked = vi.fn();

    render(
      <MonthDebtSection
        month="2026-01"
        rows={[row]}
        onChange={onChange}
        onBlocked={onBlocked}
      />
    );

    fireEvent.click(screen.getByLabelText("借款第 1 行本月还清"));
    expect(onBlocked).toHaveBeenCalledWith(
      "借款未来 2026-02-28 已还清，不可修改此月借款。"
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not render a category column for special transaction tables", () => {
    const rows: Transaction[] = [{
      id: 1,
      transaction_date: "2026-01-01",
      type: "加仓",
      category_key: null,
      category: "",
      counterparty: "券商",
      product: "理财转入",
      amount: 100
    }];
    const categories: CategoryDefinition[] = [{
      category_key: "investment",
      name: "理财",
      transaction_type: "支出",
      necessity: "不适用",
      pattern: "不适用",
      is_big_ticket: false,
      color: "#ffffff",
      is_active: true,
      sort_order: 0
    }];

    render(
      <TransactionTable
        title="加仓"
        rows={rows}
        visibleIndexes={[0]}
        categories={categories}
        investmentAccounts={[{
          account_key: "investment-default",
          name: "默认理财账户",
          principal: 0,
          market_value: 0,
          cash_balance: 0,
          is_active: true
        }]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />
    );

    expect(screen.queryByText("分类")).toBeNull();
    expect(screen.queryByText("无需分类")).toBeNull();
    expect(screen.getByLabelText("加仓第 1 行账户")).toBeDefined();
    expect(screen.queryByLabelText("加仓第 1 行分类")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("marks transaction row validation issues next to the row number", () => {
    const rows: Transaction[] = [{
      id: 1,
      transaction_date: "2026-01-01",
      type: "支出",
      category_key: null,
      category: "",
      counterparty: "咖啡店",
      product: "",
      amount: 0
    }];

    render(
      <TransactionTable
        title="支出"
        rows={rows}
        visibleIndexes={[0]}
        categories={[]}
        issues={[
          { row_index: 0, field: "商品", issue: "商品为空", severity: "警告", blocking: false },
          { row_index: 0, field: "金额", issue: "金额为 0", severity: "警告", blocking: false }
        ]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />
    );

    expect(screen.getByLabelText("支出第 1 行 · 提醒 2：商品：商品为空；金额：金额为 0")).toBeDefined();
    expect(document.querySelector(".asset-track-row-issue-details")).toBeNull();
  });

  it("does not render a repeated issue notice inside the transaction section", () => {
    const rows: Transaction[] = [{
      id: 1,
      transaction_date: "2026-01-01",
      type: "支出",
      category_key: null,
      category: "",
      counterparty: "咖啡店",
      product: "拿铁",
      amount: 12
    }];
    const draft: MonthWorkspace = {
      month: "2026-01",
      revision: 1,
      status: "draft",
      debt_revision: 1,
      cash_accounts: [],
      investment_accounts: [],
      transactions: rows,
      debts: [],
      fixed_assets: [],
    computed: null,
      overview: { available: false }
    };

    render(
      <MonthEditorTransactionsSection
        month="2026-01"
        draft={draft}
        categories={[]}
        issues={[{ row_index: 0, field: "分类", issue: "分类为空", severity: "警告", blocking: false }]}
        summarySort={null}
        expandedGroup=""
        onSummarySort={vi.fn()}
        onExpandedGroupChange={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        businessTab="outgoing"
        viewMode="detail"
        onViewModeChange={vi.fn()}
        showBusinessTabs={false}
      />
    );

    expect(document.querySelector(".asset-track-transaction-issues")).toBeNull();
    expect(document.querySelector(".asset-track-transaction-issues-notice")).toBeNull();
    expect(screen.queryByRole("button", { name: "展开问题列表" })).toBeNull();
    expect(screen.queryByRole("button", { name: "显示分类和交易对手" })).toBeNull();
  });

  it("offers the retained source row for an imported transaction", () => {
    const rows: Transaction[] = [{
      id: 1,
      source: "账单.csv · 原始第 2 行",
      transaction_date: "2026-01-01",
      type: "支出",
      category_key: null,
      category: "",
      counterparty: "咖啡店",
      product: "拿铁",
      amount: 12
    }];
    const onViewSourceRow = vi.fn();

    render(
      <TransactionTable
        title="支出"
        rows={rows}
        visibleIndexes={[0]}
        categories={[]}
        sourceRows={[{ row: 2, values: ["2026-01-01", "拿铁", "12", "支出"] }]}
        onViewSourceRow={onViewSourceRow}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看支出第 1 行原始账单" }));
    expect(onViewSourceRow).toHaveBeenCalledWith(rows[0], {
      row: 2,
      values: ["2026-01-01", "拿铁", "12", "支出"]
    });
  });

  it("removes rule coverage from item summary and keeps type/category sortable", () => {
    const onSort = vi.fn();
    const rows: Transaction[] = [
      {
        id: 1,
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: "food",
        category: "餐饮改善",
        counterparty: "咖啡店",
        product: "咖啡",
        amount: 20
      },
      {
        id: 2,
        transaction_date: "2026-01-02",
        type: "收入",
        category_key: "salary",
        category: "工资",
        counterparty: "公司",
        product: "工资",
        amount: 1000
      }
    ];

    render(
      <TransactionSummaryTable
        rows={rows}
        categories={[]}
        sort={null}
        onSort={onSort}
        expanded=""
        onExpanded={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByText("最近日期")).toBeNull();
    expect(screen.queryByText("规则覆盖")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "类型排序" }));
    expect(onSort).toHaveBeenCalledWith({ key: "type", direction: "asc" });

    fireEvent.click(screen.getByRole("button", { name: "分类排序" }));
    expect(onSort).toHaveBeenCalledWith({ key: "category", direction: "asc" });
  });

  it("edits the parent summary item field for every row in the group", () => {
    const onUpdateGroup = vi.fn();
    const rows: Transaction[] = [
      {
        id: 1,
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: "food",
        category: "餐饮",
        counterparty: "咖啡店",
        product: "咖啡",
        amount: 20
      },
      {
        id: 2,
        transaction_date: "2026-01-02",
        type: "支出",
        category_key: "food",
        category: "餐饮",
        counterparty: "另一家咖啡店",
        product: "咖啡",
        amount: 25
      }
    ];

    render(
      <TransactionSummaryTable
        rows={rows}
        categories={[]}
        sort={null}
        onSort={vi.fn()}
        expanded=""
        onExpanded={vi.fn()}
        onUpdate={vi.fn()}
        onUpdateGroup={onUpdateGroup}
        onDelete={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("修改咖啡汇总组商品"), {
      target: { value: "拿铁" }
    });

    expect(onUpdateGroup).toHaveBeenCalledWith([0, 1], "product", "拿铁");
  });

  it("does not render a category placeholder in special item summary details", () => {
    const rows: Transaction[] = [{
      id: 1,
      transaction_date: "2026-01-01",
      type: "提现",
      category_key: null,
      category: "",
      counterparty: "券商",
      product: "理财赎回",
      amount: 100
    }];

    function Harness() {
      const [expanded, setExpanded] = useState("");
      return (
        <TransactionSummaryTable
          rows={rows}
          categories={[]}
          sort={null}
          onSort={vi.fn()}
          expanded={expanded}
          onExpanded={setExpanded}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "展开逐项" }));

    expect(screen.queryByText("无需分类")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("aligns summary details with the parent columns", () => {
    const rows: Transaction[] = [{
      id: 1,
      transaction_date: "2026-01-01",
      type: "支出",
      category_key: "food",
      category: "餐饮改善",
      counterparty: "咖啡店",
      product: "咖啡",
      amount: 20
    }];
    const categories: CategoryDefinition[] = [{
      category_key: "food",
      name: "餐饮改善",
      transaction_type: "支出",
      necessity: "不适用",
      pattern: "不适用",
      is_big_ticket: false,
      color: "#ffffff",
      is_active: true,
      sort_order: 0
    }];
    function Harness() {
      const [expanded, setExpanded] = useState("");
      return (
        <TransactionSummaryTable
          rows={rows}
          categories={categories}
          sort={null}
          onSort={vi.fn()}
          expanded={expanded}
          onExpanded={setExpanded}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
          selectedTransactionKeys={new Set()}
          onToggleTransaction={vi.fn()}
          renderRuleControls={() => <button type="button">新建规则</button>}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "展开逐项" }));

    expect(screen.getByRole("columnheader", { name: "行号" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "交易对手商品金额日期" })).toBeDefined();
    expect(screen.getByDisplayValue("2026-01-01")).toBeDefined();
    expect(screen.getByLabelText("选择支出第 1 行")).toBeDefined();
    expect(screen.getByText("新建规则")).toBeDefined();
    expect(screen.getByText("删除")).toBeDefined();
    const parentColumns = Array.from(
      document.querySelectorAll(".asset-track-summary-table > colgroup > col")
    ).map((column) => column.className);
    const detailColumns = Array.from(
      document.querySelectorAll(".asset-track-summary-detail-table--nested > colgroup > col")
    ).map((column) => column.className);
    expect(parentColumns).toEqual([
      "asset-track-summary-col-type",
      "asset-track-summary-col-group",
      "asset-track-summary-col-count",
      "asset-track-summary-col-amount",
      "asset-track-summary-col-category",
      "asset-track-summary-col-actions"
    ]);
    expect(detailColumns).toEqual(parentColumns);
    expect(document.querySelector(".asset-track-summary-detail-table--nested")).toBeTruthy();
  });
});
