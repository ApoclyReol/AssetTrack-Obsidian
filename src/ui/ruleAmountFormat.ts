import type { RuleAmountFields } from "../types/rules";
import { ruleAmountBounds } from "../domain/ruleAmounts";
import { t } from "../i18n";

export function formatRuleAmount(value: RuleAmountFields): string {
  const bounds = ruleAmountBounds(value);
  if (!bounds) return t("金额条件未完成", "Incomplete amount condition");
  const money = (amount: number) => (amount / 100).toFixed(2);
  if (value.match_amount_minor != null) return `= ${money(value.match_amount_minor)}`;
  const min = value.match_amount_min_minor;
  const max = value.match_amount_max_minor;
  if (min != null && max != null) return `${value.match_amount_min_exclusive ? "(" : "["}${money(min)}, ${money(max)}${value.match_amount_max_exclusive ? ")" : "]"}`;
  if (min != null) return `${value.match_amount_min_exclusive ? ">" : "≥"} ${money(min)}`;
  if (max != null) return `${value.match_amount_max_exclusive ? "<" : "≤"} ${money(max)}`;
  return t("不限金额", "Any amount");
}
