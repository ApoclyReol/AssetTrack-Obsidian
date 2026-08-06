import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

describe("history repository", () => {

it("loads product history only after a filter and keeps the shell lightweight", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户甲",
        product: "咖啡",
        amount: 20
      }],
      []
    );

    const shell = repository.ruleWorkspaceShell();
    expect(shell.categories_revision).toBe(repository.categories().revision);
    expect(shell.rules_revision).toBe(repository.rules().revision);
    expect(shell.rules).toEqual([]);
    const analytics = repository.ruleWorkspaceAnalytics();
    expect(analytics.categories.find((row) => row.category_key === food)).toMatchObject({
      transaction_count: 1
    });

    expect(repository.productOverview().groups).toEqual([
      expect.objectContaining({ product: "咖啡", occurrences: 1 })
    ]);
    expect(() => repository.productHistoryIndex({})).toThrowError("history.filter_required");
    expect(() => repository.productHistory({})).toThrowError("history.filter_required");
    expect(repository.productHistoryIndex({ transaction_type: "收入" }).groups).toEqual([]);
    expect(repository.productHistoryIndex({ product_search: "咖啡" }).groups).toEqual([
      expect.objectContaining({ product: "咖啡", occurrences: 1 })
    ]);
    expect(repository.productHistoryIndex({ min_occurrences: 2 }).groups).toEqual([]);
  });

it("previews and atomically applies category backfills across months", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string) => repository.saveMonth(
      month,
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: `${month}-01`, type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "咖啡", amount: 20
      }],
      []
    );
    const january = await save("2026-01");
    const february = await save("2026-02");
    const ids = [january.transactions[0].id!, february.transactions[0].id!];
    const preview = repository.previewCategoryBackfill({
      transaction_ids: ids,
      target_category_key: quality
    });
    expect(preview).toMatchObject({
      transaction_count: 2,
      month_count: 2,
      target_category: "餐饮改善"
    });
    expect(preview.old_categories).toEqual([
      expect.objectContaining({ category_key: food, occurrences: 2 })
    ]);
    const result = await repository.applyCategoryBackfill({
      transaction_ids: ids,
      target_category_key: quality,
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    });
    expect(result.updated_count).toBe(2);
    expect(result.revisions).toEqual({ "2026-01": 2, "2026-02": 2 });
    expect((await repository.getMonth("2026-01")).transactions[0]).toMatchObject({
      id: ids[0],
      transaction_date: "2026-01-01",
      product: "咖啡",
      amount: 20,
      category_key: quality,
      category: "餐饮改善"
    });
    await expect(repository.applyCategoryBackfill({
      transaction_ids: ids,
      target_category_key: food,
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    })).rejects.toMatchObject({ status: 409 });
    expect((await repository.getMonth("2026-02")).transactions[0].category_key).toBe(quality);
  });

it("keeps category backfill preview available when rule uniqueness is enforced", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户甲",
        product: "拿铁",
        amount: 20
      }],
      []
    );
    const insert = manager.connection().prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    insert.run("支出", "商户甲", "拿铁", food, "餐饮基础");
    expect(() => insert.run("支出", "商户甲", "拿铁", quality, "餐饮改善"))
      .toThrow(/UNIQUE constraint failed/);
    const preview = repository.previewCategoryBackfill({
      transaction_ids: [saved.transactions[0].id!],
      target_category_key: quality
    });
    expect(preview.transaction_count).toBe(1);
    expect((await repository.getMonth("2026-01")).transactions[0].category_key).toBe(food);
  });

it("previews and atomically renames selected saved product variants", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const january = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: "2026-01-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "拿铁大杯", amount: 20
      }],
      []
    );
    const february = await repository.saveMonth(
      "2026-02",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: "2026-02-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "拿铁（大杯）", amount: 22
      }],
      []
    );
    const ids = [january.transactions[0].id!, february.transactions[0].id!];
    const ruleInsert = manager.connection().prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    ruleInsert.run("支出", "商户甲", "拿铁大杯", food, "餐饮基础");
    const preview = repository.previewProductRename({
      transaction_ids: ids,
      target_product: "拿铁"
    });
    expect(preview).toMatchObject({
      transaction_count: 2,
      month_count: 2,
      target_product: "拿铁"
    });
    expect(preview.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: "拿铁大杯", occurrences: 1 }),
      expect.objectContaining({ product: "拿铁（大杯）", occurrences: 1 })
    ]));
    const result = await repository.applyProductRename({
      transaction_ids: ids,
      target_product: "拿铁",
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    });
    expect(result.updated_count).toBe(2);
    expect(result.revisions).toEqual({ "2026-01": 2, "2026-02": 2 });
    expect((await repository.getMonth("2026-01")).transactions[0]).toMatchObject({
      id: ids[0], product: "拿铁", category_key: food, amount: 20
    });
    expect(repository.rules().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ counterparty: "", product: "拿铁大杯", category_key: food })
    ]));
    expect(manager.connection().prepare(
      "SELECT counterparty FROM auto_rules WHERE product=?"
    ).get("拿铁大杯")).toMatchObject({ counterparty: "商户甲" });
    const counterpartyPreview = repository.previewCounterpartyRename({
      transaction_ids: ids,
      target_counterparty: "商户甲统一"
    });
    expect(counterpartyPreview).toMatchObject({
      transaction_count: 2,
      month_count: 2,
      target_counterparty: "商户甲统一"
    });
    const counterpartyResult = await repository.applyCounterpartyRename({
      transaction_ids: ids,
      target_counterparty: counterpartyPreview.target_counterparty,
      expected_month_revisions: Object.fromEntries(
        counterpartyPreview.months.map((month) => [month.month, month.revision])
      )
    });
    expect(counterpartyResult.updated_count).toBe(2);
    expect((await repository.getMonth("2026-01")).transactions[0].counterparty).toBe("商户甲统一");
    expect(repository.operationLogs(10)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "history-product-rename",
        actor: "local-user",
        success_count: 2
      }),
      expect.objectContaining({
        operation_type: "history-counterparty-rename",
        actor: "local-user",
        success_count: 2
      })
    ]));
    const operation = repository.operationLogs(1)[0];
    expect(operation.operation_type).toBe("history-counterparty-rename");
    expect(repository.operationDetails(operation.operation_id)).toMatchObject({
      actor: "local-user",
      metadata: { target_counterparty: "商户甲统一" }
    });
    await expect(repository.applyProductRename({
      transaction_ids: ids,
      target_product: "咖啡",
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    })).rejects.toMatchObject({ status: 409 });
  });
});
