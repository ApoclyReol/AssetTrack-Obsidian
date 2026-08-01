// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetTrackService } from "../../src/services/AssetTrackService";
import type {
  CategoryDefinition,
  MonthWorkspace,
  RuleWorkspace
} from "../../src/types";
import {
  CollectionEditor,
  MonthEditor,
  RulesEditorV2
} from "../../src/ui/AssetTrackEditorApp";
import type {
  DebtEditorDraftSnapshot,
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
    fixed_assets: [],
    computed: {},
    overview: { available: false }
  };
}

function ruleWorkspace(): RuleWorkspace {
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

describe("editor draft restoration", () => {
  it("restores a month draft and reports an external revision change", async () => {
    const snapshot: MonthEditorDraftSnapshot = {
      kind: "transactions",
      month: "2026-08",
      workspace: monthWorkspace(3),
      categories: [category],
      issues: []
    };
    const api = {
      month: vi.fn().mockResolvedValue(monthWorkspace(4)),
      categories: vi.fn().mockResolvedValue({
        revision: 1,
        rows: [category]
      })
    } as unknown as AssetTrackService;
    const onDirty = vi.fn();
    const onDraftChange = vi.fn();

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
        onDirty={onDirty}
        initialDraft={snapshot}
        onDraftChange={onDraftChange}
        getCsvMapping={vi.fn()}
        saveCsvMapping={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("恢复商品")).toBeTruthy();
    await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByText(
      "草稿已恢复，但其他窗口已修改当前月份；重新加载前不能覆盖保存。"
    )).toBeTruthy());
    expect(onDraftChange).toHaveBeenCalledWith(snapshot);
  });

  it("restores the debt rows instead of replacing them during the revision check", async () => {
    const snapshot: DebtEditorDraftSnapshot = {
      kind: "debts",
      revision: 2,
      rows: [{
        id: 1,
        start_date: "2026-08-01",
        description: "恢复借款",
        counterparty: "朋友",
        amount: 100,
        is_paid: false,
        paid_date: ""
      }]
    };
    const onDirty = vi.fn();
    const onDraftChange = vi.fn();

    render(
      <CollectionEditor
        title="借款管理"
        load={vi.fn().mockResolvedValue({
          revision: 2,
          rows: [{ ...snapshot.rows[0], description: "数据库借款" }]
        })}
        save={vi.fn()}
        createRow={vi.fn()}
        columns={[
          ["description", "说明", "text"]
        ]}
        onDirty={onDirty}
        initialDraft={snapshot}
        onDraftChange={onDraftChange}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("恢复借款")).toBeTruthy();
    await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
    expect(onDraftChange).toHaveBeenCalledWith(snapshot);
  });

  it("restores category and rule drafts without replacing local names", async () => {
    const workspace = ruleWorkspace();
    const snapshot: RulesEditorDraftSnapshot = {
      kind: "rules",
      workspace,
      category_dirty: true,
      rule_dirty: false,
      analytics_ready: true
    };
    const api = {
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
    } as unknown as AssetTrackService;
    const onDirty = vi.fn();
    const onDraftChange = vi.fn();

    render(
      <RulesEditorV2
        app={{} as App}
        api={api}
        hostWindow={window}
        dataVersion={0}
        onDirty={onDirty}
        initialDraft={snapshot}
        onDraftChange={onDraftChange}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        confirmAction={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("恢复分类")).toBeTruthy();
    await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      kind: "rules",
      category_dirty: true,
      rule_dirty: false
    }));
  });
});
