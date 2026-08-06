import { describe, expect, it } from "vitest";
import { validateTransactions } from "../../src/domain/validators";
import type {
  CategoryDefinition
} from "../../src/types/configuration";

const categories: CategoryDefinition[] = [{
  category_key: "cat-food",
  name: "餐饮基础",
  transaction_type: "支出",
  necessity: "必要",
  pattern: "日常",
  is_big_ticket: false,
  color: "#00aaff",
  is_active: true,
  sort_order: 0
}];

describe("transaction validation severity", () => {
  it("keeps safe-to-save issues as warnings", () => {
    const issues = validateTransactions([{
      transaction_date: "",
      type: "支出",
      category_key: null,
      category: "",
      product: "",
      amount: 0
    }], "2026-01", categories);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "商品", severity: "警告", blocking: false }),
      expect.objectContaining({ field: "金额", severity: "警告", blocking: false }),
      expect.objectContaining({ field: "分类", severity: "警告", blocking: false })
    ]));
    expect(issues.some((issue) => issue.blocking)).toBe(false);
  });

  it("blocks unparseable dates, amounts and types", () => {
    const issues = validateTransactions([
      {
        transaction_date: "not-a-date",
        type: "支出",
        category_key: "cat-food",
        category: "餐饮基础",
        product: "午餐",
        amount: 1
      },
      {
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: "cat-food",
        category: "餐饮基础",
        product: "午餐",
        amount: "" as unknown as number
      },
      {
        transaction_date: "2026-01-01",
        type: "未知",
        category: "",
        product: "午餐",
        amount: 1
      }
    ], "2026-01", categories);

    expect(issues.filter((issue) => issue.blocking)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "日期", severity: "错误" }),
      expect.objectContaining({ field: "金额", severity: "错误" }),
      expect.objectContaining({ field: "收支", severity: "错误" })
    ]));
  });

  it("allows uncategorized daifu but validates a provided category", () => {
    const valid = validateTransactions([{
      transaction_date: "2026-01-01",
      type: "代付",
      category_key: null,
      category: "",
      product: "代付午餐",
      amount: 10
    }], "2026-01", categories);
    expect(valid.some((issue) => issue.field === "分类")).toBe(false);

    const invalid = validateTransactions([{
      transaction_date: "2026-01-01",
      type: "代付",
      category_key: "missing",
      category: "不存在",
      product: "代付午餐",
      amount: 10
    }], "2026-01", categories);
    expect(invalid).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "分类", severity: "警告" })
    ]));
  });
});
