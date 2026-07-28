import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { inspectCsv, previewCsv } from "../../src/domain/csv";

describe("TypeScript CSV mapping", () => {
  it("keeps duplicate rows and reports filtered rows", () => {
    const content = Buffer.from(
      "交易时间,交易对方,商品,交易金额,资金流向,交易状态\n"
      + "2026-01-02 09:00,咖啡店,拿铁,¥12.50,付款,成功\n"
      + "2026-01-02 09:00,咖啡店,拿铁,¥12.50,付款,成功\n"
      + "2026-02-01 09:00,商户甲,跨月记录,20,付款,成功\n"
      + "2026-01-03 09:00,商户乙,失败记录,30,付款,失败\n",
      "utf8"
    );
    const inspection = inspectCsv("2026-01", "generic.csv", content);
    expect(inspection.row_count).toBe(4);
    expect(inspection.suggested_mapping.date_column).toBe("交易时间");
    const preview = previewCsv("2026-01", "generic.csv", content, {
      date_column: "交易时间",
      product_column: "商品",
      counterparty_column: "交易对方",
      amount_column: "交易金额",
      type_column: "资金流向",
      status_column: "交易状态",
      type_values: { "付款": "支出" },
      included_statuses: ["成功"]
    });
    expect(preview.rows.map((row) => row.product)).toEqual(["拿铁", "拿铁"]);
    expect(preview.rows.map((row) => row.counterparty)).toEqual(["咖啡店", "咖啡店"]);
    expect(preview.rows.map((row) => row.amount)).toEqual([12.5, 12.5]);
    expect(preview.import_stats.filtered).toMatchObject({
      outside_month: 1,
      status_filtered: 1
    });
  });

  it("decodes GBK and supports ignored directions", () => {
    const content = Buffer.from(
      "yNXG2izLtcP3LL3wtu4st73P8goyMDI2LTAxLTAxLM/7t9EsMTAs1qcK"
      + "MjAyNi0wMS0wMiyyu7zGLDIwLMbky/sK",
      "base64"
    );
    const preview = previewCsv("2026-01", "generic.csv", content, {
      date_column: "日期",
      product_column: "说明",
      amount_column: "金额",
      type_column: "方向",
      type_values: { "支": "支出", "其他": "忽略" },
      included_statuses: []
    });
    expect(preview.rows).toHaveLength(1);
    expect(preview.import_stats.filtered.ignored_type).toBe(1);
  });

  it.each(["xlsx", "xls"] as const)(
    "reads the first worksheet from %s bills",
    (extension) => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["日期", "交易对方", "商品", "金额", "方向", "状态"],
          ["2026-01-08", "示例商户", "午餐", 38.5, "付款", "完成"]
        ]),
        "账单"
      );
      const content = XLSX.write(workbook, {
        type: "buffer",
        bookType: extension
      }) as Buffer;
      const filename = `bill.${extension}`;
      const inspection = inspectCsv("2026-01", filename, content);
      expect(inspection.distinct_values["状态"]).toEqual(["完成"]);
      const preview = previewCsv("2026-01", filename, content, {
        date_column: "日期",
        counterparty_column: "交易对方",
        product_column: "商品",
        amount_column: "金额",
        type_column: "方向",
        status_column: "状态",
        type_values: { "付款": "支出" },
        included_statuses: ["完成"]
      });
      expect(preview.rows[0]).toMatchObject({
        counterparty: "示例商户",
        product: "午餐",
        amount: 38.5,
        type: "支出"
      });
    }
  );
});
