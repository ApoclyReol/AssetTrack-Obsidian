// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { requestUrl } from "../mocks/obsidian";
import { previewAiClassification } from "../../src/services/aiClassification";
import type {
  AssetTrackSettings
} from "../../src/types/settings";
import type {
  CategoryDefinition
} from "../../src/types/configuration";
import type {
  Transaction
} from "../../src/types/transactions";

const category: CategoryDefinition = {
  category_key: "cat-food",
  name: "餐饮基础",
  description: "日常餐饮，不含大件食品采购",
  transaction_type: "支出",
  necessity: "必要",
  pattern: "日常",
  is_big_ticket: false,
  color: "#fff",
  is_active: true,
  sort_order: 1
};

const row: Transaction = {
  id: 7,
  transaction_date: "2026-01-01",
  type: "支出",
  category_key: null,
  category: "",
  counterparty: "咖啡店",
  product: "拿铁",
  amount: 20
};

const settings: AssetTrackSettings = {
  dataDirectory: "",
  csvMappings: [],
  baseCurrency: "CNY",
  currencyFormat: "standard",
  reconciliationTolerance: 100,
  largeExpenseThreshold: 1000,
  aiEndpoint: "https://example.test/v1",
  aiModel: "local-model",
  aiTimeoutMs: 1000
};

function requestUrlResult(results: unknown[]): void {
  requestUrl.mockResolvedValue({
    status: 200,
    json: { results }
  });
}

describe("AI classification preview", () => {
  beforeEach(() => requestUrl.mockReset());

  it("sends only selected rows and keeps valid results in preview", async () => {
    requestUrlResult([{
      transaction_id: 7,
      category_key: "cat-food",
      rewrite_merchant: null,
      rewrite_product: null,
      status: "classified",
      confidence: 0.92
    }]);
    const result = await previewAiClassification(
      [row],
      {
        month: "2026-01",
        operation_type: "ai-classification",
        transaction_ids: [7],
        expected_revision: 1,
        source_page: "记录/流水"
      },
      [category],
      settings,
      "secret-key"
    );
    expect(requestUrl).toHaveBeenCalledOnce();
    const request = requestUrl.mock.calls[0][0] as { body: string };
    const body = JSON.parse(request.body) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[1].content).toContain("咖啡店");
    expect(body.messages[1].content).toContain("日常餐饮");
    expect(body.messages[1].content).not.toContain("secret-key");
    expect(result.batch.classified_count).toBe(1);
    expect(result.preview.change_count).toBe(1);
    expect(result.rows[0]).toMatchObject({ category_key: "cat-food", category: "餐饮基础" });
  });

  it("allows daifu rows to use expense categories", async () => {
    requestUrlResult([{
      transaction_id: 7,
      category_key: "cat-food",
      rewrite_merchant: null,
      rewrite_product: null,
      status: "classified",
      confidence: 0.9
    }]);
    const result = await previewAiClassification(
      [{ ...row, type: "代付" }],
      {
        month: "2026-01",
        operation_type: "ai-classification",
        transaction_ids: [7],
        expected_revision: 1,
        source_page: "记录/流水",
        business_tab: "incoming"
      },
      [category],
      settings,
      "secret-key"
    );
    const request = requestUrl.mock.calls[0][0] as { body: string };
    expect(request.body).toContain("代付");
    expect(result.batch.classified_count).toBe(1);
    expect(result.rows[0]).toMatchObject({ category_key: "cat-food", category: "餐饮基础" });
  });

  it("turns invalid output into an error without writing a category", async () => {
    requestUrlResult([{
      transaction_id: 7,
      category_key: "cat-food",
      rewrite_merchant: null,
      rewrite_product: null,
      status: "classified",
      confidence: 3
    }]);
    const result = await previewAiClassification(
      [row],
      {
        month: "2026-01",
        operation_type: "ai-classification",
        transaction_ids: [7],
        expected_revision: 1,
        source_page: "记录/流水"
      },
      [category],
      settings,
      "secret-key"
    );
    expect(result.batch.error_count).toBe(1);
    expect(result.preview.failure_count).toBe(1);
    expect(result.rows[0].category_key).toBeNull();
  });

  it("marks a missing per-row response as an error instead of guessing by index", async () => {
    requestUrlResult([{
      transaction_id: 999,
      category_key: "cat-food",
      status: "classified",
      confidence: 0.9
    }]);
    const result = await previewAiClassification(
      [row],
      {
        month: "2026-01",
        operation_type: "ai-classification",
        transaction_ids: [7],
        expected_revision: 1,
        source_page: "记录/流水"
      },
      [category],
      settings,
      "secret-key"
    );
    expect(result.batch.rows[0].error).toContain("未返回");
    expect(result.preview.failure_count).toBe(1);
  });

  it("maps shuffled AI responses by transaction id and key", async () => {
    const secondCategory: CategoryDefinition = {
      ...category,
      category_key: "cat-grocery",
      name: "日用品",
      description: "日常采购"
    };
    const draftRow: Transaction = {
      ...row,
      id: undefined,
      client_id: "draft-8",
      counterparty: "超市",
      product: "水果"
    };
    requestUrlResult([
      {
        transaction_key: "client:draft-8",
        category_key: "cat-grocery",
        rewrite_merchant: null,
        rewrite_product: null,
        status: "classified",
        confidence: 0.88
      },
      {
        transaction_id: 7,
        category_key: "cat-food",
        rewrite_merchant: null,
        rewrite_product: null,
        status: "classified",
        confidence: 0.91
      }
    ]);

    const result = await previewAiClassification(
      [row, draftRow],
      {
        month: "2026-01",
        operation_type: "ai-classification",
        transaction_ids: [7],
        transaction_keys: ["client:draft-8"],
        expected_revision: 1,
        source_page: "记录/流水"
      },
      [category, secondCategory],
      settings,
      "secret-key"
    );

    expect(result.batch.rows).toEqual([
      expect.objectContaining({ transaction_id: 7, category_key: "cat-food" }),
      expect.objectContaining({ transaction_key: "client:draft-8", category_key: "cat-grocery" })
    ]);
    expect(result.rows.map((item) => item.category_key)).toEqual([
      "cat-food",
      "cat-grocery"
    ]);
  });

  it("does not send protected rows until the user includes them", async () => {
    requestUrlResult([{
      transaction_id: 7,
      category_key: "cat-food",
      rewrite_merchant: null,
      rewrite_product: null,
      status: "classified",
      confidence: 0.9
    }]);
    const result = await previewAiClassification(
      [row],
      {
        month: "2026-01",
        operation_type: "ai-classification",
        transaction_ids: [7],
        expected_revision: 1,
        source_page: "记录/流水",
        protected_transaction_ids: [7]
      },
      [category],
      settings,
      "secret-key"
    );
    expect(requestUrl).not.toHaveBeenCalled();
    expect(result.preview.protected_count).toBe(1);
    expect(result.preview.skipped_count).toBe(1);
    expect(result.rows[0]).toMatchObject({ category_key: null });
  });

  it("rejects an empty string rewrite from the AI response", async () => {
    requestUrlResult([{
      transaction_id: 7,
      category_key: "cat-food",
      rewrite_merchant: "",
      rewrite_product: null,
      status: "classified",
      confidence: 0.9
    }]);
    const result = await previewAiClassification(
      [row],
      {
        month: "2026-01",
        operation_type: "ai-classification",
        transaction_ids: [7],
        expected_revision: 1,
        source_page: "记录/流水"
      },
      [category],
      settings,
      "secret-key"
    );
    expect(result.preview.failure_count).toBe(1);
    expect(result.rows[0].category_key).toBeNull();
  });
});
