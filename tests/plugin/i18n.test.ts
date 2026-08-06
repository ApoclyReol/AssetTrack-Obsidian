import { afterEach, describe, expect, it } from "vitest";
import { businessLabel, displayError, localeFromLanguage } from "../../src/i18n";
import { AssetTrackError } from "../../src/application/errors";
import { setTestLanguage } from "../mocks/obsidian";

afterEach(() => setTestLanguage("zh-CN"));

describe("locale selection", () => {
  it.each(["zh", "zh-CN", "zh-TW", "ZH-hant"])(
    "uses Chinese for %s",
    (language) => {
      expect(localeFromLanguage(language)).toBe("zh-CN");
    }
  );

  it.each(["en", "en-US", "fr", ""])(
    "falls back to English for %s",
    (language) => {
      expect(localeFromLanguage(language)).toBe("en");
    }
  );

  it("translates validation and import errors in English", () => {
    setTestLanguage("en-US");
    expect(displayError(new Error("日期必须是 YYYY-MM-DD 或 YYYY/MM/DD"))).toBe(
      "Date must use YYYY-MM-DD or YYYY/MM/DD."
    );
    expect(displayError(new Error("请选择有效的金额列"))).toBe(
      "Select a valid amount column."
    );
    expect(displayError(new Error("金额不能为负数"))).toBe(
      "Amount cannot be negative."
    );
    expect(displayError(new Error("商品回溯至少选择一个筛选条件后再加载"))).toBe(
      "Choose at least one product-history filter before loading."
    );
    expect(displayError(new Error("请先保存或删除草稿月份 2026-08"))).toBe(
      "Save or delete draft month 2026-08 first."
    );
    expect(displayError(new Error("数据库正在恢复，请稍后重试"))).toBe(
      "The database is being restored. Try again shortly."
    );
    expect(displayError(new Error("分类“餐饮”已有不匹配的历史引用，不能改变收支类型"))).toBe(
      "Category “餐饮” has incompatible historical references, so its transaction type cannot be changed."
    );
    expect(displayError(new Error(
      "分类“餐饮”仍有 2 条历史流水和 1 条规则引用，不能删除"
    ))).toBe(
      "Category “餐饮” still has 2 historical transactions and 1 rule reference, so it cannot be deleted."
    );
    expect(displayError(new Error(
      "同一收支类型和商品下不能存在重复规则"
    ))).toBe(
      "Duplicate rules are not allowed for the same transaction type and item."
    );
    expect(displayError(new Error(
      "借款未来 2026-08-15 已还清，不可修改此月借款。"
    ))).toBe(
      "This debt was already paid on 2026-08-15; it cannot be changed from this month."
    );
  });

  it("translates structured errors from their codes and parameters", () => {
    setTestLanguage("en-US");
    expect(displayError(new AssetTrackError({
      code: "month.invalid",
      params: { month: "2026-13" }
    }))).toBe("Invalid month: 2026-13.");
    expect(displayError(new AssetTrackError({
      code: "csv.mapping_required",
      params: { field: "amount_column" }
    }))).toBe("Choose a valid amount column.");
    expect(displayError(new AssetTrackError({
      code: "ai.http_error",
      params: { status: 429 }
    }))).toBe("The AI API returned HTTP 429.");
  });

  it("does not leak unmapped Chinese system errors in English", () => {
    setTestLanguage("en-US");
    expect(displayError(new Error("尚未映射的系统内部错误"))).toBe(
      "Asset Track could not complete this operation."
    );
  });

  it("localizes anomaly explanations without replacing user item names", () => {
    setTestLanguage("en-US");
    expect(displayError("相机：过去 12 个月未出现的大额商品")).toBe(
      "相机: Large item not seen in the previous 12 months."
    );
    expect(displayError("¥300.0（上月30.0%，三月20.0%）")).toBe(
      "¥300.0 (previous month 30.0%, three-month average 20.0%)"
    );
  });

  it("unwraps nested JavaScript errors before translating them", () => {
    setTestLanguage("en-US");
    expect(displayError("Error: API 不完整")).toBe(
      "The node:sqlite API is incomplete."
    );
  });

  it("keeps business labels bilingual", () => {
    setTestLanguage("en-US");
    expect(businessLabel("警告")).toBe("Warning");
    expect(businessLabel("错误")).toBe("Error");
    expect(businessLabel("空")).toBe("(empty)");
    expect(businessLabel("少收入")).toBe("Income under-recorded");
    expect(businessLabel("少支出")).toBe("Expense under-recorded");
    expect(businessLabel("平账")).toBe("Reconciled");
  });
});
