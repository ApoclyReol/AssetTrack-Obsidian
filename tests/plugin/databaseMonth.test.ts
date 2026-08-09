import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

describe("month repository", () => {

  it("rejects invalid month reads instead of returning an empty workspace", async () => {
    const { repository } = fixture();
    await expect(repository.getMonth("2026-1")).rejects.toMatchObject({
      code: "month.invalid"
    });
    expect(() => repository.monthOverview("2026-1")).toThrowError("month.invalid");
  });

  it("rejects partial account balance replacements before deleting existing balances", async () => {
    const { repository } = fixture();
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 10, market_value: 12, cash_balance: 1 }],
      [],
      []
    );
    await expect(repository.saveMonthSection("2026-01", {
      expected_revision: saved.revision,
      section: "assets",
      cash_accounts: [],
      investment_accounts: saved.investment_accounts
    })).rejects.toMatchObject({ code: "account.cash_missing" });
    const month = await repository.getMonth("2026-01");
    expect(month.cash_accounts[0].balance).toBe(100);
    expect(month.investment_accounts[0].principal).toBe(10);
  });

it("saves an entire month once and protects its revision", async () => {
    const { repository } = fixture();
    const category = categoryKey("餐饮基础");
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 1020 }],
      [{
        account_key: "investment-default",
        principal: 500,
        market_value: 520,
        cash_balance: 10
      }],
      [{
        client_id: "tx-1",
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: category,
        category: "餐饮基础",
        product: "午餐",
        amount: 20.126
      }],
      [{
        client_id: "asset-1",
        asset_key: "phone",
        asset_name: "手机",
        category: "电子设备",
        purchase_price: 3000,
        status: "在用",
        note: ""
      }]
    );
    expect(saved.revision).toBe(1);
    expect(saved.transactions[0].amount).toBe(20.13);
    await expect(repository.saveMonth(
      "2026-01",
      0,
      saved.cash_accounts,
      saved.investment_accounts,
      saved.transactions,
      saved.fixed_assets
    )).rejects.toMatchObject({ status: 409 });
    expect((await repository.getMonth("2026-01")).cash_accounts[0].balance).toBe(1020);
  });

it("saves month sections independently while preserving other sections", async () => {
    const { repository } = fixture();
    const category = categoryKey("餐饮基础");
    const initial = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      [{ account_key: "investment-default", principal: 200, market_value: 210, cash_balance: 5 }],
      [{
        client_id: "tx-1",
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: category,
        category: "餐饮基础",
        product: "午餐",
        amount: 20
      }],
      [{
        client_id: "asset-1",
        asset_key: "phone",
        asset_name: "手机",
        category: "电子设备",
        purchase_price: 3000,
        status: "在用",
        note: ""
      }]
    );

    const assets = await repository.saveMonthSection("2026-01", {
      expected_revision: initial.revision,
      section: "assets",
      cash_accounts: [{ account_key: "cash-default", balance: 800 }],
      investment_accounts: initial.investment_accounts
    });
    expect(assets.cash_accounts[0].balance).toBe(800);
    expect(assets.transactions[0].amount).toBe(20);
    expect(assets.fixed_assets[0].asset_name).toBe("手机");

    const transactions = await repository.saveMonthSection("2026-01", {
      expected_revision: assets.revision,
      section: "transactions",
      transactions: [{
        ...assets.transactions[0],
        amount: 35
      }]
    });
    expect(transactions.transactions[0].amount).toBe(35);
    expect(transactions.cash_accounts[0].balance).toBe(800);
    expect(transactions.fixed_assets[0].asset_name).toBe("手机");

    const fixedAssets = await repository.saveMonthSection("2026-01", {
      expected_revision: transactions.revision,
      section: "fixed_assets",
      fixed_assets: [{
        ...transactions.fixed_assets[0],
        asset_name: "新手机"
      }]
    });
    expect(fixedAssets.fixed_assets[0].asset_name).toBe("新手机");
    expect(fixedAssets.transactions[0].amount).toBe(35);

    const debtRevision = fixedAssets.debt_revision;
    const debts = await repository.saveMonthSection("2026-01", {
      expected_revision: fixedAssets.revision,
      section: "debts",
      debt_revision: debtRevision,
      debts: [{
        description: "临时借款",
        counterparty: "朋友",
        amount: 100,
        start_date: "2026-01-01",
        is_paid: false,
        paid_date: null
      }]
    });
    expect(debts.debts[0].description).toBe("临时借款");
    expect(debts.cash_accounts[0].balance).toBe(800);
    expect(debts.transactions[0].amount).toBe(35);

    await expect(repository.saveMonthSection("2026-01", {
      expected_revision: assets.revision,
      section: "assets",
      cash_accounts: assets.cash_accounts,
      investment_accounts: assets.investment_accounts
    })).rejects.toMatchObject({ status: 409 });
  });

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

it("rolls back all month tables when transaction validation fails", async () => {
    const { repository } = fixture();
    await expect(repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 9999 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "2026-01-01",
        type: "bad",
        category: "",
        product: "坏数据",
        amount: 1
      }],
      []
    )).rejects.toMatchObject({ status: 422 });
    const month = await repository.getMonth("2026-01");
    expect(month.revision).toBe(0);
    expect(month.cash_accounts[0].balance).toBe(0);
  });

it("persists warning-only transactions and restores their warnings", async () => {
    const { repository } = fixture();
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "",
        type: "支出",
        category: "",
        product: "",
        amount: 0
      }],
      []
    );
    expect(saved.transactions[0]).toMatchObject({
      transaction_date: "2026-01-01",
      category: "",
      product: "",
      amount: 0
    });
    const issues = repository.validateTransactionRows("2026-01", saved.transactions);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "商品", severity: "警告", blocking: false }),
      expect.objectContaining({ field: "金额", severity: "警告", blocking: false }),
      expect.objectContaining({ field: "分类", severity: "警告", blocking: false })
    ]));
    expect((await repository.getMonth("2026-01")).transactions[0]).toMatchObject({
      transaction_date: "2026-01-01",
      amount: 0
    });
  });

it("rejects deleting a category that gained historical references", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户",
        product: "午餐",
        amount: 20
      }],
      []
    );
    const categories = repository.categories();

    await expect(repository.saveCategories(
      categories.revision,
      categories.rows.filter((row) => row.category_key !== food)
    )).rejects.toMatchObject({
      code: "category.delete_referenced",
      params: { name: "餐饮基础", transaction_count: 1, rule_count: 0 }
    });
    expect(repository.categories().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category_key: food,
        name: "餐饮基础",
        is_active: true
      })
    ]));
  });

it("rejects malformed date or amount before writing any month rows", async () => {
    const { repository } = fixture();
    await expect(repository.saveMonth(
      "2026-02",
      0,
      [{ account_key: "cash-default", balance: 999 }],
      [{
        account_key: "investment-default",
        principal: 0,
        market_value: 0,
        cash_balance: 0
      }],
      [{
        transaction_date: "not-a-date",
        type: "支出",
        category: "",
        product: "错误日期",
        amount: "not-a-number" as unknown as number
      }],
      []
    )).rejects.toMatchObject({ status: 422 });
    const month = await repository.getMonth("2026-02");
    expect(month.revision).toBe(0);
    expect(month.cash_accounts[0].balance).toBe(0);
    expect(month.transactions).toHaveLength(0);
  });

it("requires an explicit investment account when multiple accounts exist", async () => {
    const { manager, repository } = fixture();
    manager.connection().prepare(`
      INSERT INTO account_definitions
        (account_key,name,account_type,is_active,sort_order)
      VALUES ('investment-b','第二理财账户','investment',1,1)
    `).run();

    await expect(repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [
        { account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 },
        { account_key: "investment-b", principal: 0, market_value: 0, cash_balance: 0 }
      ],
      [{
        transaction_date: "2026-01-01",
        type: "加仓",
        category: "",
        product: "加仓",
        amount: 10
      }],
      []
    )).rejects.toMatchObject({ code: "transaction.validation_failed" });
    expect((await repository.getMonth("2026-01")).transactions).toHaveLength(0);
  });

it("serializes concurrent saves and accepts only one stale revision", async () => {
    const { repository } = fixture();
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const results = await Promise.allSettled([
      repository.saveMonth(
        "2026-01",
        0,
        [{ account_key: "cash-default", balance: 100 }],
        investment,
        [],
        []
      ),
      repository.saveMonth(
        "2026-01",
        0,
        [{ account_key: "cash-default", balance: 200 }],
        investment,
        [],
        []
      )
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.getMonth("2026-01")).revision).toBe(1);
  });

it("protects locked months from edits and deletion", async () => {
    const { manager, repository } = fixture();
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [],
      []
    );
    manager.connection().prepare(
      "UPDATE month_status SET status='locked',locked_at=? WHERE month=?"
    ).run("2026-01-31", "2026-01");

    await expect(repository.saveMonthSection("2026-01", {
      expected_revision: saved.revision,
      section: "assets",
      cash_accounts: [{ account_key: "cash-default", balance: 200 }],
      investment_accounts: saved.investment_accounts
    })).rejects.toMatchObject({ code: "month.locked" });
    await expect(repository.deleteMonth("2026-01", saved.revision))
      .rejects.toMatchObject({ code: "month.locked" });
    expect((await repository.getMonth("2026-01")).cash_accounts[0].balance).toBe(100);
  });
});
