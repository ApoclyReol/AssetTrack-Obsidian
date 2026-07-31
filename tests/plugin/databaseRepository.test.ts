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

  it("uses counterparty in rule candidates, persistence and application", async () => {
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
      counterparty: "示例商户",
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
      counterparty: "示例商户",
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
