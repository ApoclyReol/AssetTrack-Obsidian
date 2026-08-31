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

  it("rejects unknown month section payloads without bumping the revision", async () => {
    const { repository } = fixture();
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [],
      []
    );

    await expect(repository.saveMonthSection("2026-01", {
      expected_revision: saved.revision,
      section: "unknown"
    } as never)).rejects.toMatchObject({ code: "month.section_invalid" });

    const month = await repository.getMonth("2026-01");
    expect(month.revision).toBe(saved.revision);
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
