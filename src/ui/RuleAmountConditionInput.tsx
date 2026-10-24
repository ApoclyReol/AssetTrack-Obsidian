import { useEffect, useState } from "react";
import type { RuleAmountFields } from "../types/rules";
import { EMPTY_RULE_AMOUNT, ruleAmountBounds } from "../domain/ruleAmounts";
import { RuleAmountInput } from "./RuleAmountInput";
import { formatRuleAmount } from "./ruleAmountFormat";
import { t } from "../i18n";

type AmountMode = "any" | "eq" | "lt" | "lte" | "gt" | "gte" | "between";
function amountMode(value: RuleAmountFields): AmountMode {
  if (value.match_amount_minor != null) return "eq";
  if (value.match_amount_min_minor != null && value.match_amount_max_minor != null) return "between";
  if (value.match_amount_min_minor != null) return value.match_amount_min_exclusive ? "gt" : "gte";
  if (value.match_amount_max_minor != null) return value.match_amount_max_exclusive ? "lt" : "lte";
  return "any";
}

export function RuleAmountConditionInput({ value, onChange, label }: {
  value: RuleAmountFields;
  onChange: (value: RuleAmountFields) => void;
  label: string;
}) {
  const [mode, setMode] = useState<AmountMode>(() => amountMode(value));
  const inferred = amountMode(value);
  useEffect(() => { setMode(inferred); }, [inferred]);
  const single = mode === "eq" ? value.match_amount_minor
    : mode === "lt" || mode === "lte" ? value.match_amount_max_minor : value.match_amount_min_minor;
  const changeMode = (next: AmountMode) => {
    setMode(next);
    const number = value.match_amount_minor ?? value.match_amount_min_minor ?? value.match_amount_max_minor ?? -2;
    const fields = { ...EMPTY_RULE_AMOUNT };
    if (next === "eq") fields.match_amount_minor = number;
    else if (next === "lt" || next === "lte") {
      fields.match_amount_max_minor = number; fields.match_amount_max_exclusive = next === "lt";
    } else if (next === "gt" || next === "gte") {
      fields.match_amount_min_minor = number; fields.match_amount_min_exclusive = next === "gt";
    } else if (next === "between") {
      fields.match_amount_min_minor = value.match_amount_min_minor ?? number;
      fields.match_amount_max_minor = value.match_amount_max_minor ?? number;
    }
    onChange(fields);
  };
  return <div className="asset-track-amount-condition">
    <select aria-label={`${label}${t("方式", " mode")}`} value={mode} onChange={(event) => changeMode(event.target.value as AmountMode)}>
      <option value="any">{t("不限金额", "Any amount")}</option>
      <option value="eq">{t("等于 (=)", "Equal to (=)")}</option>
      <option value="lt">{t("低于 (<)", "Less than (<)")}</option>
      <option value="lte">{t("不超过 (≤)", "At most (≤)")}</option>
      <option value="gt">{t("高于 (>)", "Greater than (>)")}</option>
      <option value="gte">{t("至少 (≥)", "At least (≥)")}</option>
      <option value="between">{t("区间", "Between")}</option>
    </select>
    {mode !== "any" && mode !== "between" && <RuleAmountInput value={single} label={label}
      onChange={(number) => onChange({ ...value, ...(mode === "eq" ? { match_amount_minor: number ?? -2 }
        : mode === "lt" || mode === "lte" ? { match_amount_max_minor: number ?? -2 } : { match_amount_min_minor: number ?? -2 }) })} />}
    {mode === "between" && <>
      <label>{t("下限", "Lower bound")}<RuleAmountInput value={value.match_amount_min_minor} label={`${label}${t("下限", " lower bound")}`}
        onChange={(number) => onChange({ ...value, match_amount_min_minor: number ?? -2 })} /></label>
      <label>{t("上限", "Upper bound")}<RuleAmountInput value={value.match_amount_max_minor} label={`${label}${t("上限", " upper bound")}`}
        onChange={(number) => onChange({ ...value, match_amount_max_minor: number ?? -2 })} /></label>
      <label className="asset-track-amount-endpoint"><input type="checkbox" checked={!value.match_amount_min_exclusive}
        onChange={(event) => onChange({ ...value, match_amount_min_exclusive: !event.target.checked })} />{t("包含下限", "Include lower bound")}</label>
      <label className="asset-track-amount-endpoint"><input type="checkbox" checked={!value.match_amount_max_exclusive}
        onChange={(event) => onChange({ ...value, match_amount_max_exclusive: !event.target.checked })} />{t("包含上限", "Include upper bound")}</label>
    </>}
    <small role="status">{formatRuleAmount(value)}</small>
    {!ruleAmountBounds(value) && <small role="alert">{t("请填写有效金额，最多两位小数；上下限不能倒置或形成空区间。", "Enter valid amounts with up to two decimals; reversed or empty intervals are not allowed.")}</small>}
  </div>;
}
