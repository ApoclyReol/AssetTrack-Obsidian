import type { SavedRule } from "../../types/rules";
import { detectRewriteChains, findRuleConflicts } from "../../domain/rules";
import { formatRuleAmount } from "../ruleAmountFormat";
import { t } from "../../i18n";

export function ruleConflictMessages(rules: SavedRule[]): Array<{ key: string; indexes: number[]; message: string }> {
  const reference = (index: number) => {
    const rule = rules[index];
    const identity = rule.id ? `#${rule.id}` : t(`新规则 ${index + 1}`, `New rule ${index + 1}`);
    const condition = [rule.counterparty, rule.product, formatRuleAmount(rule)].filter(Boolean).join(" / ");
    return `${identity}（${condition} → ${rule.category || t("未分类", "Uncategorized")}）`;
  };
  const conditions = findRuleConflicts(rules).map((conflict) => {
    const indexes = (conflict.rule_rows ?? []).map((row) => row - 1);
    const explanation = conflict.kind === "amount-overlap"
      ? t("金额区间重叠", "Amount ranges overlap") : conflict.kind === "duplicate"
        ? t("匹配条件重复", "Duplicate matching conditions") : t("相同匹配条件指向不同分类", "Identical matching conditions target different categories");
    return { key: `${conflict.kind}:${indexes.join(",")}`, indexes,
      message: `${explanation}：${indexes.map(reference).join(t(" 与 ", " and "))}` };
  });
  const chains = detectRewriteChains(rules).filter((chain) => chain.category_conflict).map((chain) => {
    const indexes = [...new Set([chain.rule_row!, ...(chain.target_rule_rows ?? [])])].map((row) => row - 1);
    return { key: `rewrite:${indexes.join(",")}`, indexes,
      message: `${t("重写结果跨分类冲突", "Rewrite results cross categories")}：${indexes.map(reference).join(" → ")}` };
  });
  return [...conditions, ...chains];
}
