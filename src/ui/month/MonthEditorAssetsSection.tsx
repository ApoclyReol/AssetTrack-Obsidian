import type {
  MonthWorkspace
} from "../../types/month";
import { t } from "../../i18n";
import {
  NumberField,
  number,
  Section
} from "../editorPrimitives";

export function MonthEditorAssetsSection({
  draft,
  onCashBalanceChange,
  onInvestmentChange
}: {
  draft: MonthWorkspace;
  onCashBalanceChange: (index: number, value: number) => void;
  onInvestmentChange: (
    index: number,
    field: "principal" | "market_value" | "cash_balance",
    value: number
  ) => void;
}) {
  return (
    <>
      <Section title={t("现金账户", "Cash accounts")}>
        <div className="asset-track-fields">
          {draft.cash_accounts.map((account, index) => (
            <NumberField
              key={account.account_key}
              label={account.account ?? account.name ?? account.account_key}
              value={account.balance}
              onChange={(value) => onCashBalanceChange(index, number(value))}
            />
          ))}
        </div>
      </Section>
      <Section title={t("理财账户", "Investment accounts")}>
        {draft.investment_accounts.map((account, index) => (
          <div className="asset-track-fields asset-track-investment-row" key={account.account_key}>
            <div className="asset-track-account-name">
              <span>{t("账户", "Account")}</span>
              <strong>{account.name ?? account.account_key}</strong>
            </div>
            {(["principal", "market_value", "cash_balance"] as const).map((field) => (
              <NumberField
                key={field}
                label={{
                  principal: t("本金", "Principal"),
                  market_value: t("市值", "Market value"),
                  cash_balance: t("流动现金", "Liquid cash")
                }[field]}
                value={account[field]}
                onChange={(value) => onInvestmentChange(index, field, number(value))}
              />
            ))}
          </div>
        ))}
      </Section>
    </>
  );
}
