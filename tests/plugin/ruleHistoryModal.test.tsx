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
import type { AssetTrackService } from "../../src/services/AssetTrackService";
import type {
  CategoryDefinition,
  HistoricalProductStat
} from "../../src/types";

describe("rule history workspace loading", () => {
  afterEach(cleanup);

  it("loads category conflicts by default without a manual load button", async () => {
    const loadStats = vi.fn().mockResolvedValue({
      categories_revision: 1,
      rules_revision: 1,
      groups: []
    });
    const api = {
      productHistoryIndex: loadStats,
      productHistory: vi.fn(),
      previewCategoryBackfill: vi.fn(),
      applyCategoryBackfill: vi.fn()
    } as unknown as AssetTrackService;
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
  });

  it("loads category migration items directly without the generic filter panel", async () => {
    const loadCategory = vi.fn().mockResolvedValue({
      groups: [],
      rows: []
    });
    const loadIndex = vi.fn();
    const api = {
      productHistoryIndex: loadIndex,
      productHistory: loadCategory,
      previewCategoryBackfill: vi.fn(),
      applyCategoryBackfill: vi.fn()
    } as unknown as AssetTrackService;
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
    const api = {
      productHistoryIndex: loadStats,
      productHistory: vi.fn(),
      previewCategoryBackfill: vi.fn(),
      applyCategoryBackfill: vi.fn()
    } as unknown as AssetTrackService;
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

  it("loads rename candidates by type and category without fixing the product key", async () => {
    const food: CategoryDefinition = {
      category_key: "food",
      name: "餐饮",
      transaction_type: "支出",
      necessity: "必要",
      pattern: "日常",
      is_big_ticket: false,
      color: "#ffffff",
      is_active: true,
      sort_order: 0
    };
    const other: CategoryDefinition = {
      ...food,
      category_key: "other",
      name: "其他",
      sort_order: 1
    };
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
    const loadCandidates = vi.fn<AssetTrackService["productHistory"]>()
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
    const api = {
      productHistory: loadCandidates,
      previewProductRename: vi.fn(),
      applyProductRename: vi.fn()
    } as unknown as AssetTrackService;

    render(
      <ProductRenameContent
        api={api}
        categories={[food, other]}
        group={group}
        hostWindow={window}
        confirmAction={vi.fn()}
        onSaved={vi.fn()}
        onDataChanged={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(loadCandidates).toHaveBeenCalledTimes(1));
    expect(loadCandidates.mock.calls[0][0]).toMatchObject({
      transaction_type: "支出",
      category_key: "food"
    });
    expect(loadCandidates.mock.calls[0][0]).not.toHaveProperty("product_key");
    expect(screen.getByText("拿铁大杯")).toBeTruthy();
    expect(screen.getByText("拿铁（大杯）")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("分类范围"), {
      target: { value: "__all__" }
    });
    await waitFor(() => expect(
      screen.getByText("查看全部分类时，请先输入商品搜索条件。")
    ).toBeTruthy());
    expect(loadCandidates).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("商品搜索"), {
      target: { value: "拿铁" }
    });
    await waitFor(() => expect(loadCandidates).toHaveBeenCalledTimes(2));
    expect(loadCandidates.mock.calls[1][0]).toMatchObject({
      transaction_type: "支出",
      product_search: "拿铁"
    });
    expect(loadCandidates.mock.calls[1][0].category_key).toBeUndefined();
  });
});
