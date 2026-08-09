import type {
  CategoryDefinition
} from "../types/configuration";
import type {
  Transaction
} from "../types/transactions";
import { normalizeDate } from "./dates";

export type ValidationSeverity = "警告" | "错误";

export interface ValidationIssue extends Record<string, unknown> {
  severity: ValidationSeverity;
  blocking: boolean;
  type: string;
  product: string;
  field: string;
  issue: string;
  suggestion: string;
  row_index?: number;
}

function issue(
  row: Partial<Transaction>,
  rowIndex: number,
  field: string,
  message: string,
  suggestion: string,
  severity: ValidationSeverity = "警告"
): ValidationIssue {
  return {
    severity,
    blocking: severity === "错误",
    row_index: rowIndex,
    type: String(row.type ?? "").trim() || "-",
    product: String(row.product ?? "").trim() || "(空商品)",
    field,
    issue: message,
    suggestion
  };
}

export function validateTransactions(
  rows: Array<Partial<Transaction>>,
  month: string,
  categories: CategoryDefinition[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byKey = new Map(categories.map((row) => [row.category_key, row]));
  const byName = new Map(categories.map((row) => [row.name, row]));
  const validTypes = new Set(["支出", "收入", "代付", "加仓", "提现"]);

  rows.forEach((row, index) => {
    const rawDate = String(row.transaction_date ?? "").trim();
    if (rawDate) {
      try {
        const date = normalizeDate(rawDate);
        if (date.slice(0, 7) !== month) {
          issues.push(issue(
            row,
            index,
            "日期",
            `日期不属于当前月份 ${month}`,
            "修改日期后再保存；系统不会自动移动跨月流水",
            "错误"
          ));
        }
      } catch {
        issues.push(issue(
          row,
          index,
          "日期",
          `无法识别日期：${rawDate}`,
          "使用 YYYY-MM-DD、YYYY/MM/DD 或中文年月日",
          "错误"
        ));
      }
    }
    if (!String(row.product ?? "").trim()
      && String(row.type ?? "").trim() !== "加仓"
      && String(row.type ?? "").trim() !== "提现") {
      issues.push(issue(
        row,
        index,
        "商品",
        "商品为空",
        "补充商品说明，方便后续分类和排查"
      ));
    }
    const rawAmount: unknown = row.amount;
    const amountMissing = rawAmount === null
      || rawAmount === undefined
      || (typeof rawAmount === "string" && !rawAmount.trim());
    const amount = Number(rawAmount);
    if (amountMissing || !Number.isFinite(amount)) {
      issues.push(issue(row, index, "金额", "金额无法识别", "改为纯数字金额", "错误"));
    } else if (amount < 0) {
      issues.push(issue(row, index, "金额", "金额不能为负数", "填写正数金额；系统会按流水类型表达收支方向", "错误"));
    } else if (amount === 0) {
      issues.push(issue(row, index, "金额", "金额为 0", "确认这是否是需要保留的占位流水", "警告"));
    }

    const type = String(row.type ?? "").trim();
    if (!validTypes.has(type)) {
      issues.push(issue(
        row,
        index,
        "收支",
        `无效收支类型：${type || "空"}`,
        "请选择支出、收入、代付、加仓或提现",
        "错误"
      ));
      return;
    }
    const categoryKey = String(row.category_key ?? "").trim();
    const category = String(row.category ?? "").trim();
    const categoryType = type === "代付" ? "支出" : type;
    if (type === "支出" || type === "收入" || type === "代付") {
      const definition = byKey.get(categoryKey) ?? byName.get(category);
      if (!definition) {
        if (type !== "代付" || category || categoryKey) {
          issues.push(issue(
            row,
            index,
            "分类",
            `${type}未选择有效分类`,
            `请选择一个已启用的${type === "代付" ? "支出" : type}分类`
          ));
        }
      } else if (!definition.is_active) {
        issues.push(issue(
          row,
          index,
          "分类",
          `${type}使用了已停用分类`,
          `请选择一个已启用的${type}分类`,
          "错误"
        ));
      } else if (definition.transaction_type !== categoryType) {
        issues.push(issue(
          row,
          index,
          "分类",
          `${type}使用了不匹配的分类`,
          `请选择${type}类分类`,
          "错误"
        ));
      }
    } else if (category || categoryKey) {
      issues.push(issue(
        row,
        index,
        "分类",
        "理财流水不能设置分类",
        "加仓、提现的分类必须为空"
      ));
    }
  });
  return issues;
}
