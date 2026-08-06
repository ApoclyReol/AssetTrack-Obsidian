import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";
import { previewTransactionOperation } from "../../src/domain/transactionOperations";
describe("operation repository", () => {

it("rechecks operation revision, selection, and transaction identity before saving", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const initial = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户",
        product: "原商品",
        amount: 20
      }],
      []
    );
    const rulesRevision = repository.rules().revision;
    const preview = previewTransactionOperation(
      initial.transactions,
      {
        month: "2026-01",
        operation_type: "bulk-edit-product",
        transaction_ids: [initial.transactions[0].id!],
        expected_revision: initial.revision,
        rules_revision: rulesRevision,
        source_page: "记录/流水",
        target_value: "新商品"
      }
    );
    const selection = [preview.preview.changes[0].transaction_key!];
    const saveWithLog = (pendingPreview: typeof preview.preview, pendingSelection = selection) =>
      repository.saveMonthSection("2026-01", {
        expected_revision: initial.revision,
        section: "transactions",
        transactions: preview.rows,
        operation_logs: [{ preview: pendingPreview, selection: pendingSelection }]
      });

    await expect(saveWithLog(preview.preview, ["id:999"])).rejects.toMatchObject({
      code: "operation.preview_selection_mismatch"
    });
    const missingTransactionPreview = {
      ...preview.preview,
      metadata: {
        ...preview.preview.metadata,
        transaction_ids: [999],
        transaction_keys: ["id:999"]
      },
      changes: preview.preview.changes.map((change) => ({
        ...change,
        transaction_id: 999,
        transaction_key: "id:999"
      }))
    };
    await expect(saveWithLog(missingTransactionPreview, ["id:999"])).rejects.toMatchObject({
      code: "operation.preview_row_deleted"
    });

    const currentRules = repository.rules();
    await repository.saveRules(currentRules.revision, [
      ...currentRules.rows,
      {
        transaction_type: "支出" as const,
        match_scope: "product" as const,
        counterparty: "",
        product: "规则 revision 测试",
        category_key: food,
        category: "餐饮基础"
      }
    ]);
    await expect(saveWithLog(preview.preview)).rejects.toMatchObject({ status: 409 });
    expect((await repository.getMonth("2026-01")).transactions[0].product).toBe("原商品");
  });

it("allows a category operation preview to clear a classification", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const initial = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户",
        product: "原商品",
        amount: 20
      }],
      []
    );
    const preview = previewTransactionOperation(initial.transactions, {
      month: "2026-01",
      operation_type: "bulk-edit-category",
      transaction_ids: [initial.transactions[0].id!],
      expected_revision: initial.revision,
      source_page: "记录/流水",
      target_category_key: null,
      target_value: ""
    });
    const saved = await repository.saveMonthSection("2026-01", {
      expected_revision: initial.revision,
      section: "transactions",
      transactions: preview.rows,
      operation_logs: [{
        preview: preview.preview,
        selection: [preview.preview.changes[0].transaction_key!]
      }]
    });
    expect(saved.transactions[0]).toMatchObject({ category_key: null, category: "" });
  });

it("rejects mixed transaction types in one category operation", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const income = categoryKey("工资收入");
    const initial = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [
        {
          transaction_date: "2026-01-01",
          type: "支出",
          category_key: food,
          category: "餐饮基础",
          counterparty: "商户",
          product: "原商品",
          amount: 20
        },
        {
          transaction_date: "2026-01-02",
          type: "收入",
          category_key: income,
          category: "工资收入",
          counterparty: "单位",
          product: "工资",
          amount: 100
        }
      ],
      []
    );
    const preview = previewTransactionOperation(initial.transactions, {
      month: "2026-01",
      operation_type: "bulk-edit-category",
      transaction_ids: initial.transactions.map((row) => row.id!),
      expected_revision: initial.revision,
      source_page: "记录/流水",
      target_category_key: null,
      target_value: ""
    });
    await expect(repository.saveMonthSection("2026-01", {
      expected_revision: initial.revision,
      section: "transactions",
      transactions: preview.rows,
      operation_logs: [{
        preview: preview.preview,
        selection: preview.preview.changes.map((change) => change.transaction_key!)
      }]
    })).rejects.toMatchObject({ code: "transaction.category.mixed_types" });
  });

it("validates consecutive operation logs against their virtual preceding rows", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const initial = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户",
        product: "原商品",
        amount: 20
      }],
      []
    );
    const id = initial.transactions[0].id!;
    const first = previewTransactionOperation(initial.transactions, {
      month: "2026-01",
      operation_type: "bulk-edit-product",
      transaction_ids: [id],
      expected_revision: initial.revision,
      source_page: "记录/流水",
      target_value: "中间商品"
    });
    const second = previewTransactionOperation(first.rows, {
      month: "2026-01",
      operation_type: "bulk-edit-product",
      transaction_ids: [id],
      expected_revision: initial.revision,
      source_page: "记录/流水",
      target_value: "最终商品"
    });
    const selection = [first.preview.changes[0].transaction_key!];

    const saved = await repository.saveMonthSection("2026-01", {
      expected_revision: initial.revision,
      section: "transactions",
      transactions: second.rows,
      operation_logs: [
        { preview: first.preview, selection },
        { preview: second.preview, selection }
      ]
    });

    expect(saved.transactions[0].product).toBe("最终商品");
    expect(repository.operationLogs(10)).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_id: first.preview.operation_id, success_count: 1 }),
      expect.objectContaining({ operation_id: second.preview.operation_id, success_count: 1 })
    ]));
    const details = repository.operationDetails(second.preview.operation_id) as {
      changes?: Array<{ before?: Record<string, unknown>; after?: Record<string, unknown> }>;
    } | null;
    expect(details?.changes?.[0]).toMatchObject({
      before: { product: "中间商品" },
      after: { product: "最终商品" }
    });
  });

it("only accepts operation logs with the transactions section", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const initial = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户",
        product: "原商品",
        amount: 20
      }],
      []
    );
    const preview = previewTransactionOperation(initial.transactions, {
      month: "2026-01",
      operation_type: "bulk-edit-product",
      transaction_ids: [initial.transactions[0].id!],
      expected_revision: initial.revision,
      source_page: "记录/流水",
      target_value: "新商品"
    });
    await expect(repository.saveMonthSection("2026-01", {
      expected_revision: initial.revision,
      section: "assets",
      cash_accounts: initial.cash_accounts,
      investment_accounts: initial.investment_accounts,
      operation_logs: [{
        preview: preview.preview,
        selection: [preview.preview.changes[0].transaction_key!]
      }]
    })).rejects.toMatchObject({ code: "operation.logs_section_required" });
    expect((await repository.getMonth("2026-01")).revision).toBe(initial.revision);
    expect(repository.operationLogs(10)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_id: preview.preview.operation_id })
    ]));
  });
});
