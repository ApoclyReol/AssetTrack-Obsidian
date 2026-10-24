import type { RuleMatchExplanation } from "../types/rules";

export function readRuleRewriteMode(value: unknown): "preserve" | "clear" {
  return value === "clear" ? "clear" : "preserve";
}

/** Blank rewrite values follow one explicit policy across rule application paths. */
export function rewriteRuleFields(rule: Pick<RuleMatchExplanation, "rewrite_merchant" | "rewrite_product" | "rewrite_empty_mode">,
  row: { counterparty?: string; product: string }): { counterparty: string; product: string } {
  const preserve = rule.rewrite_empty_mode !== "clear";
  return {
    counterparty: rule.rewrite_merchant?.trim() || (preserve ? row.counterparty ?? "" : ""),
    product: rule.rewrite_product?.trim() || (preserve ? row.product : "")
  };
}
