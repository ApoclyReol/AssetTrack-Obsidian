import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { DatabaseManager } from "../../src/database/DatabaseManager";
import { AssetTrackRepository } from "../../src/database/AssetTrackRepository";
import { categoryKey } from "../../src/database/schema";
import { roundHalfEven } from "../../src/domain/money";

const managers: DatabaseManager[] = [];

function fixture(): {
  manager: DatabaseManager;
  repository: AssetTrackRepository;
  path: string;
} {
  const root = mkdtempSync(join(tmpdir(), "asset-track-ts-"));
  const path = join(root, "中文 账本", "accounting_system.db");
  const manager = new DatabaseManager(path);
  managers.push(manager);
  const repository = new AssetTrackRepository(manager);
  repository.initialize();
  return { manager, repository, path };
}

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.close());
});

describe("node:sqlite schema 9 repository", () => {
  it("inspects missing and damaged database files without creating or replacing them", () => {
    const root = mkdtempSync(join(tmpdir(), "asset-track-inspect-"));
    const missing = join(root, "accounting_system.db");
    expect(DatabaseManager.inspect(missing)).toEqual({
      exists: false,
      valid: false,
      validation: null,
      error: null
    });
    expect(existsSync(missing)).toBe(false);

    writeFileSync(missing, "not a sqlite database", "utf8");
    const before = readFileSync(missing);
    expect(DatabaseManager.inspect(missing)).toMatchObject({
      exists: true,
      valid: false
    });
    expect(readFileSync(missing)).toEqual(before);
  });

  it("creates and reopens a schema 9 database at a Chinese path", async () => {
    const { manager, repository, path } = fixture();
    expect(manager.validate(true)).toMatchObject({
      valid: true,
      schema_version: 9,
      integrity_check: "ok"
    });
    expect(repository.accounts().rows.map((row) => row.account_key)).toEqual([
      "cash-default",
      "investment-default"
    ]);
    await manager.reopen();
    expect(readFileSync(path, { encoding: null }).subarray(0, 15).toString()).toBe(
      "SQLite format 3"
    );
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
      status: 422,
      message: "借款未来 2026-02-28 已还清，不可修改此月借款。"
    });
    expect((await repository.getMonth("2026-03")).debts).toHaveLength(0);
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
    )).rejects.toThrow(
      "分类“餐饮基础”仍有 1 条历史流水和 0 条规则引用，不能删除"
    );
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

  it("rejects an unsupported schema without modifying it", () => {
    const root = mkdtempSync(join(tmpdir(), "asset-track-schema-"));
    const path = join(root, "schema-7.db");
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE legacy(value INTEGER); PRAGMA user_version=7");
    legacy.close();
    const manager = new DatabaseManager(path);
    managers.push(manager);
    expect(() => manager.open()).toThrow(/schema 9/);
    const inspected = new DatabaseSync(path, { readOnly: true });
    expect(
      (inspected.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    ).toBe(7);
    inspected.close();
  });

  it("matches the synthetic cross-month financial baseline", async () => {
    const { repository } = fixture();
    const wage = categoryKey("工资收入");
    const food = categoryKey("餐饮基础");
    await repository.saveMonth(
      "2025-12",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      [{
        account_key: "investment-default",
        principal: 200,
        market_value: 220,
        cash_balance: 10
      }],
      [
        {
          transaction_date: "2025-12-01",
          type: "收入",
          category_key: wage,
          category: "工资收入",
          product: "工资",
          amount: 5000
        },
        {
          transaction_date: "2025-12-02",
          type: "支出",
          category_key: food,
          category: "餐饮基础",
          product: "餐饮",
          amount: 1000
        },
        {
          transaction_date: "2025-12-03",
          type: "代付",
          category: "",
          product: "代买",
          amount: 100
        },
        {
          transaction_date: "2025-12-04",
          type: "加仓",
          category: "",
          product: "理财转入",
          amount: 200
        },
        {
          transaction_date: "2025-12-05",
          type: "提现",
          category: "",
          product: "理财转出",
          amount: 50
        }
      ],
      []
    );
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 1400 }],
      [{
        account_key: "investment-default",
        principal: 300,
        market_value: 330,
        cash_balance: 20
      }],
      [
        {
          transaction_date: "2026-01-01",
          type: "收入",
          category_key: wage,
          category: "工资收入",
          product: "工资",
          amount: 6000
        },
        {
          transaction_date: "2026-01-02",
          type: "支出",
          category_key: food,
          category: "餐饮基础",
          product: "餐饮",
          amount: 1500
        }
      ],
      []
    );
    const annual = repository.annual("2026");
    expect(annual.latest).toMatchObject({
      total_income: 6000,
      total_expense: 1500,
      total_assets: 1700,
      cost_assets: 1700,
      market_net_assets: 1750,
      savings_rate: 75,
      discrepancy: -4100
    });
    expect(repository.currentAsset()).toMatchObject({
      cost_assets: 1700,
      market_net_assets: 1750,
      total_assets: 1700,
      market_value: 330,
      investment_cash: 20
    });
    expect((await repository.getMonth("2026-01")).overview.investment)
      .toMatchObject({
        comparison: {
          available: true,
          previous_position: 230,
          amount_delta: 120,
          percent_delta: 52.2
        }
      });
  });

  it("summarizes recurring expenses by product without changing schema", async () => {
    const { repository, manager } = fixture();
    const subscription = categoryKey("订阅服务");
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
      [
        {
          transaction_date: "2026-01-02",
          type: "支出",
          category_key: subscription,
          category: "订阅服务",
          counterparty: "平台甲",
          product: "会员",
          amount: 10
        },
        {
          transaction_date: "2026-01-20",
          type: "支出",
          category_key: subscription,
          category: "订阅服务",
          counterparty: "平台乙",
          product: "会员",
          amount: 20
        }
      ],
      []
    );
    expect(repository.annual("2026").recurring_expenses).toEqual([{
      product: "会员",
      category: "订阅服务",
      months_count: 1,
      transaction_count: 2,
      total: 30,
      average_amount: 15,
      latest_amount: 20,
      last_date: "2026-01-20"
    }]);
    expect(manager.validate(false).schema_version).toBe(9);
  });

  it("matches the frozen Python obsidian-v1 golden fixture", async () => {
    const { manager, repository } = fixture();
    const db = manager.connection();
    db.prepare("DELETE FROM account_definitions WHERE account_key='cash-default'").run();
    const account = db.prepare(`
      INSERT INTO account_definitions
        (account_key,name,account_type,is_active,sort_order)
      VALUES (?,?,'cash',1,?)
    `);
    [
      ["cash-boc", "中国银行"],
      ["cash-ccb", "建设银行"],
      ["cash-alipay", "支付宝"],
      ["cash-wechat", "微信"]
    ].forEach(([key, name], index) => account.run(key, name, index));
    const wage = categoryKey("工资收入");
    const home = categoryKey("居住固定");
    const food = categoryKey("餐饮基础");
    const traffic = categoryKey("交通通勤");
    await repository.saveMonth(
      "2025-12",
      0,
      [
        { account_key: "cash-boc", balance: 600 },
        { account_key: "cash-ccb", balance: 200 },
        { account_key: "cash-alipay", balance: 150 },
        { account_key: "cash-wechat", balance: 50 }
      ],
      [{
        account_key: "investment-default",
        principal: 200,
        market_value: 220,
        cash_balance: 10
      }],
      [
        {
          transaction_date: "2025-12-01", type: "收入",
          category_key: wage, category: "工资收入", product: "工资", amount: 5000
        },
        {
          transaction_date: "2025-12-02", type: "支出",
          category_key: home, category: "居住固定", product: "房租", amount: 1000
        },
        {
          transaction_date: "2025-12-03", type: "代付",
          category: "", product: "代买", amount: 100
        },
        {
          transaction_date: "2025-12-04", type: "加仓",
          category: "", product: "理财转入", amount: 200
        },
        {
          transaction_date: "2025-12-05", type: "提现",
          category: "", product: "理财转出", amount: 50
        }
      ],
      [
        {
          asset_key: "phone-a", asset_name: "手机", category: "电子设备",
          purchase_price: 5000, status: "在用", note: ""
        },
        {
          asset_key: "phone-b", asset_name: "手机", category: "电子设备",
          purchase_price: 3000, status: "闲置", note: ""
        }
      ]
    );
    await repository.saveMonth(
      "2026-01",
      0,
      [
        { account_key: "cash-boc", balance: 800 },
        { account_key: "cash-ccb", balance: 250 },
        { account_key: "cash-alipay", balance: 250 },
        { account_key: "cash-wechat", balance: 100 }
      ],
      [{
        account_key: "investment-default",
        principal: 300,
        market_value: 330,
        cash_balance: 20
      }],
      [
        {
          transaction_date: "2026-01-01", type: "收入",
          category_key: wage, category: "工资收入", product: "工资", amount: 6000
        },
        {
          transaction_date: "2026-01-02", type: "支出",
          category_key: food, category: "餐饮基础", product: "餐饮", amount: 1500
        }
      ],
      (await repository.getMonth("2026-01")).fixed_assets
    );
    db.prepare(`
      INSERT INTO debt_manager
        (description,counterparty,amount,start_date,is_paid,paid_date)
      VALUES ('信用借款','银行',200,'2026-01-01',0,NULL),
             ('朋友欠款','朋友',-50,'2026-01-01',0,NULL)
    `).run();
    await repository.saveMonth(
      "2026-03",
      0,
      [{ account_key: "cash-boc", balance: 1200 }],
      [{
        account_key: "investment-default",
        principal: 300,
        market_value: 310,
        cash_balance: 0
      }],
      [{
        transaction_date: "2026-03-01", type: "支出",
        category_key: traffic, category: "交通通勤", product: "交通", amount: 100
      }],
      []
    );
    await repository.createMonth("2026-04");
    const result = [
      ...repository.annual("2025").rows,
      ...repository.annual("2026").rows
    ];
    const byMonth = new Map(result.map((row) => [row.month, row]));
    expect(byMonth.get("2025-12")).toMatchObject({
      total_income: 5000,
      total_expense: 900,
      total_assets: 1200,
      theoretical_expense: null
    });
    expect(byMonth.get("2026-01")).toMatchObject({
      total_income: 6000,
      total_expense: 1500,
      total_assets: 1550,
      theoretical_expense: 5750,
      discrepancy: -4250,
      savings_rate: 75
    });
    expect(byMonth.get("2026-03")).toMatchObject({
      total_income: 0,
      total_expense: 100,
      theoretical_expense: null,
      savings_rate: null
    });
  });

  it("uses product-only rule candidates, persistence and application", async () => {
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
      [1, 2].map((day) => ({
        transaction_date: `2026-01-0${day}`,
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "示例商户",
        product: "午餐",
        amount: 20
      })),
      []
    );
    const candidates = repository.ruleCandidates(
      "2026-02",
      [],
      2
    );
    expect(candidates.rows[0]).toMatchObject({
      product: "午餐",
      occurrences: 2
    });
    const current = repository.rules();
    const saved = await repository.saveRules(current.revision, [{
      transaction_type: "支出",
      counterparty: "示例商户",
      product: "午餐",
      category_key: food,
      category: "餐饮基础"
    }]);
    expect(saved.rows[0]).toMatchObject({
      counterparty: "",
      occurrences: 2
    });
    expect(repository.rulesPreview("2026-02", [{
      transaction_date: "2026-02-01",
      type: "支出",
      category: "",
      counterparty: "示例商户",
      product: "午餐",
      amount: 20
    }]).proposed_rows[0].category).toBe("餐饮基础");
  });

  it("aggregates saved history, detects conflicts and exposes recommendations", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string, transactions: Parameters<typeof repository.saveMonth>[4]) =>
      repository.saveMonth(
        month,
        0,
        [{ account_key: "cash-default", balance: 100 }],
        investment,
        transactions,
        []
      );
    await save("2026-01", [
      {
        transaction_date: "2026-01-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "咖啡", amount: 10
      },
      {
        transaction_date: "2026-01-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "咖啡", amount: 20
      },
      {
        transaction_date: "2026-01-03", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "超市", product: "水果", amount: 15
      }
    ]);
    await save("2026-02", [
      {
        transaction_date: "2026-02-01", type: "支出",
        category_key: quality, category: "餐饮改善",
        counterparty: "商户甲", product: "咖啡", amount: 30
      },
      {
        transaction_date: "2026-02-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "超市", product: "水果", amount: 25
      }
    ]);
    const currentRules = repository.rules();
    await repository.saveRules(currentRules.revision, [
      {
        transaction_type: "支出",
        counterparty: "商户甲",
        product: "咖啡",
        category_key: food,
        category: "餐饮基础"
      }
    ]);

    const insights = repository.ruleInsights(2);
    const coffee = insights.historical_products.find(
      (row) => row.counterparty === "商户甲" && row.product === "咖啡"
    );
    const fruit = insights.historical_products.find(
      (row) => row.counterparty === "超市" && row.product === "水果"
    );
    expect(insights.rules_revision).toBe(repository.rules().revision);
    expect(coffee).toMatchObject({
      occurrences: 3,
      months_count: 2,
      total_amount: 60,
      average_amount: 20,
      latest_amount: 30,
      last_date: "2026-02-01",
      has_category_conflict: true,
      rule_status: "已覆盖",
      matching_rule_count: 1,
      history_rule_mismatch: true
    });
    expect(fruit).toMatchObject({
      occurrences: 2,
      months_count: 2,
      total_amount: 40,
      rule_status: "未创建"
    });
    expect(insights.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        product: "水果",
        occurrences: 2,
        category: "餐饮基础",
        category_confidence: 1,
        has_category_conflict: false
      })
    ]));
    expect(repository.rules().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_status: "正常", counterparty: "" })
    ]));
    expect(insights.rule_conflicts).toEqual([]);
    const detail = repository.productHistory({
      transaction_type: "支出",
      product_key: " 咖啡 "
    });
    expect(detail.rows[0]?.id).toBeTypeOf("number");
    expect(detail.rows[0]?.rule_match).toMatchObject({ status: "matched", level: "product" });
    expect(repository.ruleWorkspace().categories.find((row) => row.category_key === food)).toMatchObject({
      transaction_count: 4,
      impact_months: ["2026-01", "2026-02"],
      conflict_product_count: 1
    });
  });

  it("aggregates products across counterparties and keeps empty products visible", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string, transactions: Parameters<typeof repository.saveMonth>[4]) =>
      repository.saveMonth(
        month,
        0,
        [{ account_key: "cash-default", balance: 100 }],
        investment,
        transactions,
        []
      );
    await save("2026-01", [
      {
        transaction_date: "2026-01-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "拿铁", amount: 20
      },
      {
        transaction_date: "2026-01-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户乙", product: "拿铁", amount: 21
      },
      {
        transaction_date: "2026-01-03", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "水果", amount: 10
      },
      {
        transaction_date: "2026-01-04", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户乙", product: "水果", amount: 11
      },
      {
        transaction_date: "2026-01-05", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户丙", product: "", amount: 5
      }
    ]);
    await save("2026-02", [
      {
        transaction_date: "2026-02-01", type: "支出",
        category_key: quality, category: "餐饮改善",
        counterparty: "商户甲", product: "拿铁", amount: 22
      },
      {
        transaction_date: "2026-02-02", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "水果", amount: 12
      },
      {
        transaction_date: "2026-02-03", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户乙", product: "水果", amount: 13
      }
    ]);
    await repository.createMonth("2026-03");
    const db = manager.connection();
    db.prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category_key,category,counterparty,product,amount)
      VALUES ('2026-03','2026-03-01','支出',?,?,?, ?,?)
    `).run(food, "餐饮基础", "草稿商户", "草稿商品", 1);

    const insights = repository.ruleInsights(2);
    const coffee = insights.historical_products.find((row) => row.product === "拿铁");
    const fruit = insights.historical_products.find((row) => row.product === "水果");
    const empty = insights.historical_products.find((row) => row.product_key === "");
    expect(coffee).toMatchObject({
      occurrences: 3,
      counterparty_count: 2,
      has_category_conflict: true
    });
    expect(fruit).toMatchObject({
      occurrences: 4,
      counterparty_count: 2,
      has_category_conflict: false
    });
    expect(empty).toMatchObject({ occurrences: 1, product: "" });
    expect(insights.historical_products.some((row) => row.product === "草稿商品")).toBe(false);
    expect(insights.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: "水果", match_level: "product" })
    ]));
    expect(insights.recommendations.some((row) => row.product === "拿铁")).toBe(false);
    expect(insights.recommendations.some((row) => row.product === "拿铁" && row.match_level === "product")).toBe(false);
  });

  it("covers every transaction for a product regardless of counterparty", async () => {
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
        counterparty: "商户甲",
        product: "咖啡",
        amount: 20
      }, {
        transaction_date: "2026-01-02",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户乙",
        product: "咖啡",
        amount: 22
      }],
      []
    );
    const currentRules = repository.rules();
    await repository.saveRules(currentRules.revision, [{
      transaction_type: "支出",
      counterparty: "商户甲",
      product: "咖啡",
      category_key: food,
      category: "餐饮基础"
    }]);

    const insights = repository.ruleInsights(1);
    const coffee = insights.historical_products.find(
      (row) => row.product === "咖啡"
    );
    expect(coffee).toMatchObject({
      rule_coverage: "full",
      matched_occurrences: 2,
      unmatched_occurrences: 0,
      conflicted_occurrences: 0,
      rule_suggestion: undefined
    });
    expect(insights.summary.stable_products_without_rule).toBe(0);
    expect(repository.productHistoryIndex({
      issue_filter: "no-rule"
    }).groups).toEqual([]);
    expect(insights.recommendations.some((row) => row.product === "咖啡")).toBe(false);
  });

  it("derives partial-coverage suggestions only from unmatched transactions", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
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
        counterparty: "商户甲",
        product: "咖啡",
        amount: 20
      }, {
        transaction_date: "2026-01-02",
        type: "支出",
        category_key: quality,
        category: "餐饮改善",
        counterparty: "商户乙",
        product: "咖啡",
        amount: 22
      }],
      []
    );
    const currentRules = repository.rules();
    await repository.saveRules(currentRules.revision, [{
      transaction_type: "支出",
      counterparty: "商户甲",
      product: "咖啡",
      category_key: food,
      category: "餐饮基础"
    }]);

    const insights = repository.ruleInsights(1);
    const coffee = insights.historical_products.find(
      (row) => row.product === "咖啡"
    );
    expect(coffee).toMatchObject({
      has_category_conflict: true,
      rule_coverage: "full",
      matched_occurrences: 2,
      unmatched_occurrences: 0,
      rule_suggestion: undefined
    });
    expect(insights.recommendations.some((row) => row.product === "咖啡")).toBe(false);
  });

  it("groups duplicate and rule-category conflicts without counterparty overlap", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
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
        counterparty: "商户甲",
        product: "拿铁",
        amount: 20
      }, {
        transaction_date: "2026-01-02",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户乙",
        product: "水果",
        amount: 10
      }],
      []
    );
    const db = manager.connection();
    const insert = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    insert.run("支出", "商户甲", "拿铁", food, "餐饮基础");
    insert.run("支出", "商户甲", "拿铁", food, "餐饮基础");
    insert.run("支出", "商户甲", "拿铁", quality, "餐饮改善");
    insert.run("支出", "商户乙", "水果", food, "餐饮基础");
    insert.run("支出", "", "水果", food, "餐饮基础");
    const insights = repository.ruleInsights();
    const groups = new Map(insights.rule_conflicts.map((group) => [group.kind, group]));
    expect(insights.rule_conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "duplicate", affected_transaction_count: 1 }),
      expect.objectContaining({ kind: "same-condition", affected_transaction_count: 1 })
    ]));
    expect(groups.get("duplicate")?.rules).toHaveLength(2);
    expect(groups.get("same-condition")?.rules).toHaveLength(3);
    expect(groups.get("same-condition")?.description).toBe("同一商品对应多个分类规则");
    expect(groups.get("same-condition")?.affected_months).toEqual(["2026-01"]);
    expect(insights.summary).toMatchObject({
      rule_conflict_groups: 1,
      duplicate_rule_groups: 1
    });
  });

  it("loads product history only after a filter and keeps the shell lightweight", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户甲",
        product: "咖啡",
        amount: 20
      }],
      []
    );

    const shell = repository.ruleWorkspaceShell();
    expect(shell.categories_revision).toBe(repository.categories().revision);
    expect(shell.rules_revision).toBe(repository.rules().revision);
    expect(shell.rules).toEqual([]);
    const analytics = repository.ruleWorkspaceAnalytics();
    expect(analytics.categories.find((row) => row.category_key === food)).toMatchObject({
      transaction_count: 1
    });

    expect(repository.productOverview().groups).toEqual([
      expect.objectContaining({ product: "咖啡", occurrences: 1 })
    ]);
    expect(() => repository.productHistoryIndex({})).toThrow("商品回溯至少选择一个筛选条件后再加载");
    expect(() => repository.productHistory({})).toThrow("商品回溯至少选择一个筛选条件后再加载");
    expect(repository.productHistoryIndex({ transaction_type: "收入" }).groups).toEqual([]);
    expect(repository.productHistoryIndex({ product_search: "咖啡" }).groups).toEqual([
      expect.objectContaining({ product: "咖啡", occurrences: 1 })
    ]);
    expect(repository.productHistoryIndex({ min_occurrences: 2 }).groups).toEqual([]);
  });

  it("previews and atomically applies category backfills across months", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const save = (month: string) => repository.saveMonth(
      month,
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: `${month}-01`, type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "咖啡", amount: 20
      }],
      []
    );
    const january = await save("2026-01");
    const february = await save("2026-02");
    const ids = [january.transactions[0].id!, february.transactions[0].id!];
    const preview = repository.previewCategoryBackfill({
      transaction_ids: ids,
      target_category_key: quality
    });
    expect(preview).toMatchObject({
      transaction_count: 2,
      month_count: 2,
      target_category: "餐饮改善"
    });
    expect(preview.old_categories).toEqual([
      expect.objectContaining({ category_key: food, occurrences: 2 })
    ]);
    const result = await repository.applyCategoryBackfill({
      transaction_ids: ids,
      target_category_key: quality,
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    });
    expect(result.updated_count).toBe(2);
    expect(result.revisions).toEqual({ "2026-01": 2, "2026-02": 2 });
    expect((await repository.getMonth("2026-01")).transactions[0]).toMatchObject({
      id: ids[0],
      transaction_date: "2026-01-01",
      product: "咖啡",
      amount: 20,
      category_key: quality,
      category: "餐饮改善"
    });
    await expect(repository.applyCategoryBackfill({
      transaction_ids: ids,
      target_category_key: food,
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    })).rejects.toMatchObject({ status: 409 });
    expect((await repository.getMonth("2026-02")).transactions[0].category_key).toBe(quality);
  });

  it("blocks category backfills while a selected transaction has rule conflicts", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const quality = categoryKey("餐饮改善");
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
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        counterparty: "商户甲",
        product: "拿铁",
        amount: 20
      }],
      []
    );
    const insert = manager.connection().prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    insert.run("支出", "商户甲", "拿铁", food, "餐饮基础");
    insert.run("支出", "商户甲", "拿铁", quality, "餐饮改善");
    let caught: unknown;
    try {
      repository.previewCategoryBackfill({
        transaction_ids: [saved.transactions[0].id!],
        target_category_key: quality
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 422 });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("未解决的规则冲突");
    expect((await repository.getMonth("2026-01")).transactions[0].category_key).toBe(food);
  });

  it("previews and atomically renames selected saved product variants", async () => {
    const { manager, repository } = fixture();
    const food = categoryKey("餐饮基础");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    const january = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: "2026-01-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "拿铁大杯", amount: 20
      }],
      []
    );
    const february = await repository.saveMonth(
      "2026-02",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      investment,
      [{
        transaction_date: "2026-02-01", type: "支出",
        category_key: food, category: "餐饮基础",
        counterparty: "商户甲", product: "拿铁（大杯）", amount: 22
      }],
      []
    );
    const ids = [january.transactions[0].id!, february.transactions[0].id!];
    const ruleInsert = manager.connection().prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    ruleInsert.run("支出", "商户甲", "拿铁大杯", food, "餐饮基础");
    const preview = repository.previewProductRename({
      transaction_ids: ids,
      target_product: "拿铁"
    });
    expect(preview).toMatchObject({
      transaction_count: 2,
      month_count: 2,
      target_product: "拿铁"
    });
    expect(preview.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: "拿铁大杯", occurrences: 1 }),
      expect.objectContaining({ product: "拿铁（大杯）", occurrences: 1 })
    ]));
    const result = await repository.applyProductRename({
      transaction_ids: ids,
      target_product: "拿铁",
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    });
    expect(result.updated_count).toBe(2);
    expect(result.revisions).toEqual({ "2026-01": 2, "2026-02": 2 });
    expect((await repository.getMonth("2026-01")).transactions[0]).toMatchObject({
      id: ids[0], product: "拿铁", category_key: food, amount: 20
    });
    expect(repository.rules().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ counterparty: "", product: "拿铁大杯", category_key: food })
    ]));
    expect(manager.connection().prepare(
      "SELECT counterparty FROM auto_rules WHERE product=?"
    ).get("拿铁大杯")).toMatchObject({ counterparty: "商户甲" });
    await expect(repository.applyProductRename({
      transaction_ids: ids,
      target_product: "咖啡",
      expected_month_revisions: Object.fromEntries(
        preview.months.map((month) => [month.month, month.revision])
      )
    })).rejects.toMatchObject({ status: 409 });
  });

  it("saves category definitions and rules atomically in the workspace", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const current = repository.ruleWorkspace();
    const categories = current.categories.map((row) =>
      row.category_key === food ? { ...row, name: "餐饮基础改名" } : row
    );
    const saved = await repository.saveRuleWorkspace({
      categories_revision: current.categories_revision,
      rules_revision: current.rules_revision,
      categories,
      rules: current.rules
    });
    expect(saved.categories.find((row) => row.category_key === food)?.name).toBe("餐饮基础改名");
    const before = repository.categories().rows.find((row) => row.category_key === food)?.name;
    await expect(repository.saveRuleWorkspace({
      categories_revision: saved.categories_revision,
      rules_revision: saved.rules_revision + 1,
      categories: saved.categories.map((row) =>
        row.category_key === food ? { ...row, name: "不应写入" } : row
      ),
      rules: saved.rules
    })).rejects.toMatchObject({ status: 409 });
    expect(repository.categories().rows.find((row) => row.category_key === food)?.name).toBe(before);
  });

  it("filters big-ticket comparisons and applies the anomaly threshold", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const big = categoryKey("大件大额");
    const investment = [{
      account_key: "investment-default",
      principal: 0,
      market_value: 0,
      cash_balance: 0
    }];
    await repository.saveMonth(
      "2025-12",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      investment,
      [
        {
          transaction_date: "2025-12-01", type: "支出",
          category_key: food, category: "餐饮基础",
          counterparty: "", product: "餐饮", amount: 100
        },
        {
          transaction_date: "2025-12-02", type: "支出",
          category_key: big, category: "大件大额",
          counterparty: "", product: "电脑", amount: 5000
        }
      ],
      []
    );
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 900 }],
      investment,
      [
        {
          transaction_date: "2026-01-01", type: "支出",
          category_key: food, category: "餐饮基础",
          counterparty: "", product: "餐饮", amount: 250
        },
        {
          transaction_date: "2026-01-02", type: "支出",
          category_key: big, category: "大件大额",
          counterparty: "", product: "相机", amount: 8000
        }
      ],
      []
    );
    const overview = (await repository.getMonth("2026-01")).overview;
    expect(
      overview.category_comparison?.rows.map((row) => row.category)
    ).not.toContain("大件大额");
    expect(
      overview.anomalies?.category_changes.some(
        (row) => row["分类"] === "餐饮基础"
      )
    ).toBe(true);
    expect(
      overview.anomalies?.category_changes.some(
        (row) => row["分类"] === "大件大额"
      )
    ).toBe(false);
  });
});

describe("Python-compatible amount rounding", () => {
  it("uses half-even at exact ties", () => {
    expect(roundHalfEven(2.5, 0)).toBe(2);
    expect(roundHalfEven(3.5, 0)).toBe(4);
    expect(roundHalfEven(20.126, 2)).toBe(20.13);
  });
});
