import { describe, expect, it } from "vitest";
import { parseAssetTrackSettings } from "../../src/services/settingsValidation";

describe("settings validation", () => {
  it("normalizes valid settings and mapping profiles", () => {
    const result = parseAssetTrackSettings({
      dataDirectory: " 财务//Asset_Track/ ",
      csvMappings: [{
        header_signature: "abc",
        updated_at: "2026-07-29T00:00:00.000Z",
        mapping: {
          date_column: "日期",
          product_column: "商品",
          amount_column: "金额",
          type_column: "类型",
          type_values: { 支出: "支出" },
          included_statuses: []
        }
      }]
    });
    expect(result.issues).toEqual([]);
    expect(result.settings.dataDirectory).toBe("财务/Asset_Track");
    expect(result.settings.csvMappings).toHaveLength(1);
  });

  it("falls back safely for malformed settings", () => {
    const result = parseAssetTrackSettings({
      dataDirectory: "/outside",
      csvMappings: [{ header_signature: "broken" }, null]
    });
    expect(result.settings).toEqual({
      dataDirectory: "",
      csvMappings: [],
      baseCurrency: "CNY",
      currencyFormat: "standard",
      reconciliationTolerance: 100,
      largeExpenseThreshold: 1000,
      aiEndpoint: "",
      aiModel: "",
      aiTimeoutMs: 60000
    });
    expect(result.issues).toHaveLength(3);
  });
});
