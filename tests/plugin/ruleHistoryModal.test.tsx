// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HistoryBackfillContent,
  ProductRenameContent
} from "../../src/ui/RuleHistoryModal";
import type { ConfigurationEditorPort } from "../../src/services/ports";
import type {
  HistoricalProductStat
} from "../../src/types/rules";

function configurationApi(overrides: Partial<ConfigurationEditorPort> = {}): ConfigurationEditorPort {
  return {
    ruleWorkspaceShell: vi.fn(),
    saveRules: vi.fn(),
    ruleImpactPreview: vi.fn(),
    ruleWorkspaceAnalytics: vi.fn(),
    productOverview: vi.fn(),
    productHistoryIndex: vi.fn(),
    productHistory: vi.fn(),
    previewCategoryBackfill: vi.fn(),
    applyCategoryBackfill: vi.fn(),
    previewProductRename: vi.fn(),
    applyProductRename: vi.fn(),
    previewCounterpartyRename: vi.fn(),
    applyCounterpartyRename: vi.fn(),
    saveCategories: vi.fn(),
    ...overrides
  };
}

describe("rule history workspace loading", () => {
  afterEach(cleanup);

  it("loads category conflicts by default without a manual load button", async () => {
    const loadStats = vi.fn().mockResolvedValue({
      categories_revision: 1,
      rules_revision: 1,
      groups: []
    });
    const api = configurationApi({
      productHistoryIndex: loadStats,
      productHistory: vi.fn(),
      previewCategoryBackfill: vi.fn(),
      applyCategoryBackfill: vi.fn()
    });
    render(
      <HistoryBackfillContent
        api={api}
        categories={[]}
        mode="product"
        hostWindow={window}
        confirmAction={vi.fn()}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "加载统计" })).toBeNull();
    await waitFor(() => expect(loadStats).toHaveBeenCalledWith({
      issue_filter: "conflict"
    }));
    expect(screen.getByText("暂无商品-分类冲突。")).toBeTruthy();
    expect(screen.queryByText(/已加载/)).toBeNull();
  });

  it("loads category migration items directly without the generic filter panel", async () => {
    const loadCategory = vi.fn().mockResolvedValue({
      groups: [],
      rows: []
    });
    const loadIndex = vi.fn();
    const api = configurationApi({
      productHistoryIndex: loadIndex,
      productHistory: loadCategory,
      previewCategoryBackfill: vi.fn(),
      applyCategoryBackfill: vi.fn()
    });
    render(
      <HistoryBackfillContent
        api={api}
        categories={[{
          category_key: "food",
          name: "餐饮",
          transaction_type: "支出",
          necessity: "必要",
          pattern: "日常",
          is_big_ticket: false,
          color: "#ffffff",
          is_active: true,
          sort_order: 0
        }, {
          category_key: "other",
          name: "其他",
          transaction_type: "支出",
          necessity: "可控",
          pattern: "偶尔",
          is_big_ticket: false,
          color: "#000000",
          is_active: true,
          sort_order: 1
        }]}
        mode="category"
        initialQuery={{ category_key: "food" }}
        hostWindow={window}
        confirmAction={vi.fn()}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(loadCategory).toHaveBeenCalledWith({ category_key: "food" }));
    expect(loadIndex).not.toHaveBeenCalled();
    expect(screen.getByText("该分类没有可迁移的历史商品。")).toBeTruthy();
  });

  it("keeps embedded product issue panels free of generic filters", async () => {
    const loadStats = vi.fn()
      .mockResolvedValue({
        categories_revision: 1,
        rules_revision: 1,
        groups: []
      });
    const api = configurationApi({
      productHistoryIndex: loadStats,
      productHistory: vi.fn(),
      previewCategoryBackfill: vi.fn(),
      applyCategoryBackfill: vi.fn()
    });
    render(
      <HistoryBackfillContent
        api={api}
        categories={[]}
        mode="product"
        embedded
        hostWindow={window}
        confirmAction={vi.fn()}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(loadStats).toHaveBeenCalledWith({
      issue_filter: "conflict"
    }));
    expect(screen.queryByLabelText("商品搜索")).toBeNull();
    expect(loadStats).toHaveBeenCalledTimes(1);
  });

  it("loads the unfiltered product overview through the dedicated overview API", async () => {
    const loadOverview = vi.fn().mockResolvedValue({
      categories_revision: 1,
      rules_revision: 1,
      groups: []
    });
    const loadIndex = vi.fn();
    const api = configurationApi({
      productOverview: loadOverview,
      productHistoryIndex: loadIndex,
      productHistory: vi.fn(),
      previewCategoryBackfill: vi.fn(),
      applyCategoryBackfill: vi.fn()
    });
    render(
      <HistoryBackfillContent
        api={api}
        categories={[]}
        mode="product"
        overview
        embedded
        hostWindow={window}
        initialQuery={{}}
        confirmAction={vi.fn()}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(loadOverview).toHaveBeenCalledTimes(1));
    expect(loadIndex).not.toHaveBeenCalled();
    expect(screen.getByLabelText("商品搜索")).toBeTruthy();
    expect(screen.queryByLabelText("问题类型")).toBeNull();
    expect(screen.getByText("暂无商品记录。")).toBeTruthy();
  });

  it("loads the current product-name transaction list and confirms a compact edit", async () => {
    const group = {
      transaction_type: "支出",
      product_key: "拿铁大杯",
      product: "拿铁大杯",
      counterparty: "商户甲",
      variants: ["拿铁大杯"],
      counterparties: ["商户甲"],
      counterparty_count: 1,
      category_counts: [{
        category_key: "food",
        category: "餐饮",
        occurrences: 1,
        is_active: true
      }],
      recommended_category: "餐饮",
      recommended_category_key: "food",
      category_confidence: 1,
      has_category_conflict: false,
      category_status: "正常",
      occurrences: 1,
      months_count: 1,
      total_amount: 20,
      average_amount: 20,
      latest_amount: 20,
      last_date: "2026-01-01",
      first_month: "2026-01",
      last_month: "2026-01",
      matching_rule_count: 0,
      matching_rule_ids: [],
      matching_rule_levels: [],
      rule_coverage: "none",
      matched_occurrences: 0,
      unmatched_occurrences: 1,
      conflicted_occurrences: 0,
      rule_status: "未创建",
      history_rule_mismatch: false
    } satisfies HistoricalProductStat;
    const loadCandidates = vi.fn<ConfigurationEditorPort["productHistory"]>()
      .mockResolvedValue({
      groups: [],
      rows: [{
        id: 1,
        month: "2026-01",
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: "food",
        category: "餐饮",
        category_active: true,
        counterparty: "商户甲",
        product: "拿铁大杯",
        amount: 20,
        rule_match: { status: "none", rule_ids: [], reason: "none" }
      }, {
        id: 2,
        month: "2026-02",
        transaction_date: "2026-02-01",
        type: "支出",
        category_key: "food",
        category: "餐饮",
        category_active: true,
        counterparty: "商户乙",
        product: "拿铁（大杯）",
        amount: 22,
        rule_match: { status: "none", rule_ids: [], reason: "none" }
      }]
      });
    const previewProductRename = vi.fn().mockResolvedValue({
      transaction_ids: [1, 2],
      target_product: "咖啡",
      transaction_count: 2,
      month_count: 2,
      months: [
        { month: "2026-01", revision: 3, count: 1 },
        { month: "2026-02", revision: 4, count: 1 }
      ],
      variants: [
        { product: "拿铁大杯", occurrences: 1, months_count: 1 },
        { product: "拿铁（大杯）", occurrences: 1, months_count: 1 }
      ]
    });
    const applyProductRename = vi.fn().mockResolvedValue({
      transaction_ids: [1, 2],
      target_product: "咖啡",
      transaction_count: 2,
      month_count: 2,
      months: [
        { month: "2026-01", revision: 3, count: 1 },
        { month: "2026-02", revision: 4, count: 1 }
      ],
      variants: [],
      updated_count: 2,
      revisions: { "2026-01": 5, "2026-02": 6 }
    });
    const api = configurationApi({
      productHistory: loadCandidates,
      previewProductRename,
      applyProductRename
    });
    const onClose = vi.fn();

    render(
      <ProductRenameContent
        api={api}
        group={group}
        hostWindow={window}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        onClose={onClose}
      />
    );

    await waitFor(() => expect(loadCandidates).toHaveBeenCalledTimes(1));
    expect(loadCandidates.mock.calls[0][0]).toMatchObject({
      transaction_type: "支出",
      product_key: "拿铁大杯"
    });
    expect(screen.getByText("拿铁大杯")).toBeTruthy();
    expect(screen.getByText("拿铁（大杯）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "全选流水" }));
    fireEvent.change(screen.getByLabelText("修改为商品名称"), {
      target: { value: "咖啡" }
    });
    fireEvent.click(screen.getByRole("button", { name: "修改商品" }));
    await waitFor(() => expect(previewProductRename).toHaveBeenCalledWith({
      transaction_ids: [1, 2],
      target_product: "咖啡"
    }));
    expect(screen.queryByText(/已准备修改/)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "确认修改 2 条" }));
    await waitFor(() => expect(applyProductRename).toHaveBeenCalledWith({
      transaction_ids: [1, 2],
      target_product: "咖啡",
      expected_month_revisions: { "2026-01": 3, "2026-02": 4 }
    }));
    expect(onClose).toHaveBeenCalled();
  });
});
