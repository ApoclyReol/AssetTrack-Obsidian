import { useEffect, useState } from "react";
import { t } from "../i18n";

export function parseRuleAmount(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return -2;
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : -2;
}

export function RuleAmountInput({ value, onChange, label }: {
  value?: number | null;
  onChange: (value: number | null) => void;
  label: string;
}) {
  const [text, setText] = useState(value == null || value < 0 ? "" : (value / 100).toFixed(2));
  useEffect(() => {
    if (value != null && value < 0) return;
    if (parseRuleAmount(text) !== (value ?? null)) setText(value == null ? "" : (value / 100).toFixed(2));
  }, [value, text]);
  const invalid = parseRuleAmount(text) === -2;
  return <span>
    <input aria-label={label} aria-invalid={invalid} inputMode="decimal"
      placeholder={t("不限金额", "Any amount")} value={text}
      onChange={(event) => { setText(event.target.value); onChange(parseRuleAmount(event.target.value)); }} />
    {invalid && <small role="alert">{t("请输入非负金额，最多两位小数。", "Enter a non-negative amount with up to two decimal places.")}</small>}
  </span>;
}
