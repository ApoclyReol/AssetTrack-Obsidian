import { describe, expect, it } from "vitest";
import {
  previewTransactionOperation,
  transactionCategoryType,
  validateTransactionOperationRequest
} from "../../src/domain/transactionOperations";
import type {
  Transaction
} from "../../src/types/transactions";

const rows: Transaction[] = [
  {
    id: 1,
    transaction_date: "2026-01-01",
    type: "支出",
    category_key: "cat-food",
    category: "餐饮",
    counterparty: "商户甲",
    product: "咖啡",
    amount: 20
  },
  {
    id: 2,
    transaction_date: "2026-01-02",
    type: "支出",
    category_key: "cat-food",
    category: "餐饮",
    counterparty: "商户乙",
    product: "水果",
    amount: 30
  },
  {
    id: 3,
    transaction_date: "2026-01-03",
    type: "收入",
    category_key: "cat-income",
    category: "收入",
    counterparty: "单位",
    product: "工资",
    amount: 1000
  }
];

function request(
  operation_type: Parameters<typeof previewTransactionOperation>[1]["operation_type"],
  transaction_ids: number[],
  extra: Partial<Parameters<typeof previewTransactionOperation>[1]> = {}
  ): Parameters<typeof previewTransactionOperation>[1] {
  return {
    month: "2026-01",
    operation_type,
    transaction_ids,
    expected_revision: 1,
    source_page: "记录/流水",
    ...extra
  };
}

describe("transaction operation previews", () => {
  it("uses the expense category namespace for paid-on-behalf rows", () => {
    expect(transactionCategoryType("支出")).toBe("支出");
    expect(transactionCategoryType("代付")).toBe("支出");
    expect(transactionCategoryType("收入")).toBe("收入");
    expect(transactionCategoryType("加仓")).toBeNull();
  });

  it("validates selection and category type contracts before preview generation", () => {
    expect(validateTransactionOperationRequest(rows, request("bulk-edit-product", []))).toEqual([
      { code: "transaction.selection.empty", params: {} }
    ]);
    expect(validateTransactionOperationRequest(rows, request("bulk-edit-category", [1, 3], {
      target_category_key: "cat-food",
      target_value: "餐饮"
    })).map((issue) => issue.code)).toContain("transaction.category.mixed_types");
    expect(validateTransactionOperationRequest(rows, request("bulk-edit-category", [1], {
      target_category_key: "",
      target_value: "未分类"
    })).map((issue) => issue.code)).toContain("transaction.category.invalid_target");
  });

  it("treats paid-on-behalf rows as expense-compatible for category edits", () => {
    const daifuRows = [{ ...rows[0], type: "代付" }];
    expect(validateTransactionOperationRequest(daifuRows, request("bulk-edit-category", [1], {
      target_category_key: "cat-food",
      target_value: "餐饮"
    }))).toEqual([]);
  });

  it("rejects a conversion request containing the wrong source type", () => {
    expect(validateTransactionOperationRequest(rows, request("income-to-daifu", [1]))).toEqual([
      { code: "transaction.conversion.invalid_source", params: { expected: "收入" } }
    ]);
  });

  it("keeps the full draft when editing only selected rows", () => {
    const result = previewTransactionOperation(
      rows,
      request("bulk-edit-product", [2], { target_value: "统一水果" })
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.product)).toEqual(["咖啡", "统一水果", "工资"]);
    expect(result.preview.change_count).toBe(1);
    expect(result.preview.skipped_count).toBe(0);
  });

  it("skips protected rows unless the caller explicitly includes them", () => {
    const protectedPreview = previewTransactionOperation(
      rows,
      request("bulk-edit-counterparty", [1, 2], {
        target_value: "统一商户",
        protected_transaction_ids: [2]
      })
    );
    expect(protectedPreview.rows.map((row) => row.counterparty)).toEqual(["统一商户", "商户乙", "单位"]);
    expect(protectedPreview.preview.protected_count).toBe(1);
    const included = previewTransactionOperation(
      rows,
      request("bulk-edit-counterparty", [1, 2], {
        target_value: "统一商户",
        protected_transaction_ids: [2],
        include_protected: true
      })
    );
    expect(included.rows.map((row) => row.counterparty)).toEqual(["统一商户", "统一商户", "单位"]);
  });

  it("converts only the applicable income type and clears category fields", () => {
    const converted = previewTransactionOperation(
      rows,
      request("income-to-daifu", [3])
    );
    expect(converted.rows[2]).toMatchObject({
      id: 3,
      type: "代付",
      category_key: null,
      category: ""
    });
    expect(converted.rows[0].type).toBe("支出");
    expect(converted.preview.change_count).toBe(1);
    const rejected = previewTransactionOperation(rows, request("income-to-daifu", [1]));
    expect(rejected.preview.skipped_count).toBe(1);
    expect(rejected.preview.changes[0].reason).toContain("只有收入流水");
  });

  it("converts daifu back to income and clears its classification fields", () => {
    const daifuRows: Transaction[] = [{
      ...rows[0],
      type: "代付",
      category_key: "cat-food",
      category: "餐饮",
      counterparty: "商户甲",
      product: "咖啡"
    }];
    const toExpense = previewTransactionOperation(
      daifuRows,
      request("daifu-to-income", [1])
    );
    expect(toExpense.rows[0]).toMatchObject({
      type: "收入",
      category_key: null,
      category: "",
      counterparty: "商户甲",
      product: "咖啡"
    });
  });

  it("allows bulk category edits for daifu rows", () => {
    const daifuRows: Transaction[] = [{
      ...rows[0],
      type: "代付",
      category_key: null,
      category: ""
    }];
    const result = previewTransactionOperation(
      daifuRows,
      request("bulk-edit-category", [1], {
        target_category_key: "cat-food",
        target_value: "餐饮"
      })
    );
    expect(result.rows[0]).toMatchObject({
      type: "代付",
      category_key: "cat-food",
      category: "餐饮"
    });
    expect(result.preview.change_count).toBe(1);
  });

  it("allows batch edits to clear categories, products, and counterparties", () => {
    const categorized = rows[0];
    const category = previewTransactionOperation(
      rows,
      request("bulk-edit-category", [categorized.id!], {
        target_category_key: null,
        target_value: ""
      })
    );
    expect(category.rows[0]).toMatchObject({ category_key: null, category: "" });

    const product = previewTransactionOperation(
      rows,
      request("bulk-edit-product", [categorized.id!], { target_value: "" })
    );
    expect(product.rows[0].product).toBe("");

    const counterparty = previewTransactionOperation(
      rows,
      request("bulk-edit-counterparty", [categorized.id!], { target_value: "" })
    );
    expect(counterparty.rows[0].counterparty).toBe("");
  });

  it("uses one selected rule and reports a conflicting same-priority result", () => {
    const rules = [
      {
        id: 1,
        transaction_type: "支出",
        match_scope: "merchant" as const,
        counterparty: "商户甲",
        product: "",
        category_key: "cat-merchant",
        category: "交易对手分类"
      },
      {
        id: 2,
        transaction_type: "支出",
        match_scope: "product" as const,
        counterparty: "",
        product: "咖啡",
        category_key: "cat-product",
        category: "商品分类"
      },
      {
        id: 3,
        transaction_type: "支出",
        match_scope: "merchant_product" as const,
        counterparty: "商户甲",
        product: "咖啡",
        category_key: "cat-combo",
        category: "组合分类",
        rewrite_product: "拿铁"
      }
    ];
    const result = previewTransactionOperation(
      rows,
      request("apply-rules", [1]),
      rules
    );
    expect(result.rows[0]).toMatchObject({
      category_key: "cat-combo",
      product: "拿铁"
    });
    expect(result.preview.changes[0].rule_ids).toEqual([3, 2, 1]);
    const conflicting = previewTransactionOperation(
      rows,
      request("apply-rules", [1]),
      [
        ...rules,
        { ...rules[2], id: 4, category_key: "cat-other", category: "其他分类" }
      ]
    );
    expect(conflicting.preview.failure_count).toBe(1);
    expect(conflicting.rows[0].category_key).toBe("cat-food");
  });

  it("uses fixed rule priority once without rewriting the rewritten value again", () => {
    const result = previewTransactionOperation(
      rows,
      request("apply-rules", [1]),
      [
        {
          id: 11,
          transaction_type: "支出",
          match_scope: "merchant_product",
          counterparty: "商户甲",
          product: "咖啡",
          category_key: "cat-combo",
          category: "组合分类",
          rewrite_product: "规范商品"
        },
        {
          id: 12,
          transaction_type: "支出",
          match_scope: "product",
          counterparty: "",
          product: "咖啡",
          category_key: "cat-product",
          category: "商品分类"
        },
        {
          id: 13,
          transaction_type: "支出",
          match_scope: "merchant",
          counterparty: "商户甲",
          product: "",
          category_key: "cat-merchant",
          category: "交易对手分类"
        },
        {
          id: 14,
          transaction_type: "支出",
          match_scope: "product",
          counterparty: "",
          product: "规范商品",
          category_key: "cat-second-pass",
          category: "第二轮分类",
          rewrite_product: "不应再次重写"
        }
      ]
    );

    expect(result.rows[0]).toMatchObject({
      product: "规范商品",
      category_key: "cat-combo",
      category: "组合分类"
    });
    expect(result.rows[0].product).not.toBe("不应再次重写");
    expect(result.preview.changes[0].rule_ids).toEqual([11, 12, 13]);
  });

  it("does not silently apply duplicate same-category rules", () => {
    const result = previewTransactionOperation(
      rows,
      request("apply-rules", [1]),
      [
        {
          id: 21,
          transaction_type: "支出",
          match_scope: "product",
          counterparty: "",
          product: "咖啡",
          category_key: "cat-food",
          category: "餐饮"
        },
        {
          id: 22,
          transaction_type: "支出",
          match_scope: "product",
          counterparty: "",
          product: "咖啡",
          category_key: "cat-food",
          category: "餐饮"
        }
      ]
    );
    expect(result.preview.failure_count).toBe(1);
    expect(result.preview.changes[0].reason).toContain("重复规则");
    expect(result.rows[0].category_key).toBe("cat-food");
  });
});
