// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConfigurationEditorPort,
  MonthEditorPort
} from "../../src/services/ports";
import type {
  CategoryDefinition
} from "../../src/types/configuration";
import type {
  MonthWorkspace
} from "../../src/types/month";
import type {
  RuleWorkspace
} from "../../src/types/rules";
import {
  MonthEditor,
  RulesEditor
} from "../../src/ui/AssetTrackEditorApp";
import type {
  MonthEditorDraftSnapshot,
  RulesEditorDraftSnapshot
} from "../../src/ui/editorDraft";

afterEach(cleanup);

const category: CategoryDefinition = {
  category_key: "food",
  name: "恢复分类",
  transaction_type: "支出",
  necessity: "必要",
  pattern: "日常",
  is_big_ticket: false,
  color: "#ffffff",
  is_active: true,
  sort_order: 0
};

function monthWorkspace(revision: number): MonthWorkspace {
  return {
    month: "2026-08",
    revision,
    status: "saved",
    debt_revision: 2,
    cash_accounts: [],
    investment_accounts: [],
    transactions: [{
      id: 1,
      transaction_date: "2026-08-01",
      type: "支出",
      category_key: "food",
      category: "恢复分类",
      counterparty: "恢复商户",
      product: "恢复商品",
      amount: 12
    }],
    debts: [{
      id: 1,
      start_date: "2026-08-01",
      description: "恢复借款",
      counterparty: "朋友",
      amount: 100,
      is_paid: false,
      paid_date: null
    }],
    fixed_assets: [],
    computed: {},
    overview: { available: false }
  };
}

function createRuleWorkspaceFixture(): RuleWorkspace {
  return {
    categories_revision: 4,
    rules_revision: 5,
    categories: [category],
    rules: [],
    recommendations: [],
    historical_products: [],
    rule_conflicts: [],
    summary: {
      product_conflicts: 0,
      rule_conflicts: 0,
      duplicate_rules: 0,
      inactive_category_transactions: 0,
      uncategorized_transactions: 0,
      stable_products_without_rule: 0
    }
  };
}

function debtReconciliationWorkspace(): MonthWorkspace {
  return {
    month: "2026-02",
    revision: 1,
    status: "saved",
    debt_revision: 1,
    cash_accounts: [{ account_key: "cash-default", account: "现金", balance: 800 }],
    investment_accounts: [],
    transactions: [],
    debts: [{
      id: 1,
      start_date: "2026-01-01",
      description: "信用借款",
      counterparty: "银行",
      amount: 200,
      is_paid: false,
      paid_date: null
    }],
    fixed_assets: [],
    computed: {},
    overview: {
      available: true,
      reconciliation: {
        available: true,
        actual: { all_out: 0, daifu: 0, net_expense: 0 },
        theoretical: {
          previous_cash: 1000,
          income: 0,
          debt_change: 0,
          cash: 800,
          deposit: 0,
          withdraw: 0,
          net_expense: 200
        },
        discrepancy: -200,
        explanation: {
          level: "error",
          title: "",
          summary: "",
          causes: [],
          suggestions: []
        }
      }
    }
  };
}

function monthApi(overrides: Partial<MonthEditorPort> = {}): MonthEditorPort {
  return {
    month: vi.fn().mockResolvedValue(monthWorkspace(1)),
    deleteMonth: vi.fn().mockResolvedValue({}),
    saveMonth: vi.fn().mockResolvedValue(monthWorkspace(1)),
    saveMonthSection: vi.fn().mockResolvedValue(monthWorkspace(1)),
    validateTransactions: vi.fn().mockResolvedValue({ issues: [] }),
    previewTransactionOperation: vi.fn(),
    inspectCsv: vi.fn(),
    previewMappedCsv: vi.fn(),
    categories: vi.fn().mockResolvedValue({ revision: 1, rows: [] }),
    ruleWorkspaceShell: vi.fn().mockResolvedValue({
      categories_revision: 1,
      rules_revision: 1,
      categories: [],
      rules: []
    }),
    saveRules: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function configurationApi(overrides: Partial<ConfigurationEditorPort> = {}): ConfigurationEditorPort {
  return {
    ruleWorkspaceShell: vi.fn().mockResolvedValue({
      categories_revision: 1,
      rules_revision: 1,
      categories: [],
      rules: []
    }),
    saveRules: vi.fn().mockResolvedValue(undefined),
    ruleImpactPreview: vi.fn(),
    ruleWorkspaceAnalytics: vi.fn().mockResolvedValue({}),
    productOverview: vi.fn(),
    productHistoryIndex: vi.fn(),
    productHistory: vi.fn(),
    previewCategoryBackfill: vi.fn(),
    applyCategoryBackfill: vi.fn(),
    previewProductRename: vi.fn(),
    applyProductRename: vi.fn(),
    previewCounterpartyRename: vi.fn(),
    applyCounterpartyRename: vi.fn(),
    saveCategories: vi.fn().mockResolvedValue({ revision: 1, rows: [] }),
    ...overrides
  };
}

describe("editor draft restoration", () => {
  it("restores a month draft and reports an external revision change", async () => {
    const snapshot: MonthEditorDraftSnapshot = {
      kind: "transactions",
      month: "2026-08",
      workspace: monthWorkspace(3),
      categories: [category],
      issues: []
    };
    const api = monthApi({
      month: vi.fn().mockResolvedValue(monthWorkspace(4)),
      categories: vi.fn().mockResolvedValue({
        revision: 1,
        rows: [category]
      }),
      ruleWorkspaceShell: vi.fn().mockResolvedValue({
        categories_revision: 4,
        rules_revision: 5,
        categories: [category],
        rules: []
      })
    });
    const onSessionChange = vi.fn();

    render(
      <MonthEditor
        api={api}
        hostWindow={window}
        month="2026-08"
        months={["2026-08"]}
        dataVersion={0}
        reconciliationTolerance={100}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
        initialDraft={snapshot}
        onSessionChange={onSessionChange}
        getCsvMapping={vi.fn()}
        saveCsvMapping={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("恢复商品")).toBeTruthy();
    expect(screen.getByDisplayValue("恢复借款")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(
      "草稿已恢复，但其他窗口已修改当前月份；重新加载前不能覆盖保存。"
    )).toBeTruthy());
    expect(onSessionChange).toHaveBeenCalledWith(snapshot);
  });

  it("restores category and rule drafts without replacing local names", async () => {
    const workspace = createRuleWorkspaceFixture();
    const snapshot: RulesEditorDraftSnapshot = {
      kind: "rules",
      workspace,
      category_dirty: true,
      rule_dirty: false,
      analytics_ready: true
    };
    const api = configurationApi({
      ruleWorkspaceShell: vi.fn().mockResolvedValue({
        categories_revision: 4,
        rules_revision: 5,
        categories: [{ ...category, name: "数据库分类" }],
        rules: []
      }),
      ruleWorkspaceAnalytics: vi.fn().mockResolvedValue({
        categories_revision: 4,
        rules_revision: 5,
        categories: [{ ...category, name: "数据库分类" }],
        rules: [],
        recommendations: [],
        rule_conflicts: [],
        summary: workspace.summary
      })
    });
    const onSessionChange = vi.fn();

    render(
      <RulesEditor
        app={{} as App}
        api={api}
        hostWindow={window}
        dataVersion={0}
        initialDraft={snapshot}
        onSessionChange={onSessionChange}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        confirmAction={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("恢复分类")).toBeTruthy();
    expect(onSessionChange).toHaveBeenCalledWith(expect.objectContaining({
      kind: "rules",
      category_dirty: true,
      rule_dirty: false
    }));
  });

  it("recalculates draft reconciliation immediately after marking inherited debt paid", async () => {
    const workspace = debtReconciliationWorkspace();
    const snapshot: MonthEditorDraftSnapshot = {
      kind: "transactions",
      month: "2026-02",
      workspace,
      categories: [],
      issues: []
    };
    const api = monthApi({
      month: vi.fn().mockResolvedValue(workspace),
      categories: vi.fn().mockResolvedValue({
        revision: 1,
        rows: []
      }),
      ruleWorkspaceShell: vi.fn().mockResolvedValue({
        categories_revision: 1,
        rules_revision: 1,
        categories: [],
        rules: []
      })
    });

    render(
      <MonthEditor
        api={api}
        hostWindow={window}
        month="2026-02"
        months={["2026-01", "2026-02"]}
        dataVersion={0}
        reconciliationTolerance={100}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
        initialDraft={snapshot}
        onSessionChange={vi.fn()}
        getCsvMapping={vi.fn()}
        saveCsvMapping={vi.fn()}
      />
    );

    const metrics = screen.getByLabelText("本月摘要");
    expect(within(metrics).getByText("-¥200.0")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("借款第 1 行本月还清"));

    expect(within(metrics).queryByText("-¥200.0")).toBeNull();
    expect(within(metrics).getAllByText("¥0.0").length).toBeGreaterThan(0);
  });
});
