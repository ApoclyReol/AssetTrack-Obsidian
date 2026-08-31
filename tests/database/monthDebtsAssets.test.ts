import { describe, expect, it } from "vitest";
import { fixture } from "./databaseTestFixtures";

describe("month debt and fixed-asset repository", () => {
  it("projects inherited debts into the month and repays them as fact rows", async () => {
    const { manager, repository } = fixture();
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      []
    );
    manager.connection().prepare(`
      INSERT INTO debt_manager
        (description,counterparty,amount,start_date,is_paid,paid_date)
      VALUES ('信用借款','银行',200,'2026-01-01',0,NULL)
    `).run();

    const january = await repository.getMonth("2026-01");
    const february = await repository.getMonth("2026-02");
    expect(january.debts[0]).toMatchObject({
      description: "信用借款",
      is_paid: false
    });
    expect(february.debts[0]).toMatchObject({
      description: "信用借款",
      is_paid: false
    });

    const saved = await repository.saveMonth(
      "2026-02",
      0,
      [{ account_key: "cash-default", balance: 800 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      [],
      {
        expected_revision: february.debt_revision,
        rows: [{ ...february.debts[0], is_paid: true }]
      }
    );

    expect(saved.debts[0]).toMatchObject({
      is_paid: true,
      paid_date: "2026-02-28"
    });
    expect(saved.overview.reconciliation?.theoretical.debt_change).toBe(-200);
    expect(saved.overview.reconciliation?.discrepancy).toBe(0);
    const earlier = await repository.getMonth("2026-01");
    expect(earlier.debts[0].is_paid).toBe(false);
    expect(earlier.debts[0].paid_date).toBe("2026-02-28");
    await expect(repository.saveMonth(
      "2026-01",
      earlier.revision,
      earlier.cash_accounts,
      earlier.investment_accounts,
      earlier.transactions,
      earlier.fixed_assets,
      {
        expected_revision: earlier.debt_revision,
        rows: [{ ...earlier.debts[0], is_paid: true }]
      }
    )).rejects.toMatchObject({
      code: "debt.future_locked",
      status: 422,
      params: { paid_date: "2026-02-28" }
    });
    await expect(repository.saveMonth(
      "2026-01",
      earlier.revision,
      earlier.cash_accounts,
      earlier.investment_accounts,
      earlier.transactions,
      earlier.fixed_assets,
      {
        expected_revision: earlier.debt_revision,
        rows: []
      }
    )).rejects.toMatchObject({
      code: "debt.future_locked",
      status: 422,
      params: { paid_date: "2026-02-28" }
    });
    expect((await repository.getMonth("2026-03")).debts).toHaveLength(0);
  });

  it("does not let the legacy global debt save remove a future paid fact", async () => {
    const { repository } = fixture();
    const created = await repository.saveDebts(repository.debts().revision, [{
      description: "未来还款",
      counterparty: "银行",
      amount: 200,
      start_date: "2026-01-01",
      is_paid: true,
      paid_date: "2099-01-01"
    }]);
    await expect(repository.saveDebts(created.revision, [])).rejects.toMatchObject({
      code: "debt.future_locked",
      status: 422,
      params: { paid_date: "2099-01-01" }
    });
    expect(repository.debts().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: "未来还款", paid_date: "2099-01-01" })
    ]));
  });

  it("rejects an unpaid debt carrying a paid date", async () => {
    const { repository } = fixture();
    await expect(repository.saveDebts(repository.debts().revision, [{
      description: "状态不一致",
      counterparty: "银行",
      amount: 100,
      start_date: "2026-01-01",
      is_paid: false,
      paid_date: "2026-02-01"
    }])).rejects.toMatchObject({ code: "debt.paid_date_unexpected" });
    expect(repository.debts().rows).toHaveLength(0);
  });

  it("validates fixed-asset dates and statuses instead of silently rewriting them", async () => {
    const { repository } = fixture();
    const base = {
      cash_accounts: [{ account_key: "cash-default", balance: 100 }],
      investment_accounts: [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      transactions: []
    };
    await expect(repository.saveMonth("2026-01", 0, base.cash_accounts, base.investment_accounts, base.transactions, [{
      asset_key: "bad-date",
      asset_name: "错误日期",
      category: "",
      purchase_date: "2026-02-31",
      purchase_price: 10,
      status: "在用",
      note: ""
    }])).rejects.toMatchObject({ code: "fixed_asset.date_invalid", status: 422 });
    await expect(repository.saveMonth("2026-01", 0, base.cash_accounts, base.investment_accounts, base.transactions, [{
      asset_key: "bad-status",
      asset_name: "错误状态",
      category: "",
      purchase_date: "2026-01-01",
      purchase_price: 10,
      status: "未知状态",
      note: ""
    }])).rejects.toMatchObject({ code: "fixed_asset.status_invalid", status: 422 });
    expect(repository.getRevision("2026-01")).toBe(0);
    expect((await repository.getMonth("2026-01")).fixed_assets).toHaveLength(0);
  });

  it("keeps fixed-asset identity stable when an update key conflicts with its id", async () => {
    const { repository } = fixture();
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [],
      [{ asset_key: "phone", asset_name: "手机", category: "", purchase_price: 10, status: "在用", note: "" }]
    );
    await expect(repository.saveMonthSection("2026-01", {
      expected_revision: saved.revision,
      section: "fixed_assets",
      fixed_assets: [{ ...saved.fixed_assets[0], asset_key: "other" }]
    })).rejects.toMatchObject({ code: "fixed_asset.identity_conflict", status: 422 });
    expect((await repository.getMonth("2026-01")).fixed_assets[0]).toMatchObject({
      asset_key: "phone",
      asset_name: "手机"
    });
  });

  it("keeps a same-month borrowed-and-paid debt out of reconciliation", async () => {
    const { repository } = fixture();
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      []
    );
    const february = await repository.getMonth("2026-02");

    const saved = await repository.saveMonth(
      "2026-02",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [],
      [],
      {
        expected_revision: february.debt_revision,
        rows: [{
          description: "周转借款",
          counterparty: "朋友",
          amount: 300,
          start_date: "2026-02-01",
          is_paid: true,
          paid_date: null
        }]
      }
    );

    expect(saved.debts).toHaveLength(1);
    expect(saved.debts[0]).toMatchObject({
      description: "周转借款",
      is_paid: true,
      paid_date: "2026-02-28"
    });
    expect(saved.overview.reconciliation?.theoretical.debt_change).toBe(0);
    expect(saved.overview.reconciliation?.discrepancy).toBe(0);
  });

  it("lists every fixed asset seen during the annual period with its last status", async () => {
    const { repository } = fixture();
    const accounts = [{ account_key: "cash-default", balance: 1000 }];
    const investments = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    await repository.saveMonth(
      "2026-01",
      0,
      accounts,
      investments,
      [],
      [{
        asset_key: "phone",
        asset_name: "手机",
        category: "电子设备",
        purchase_price: 3000,
        status: "在用",
        note: ""
      }]
    );
    await repository.saveMonth(
      "2026-02",
      0,
      [{ account_key: "cash-default", balance: 900 }],
      investments,
      [],
      [
        {
          asset_key: "phone",
          asset_name: "手机",
          category: "电子设备",
          purchase_price: 3000,
          status: "已出售",
          note: ""
        },
        {
          asset_key: "desk",
          asset_name: "书桌",
          category: "家具",
          purchase_price: 800,
          status: "已报废",
          note: ""
        }
      ]
    );

    expect(repository.annual("2026").fixed_assets).toEqual([
      expect.objectContaining({
        asset_key: "desk",
        asset_name: "书桌",
        status: "已报废",
        last_seen_month: "2026-02"
      }),
      expect.objectContaining({
        asset_key: "phone",
        asset_name: "手机",
        status: "已出售",
        last_seen_month: "2026-02"
      })
    ]);
  });
});
