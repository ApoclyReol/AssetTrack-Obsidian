import { describe, expect, it } from "vitest";
import {
  formatMoney,
  isCurrencyCode,
  signedMoneyValue
} from "../../src/domain/moneyFormat";

describe("money formatting", () => {
  it("uses Intl currency and semantic transaction signs", () => {
    const options = {
      locale: "en" as const,
      currency: "USD",
      currencyFormat: "standard" as const
    };
    expect(formatMoney(12.34, options, "收入")).toBe("$12.3");
    expect(formatMoney(12.34, options, "支出")).toBe("-$12.3");
    expect(signedMoneyValue(12, "提现")).toBe(12);
    expect(signedMoneyValue(12, "加仓")).toBe(-12);
  });

  it("validates ISO-style currency codes through Intl", () => {
    expect(isCurrencyCode("CNY")).toBe(true);
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("yuan")).toBe(false);
  });
});
