import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";
describe("analysis repository", () => {

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
          category_key: food,
          category: "餐饮基础",
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
    expect((await repository.getMonth("2025-12")).overview.category_summary)
      .toEqual(expect.arrayContaining([{ category: "餐饮基础", amount: 900 }]));
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

it("tracks investment flows and month-over-month returns per investment account", async () => {
    const { manager, repository } = fixture();
    manager.connection().prepare(`
      INSERT INTO account_definitions
        (account_key,name,account_type,is_active,sort_order)
      VALUES (?,?,?,?,?)
    `).run("investment-b", "券商 B", "investment", 1, 2);

    const investmentAccounts = [
      { account_key: "investment-default", principal: 100, market_value: 110, cash_balance: 10 },
      { account_key: "investment-b", principal: 200, market_value: 210, cash_balance: 5 }
    ];
    await repository.saveMonth(
      "2025-12",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      investmentAccounts,
      [],
      []
    );
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 1000 }],
      [
        { account_key: "investment-default", principal: 150, market_value: 160, cash_balance: 12 },
        { account_key: "investment-b", principal: 180, market_value: 190, cash_balance: 6 }
      ],
      [
        {
          transaction_date: "2026-01-03",
          type: "加仓",
          account_key: "investment-default",
          category: "",
          product: "理财转入",
          amount: 50
        },
        {
          transaction_date: "2026-01-04",
          type: "提现",
          account_key: "investment-b",
          category: "",
          product: "理财转出",
          amount: 20
        }
      ],
      []
    );

    expect((await repository.getMonth("2026-01")).overview.investment_accounts).toMatchObject([
      {
        account_key: "investment-default",
        name: "默认理财账户",
        principal: 150,
        deposit: 50,
        withdraw: 0,
        position: 172,
        profit: 22,
        roi_percent: 22,
        comparison: {
          previous_position: 120,
          amount_delta: 2,
          percent_delta: 1.7,
          previous_roi_percent: 20,
          roi_delta_percent: 2
        }
      },
      {
        account_key: "investment-b",
        name: "券商 B",
        principal: 180,
        deposit: 0,
        withdraw: 20,
        position: 196,
        profit: 16,
        roi_percent: 8,
        comparison: {
          previous_position: 215,
          amount_delta: 1,
          percent_delta: 0.5,
          previous_roi_percent: 7.5,
          roi_delta_percent: 0.5
        }
      }
    ]);
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
    expect(manager.validate(false).schema_version).toBe(10);
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
