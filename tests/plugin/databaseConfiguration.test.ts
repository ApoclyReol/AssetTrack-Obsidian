import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

describe("configuration repository", () => {

it("saves category definitions and rules through separate revisions", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const categorySnapshot = repository.categories();
    const categories = categorySnapshot.rows.map((row) =>
      row.category_key === food ? { ...row, name: "餐饮基础改名" } : row
    );
    await repository.saveCategories(
      categorySnapshot.revision,
      categories
    );
    expect(repository.categories().rows.find((row) => row.category_key === food)?.name).toBe("餐饮基础改名");
    const ruleSnapshot = repository.rules();
    await repository.saveRules(ruleSnapshot.revision, ruleSnapshot.rows);
    expect(repository.operationLogs(10)).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "save-categories", actor: "local-user" }),
      expect.objectContaining({ operation_type: "save-rules", actor: "local-user" })
    ]));
    const categoryOperation = repository.operationLogs(10).find(
      (operation) => operation.operation_type === "save-categories"
    );
    expect(categoryOperation && repository.operationDetails(categoryOperation.operation_id)).toMatchObject({
      metadata: { entity: "category" }
    });
    const before = repository.categories().rows.find((row) => row.category_key === food)?.name;
    await expect(repository.saveCategories(
      repository.categories().revision + 1,
      repository.categories().rows.map((row) =>
        row.category_key === food ? { ...row, name: "不应写入" } : row
      )
    )).rejects.toMatchObject({ status: 409 });
    expect(repository.categories().rows.find((row) => row.category_key === food)?.name).toBe(before);
  });

  it("infers a combined rule scope without dropping either condition", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const saved = await repository.saveRules(repository.rules().revision, [{
      transaction_type: "支出" as const,
      match_scope: "merchant_product" as const,
      counterparty: "咖啡店",
      product: "拿铁",
      category_key: food,
      category: "餐饮基础"
    }]);
    expect(saved.rows[0]).toMatchObject({
      match_scope: "merchant_product",
      counterparty: "咖啡店",
      product: "拿铁"
    });
  });

  it("rejects a cross-category rewrite chain made only of new rules", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const other = categoryKey("其他支出");
    await expect(repository.saveRules(
      repository.rules().revision,
      [{
        transaction_type: "支出" as const,
        match_scope: "merchant_product" as const,
        counterparty: "咖啡店",
        product: "拿铁",
        category_key: food,
        category: "餐饮基础",
        rewrite_product: "咖啡"
      }, {
        transaction_type: "支出" as const,
        match_scope: "product" as const,
        counterparty: "",
        product: "咖啡",
        category_key: other,
        category: "其他支出"
      }]
    )).rejects.toMatchObject({ code: "rule.rewrite_chain" });
  });

it("allows same-category rewrite chains but rejects different-category targets", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const other = categoryKey("其他支出");
    const source = {
      transaction_type: "支出" as const,
      match_scope: "merchant_product" as const,
      counterparty: "咖啡店",
      product: "拿铁",
      category_key: food,
      category: "餐饮基础",
      rewrite_product: "咖啡"
    };
    const sameCategoryTarget = {
      transaction_type: "支出" as const,
      match_scope: "product" as const,
      counterparty: "",
      product: "咖啡",
      category_key: food,
      category: "餐饮基础"
    };
    const saved = await repository.saveRules(
      repository.rules().revision,
      [source, sameCategoryTarget]
    );
    expect(saved.rows).toHaveLength(2);

    await expect(repository.saveRules(
      saved.revision,
      saved.rows.map((rule) => rule.product === "咖啡"
        ? { ...rule, category_key: other, category: "其他支出" }
        : rule)
    )).rejects.toMatchObject({ code: "rule.rewrite_chain" });
  });

  it("keeps an account referenced only by investment transactions as inactive", async () => {
    const { manager, repository } = fixture();
    const snapshot = repository.accounts();
    const account = {
      account_key: "investment-used-by-flow",
      name: "仅有理财流水的账户",
      account_type: "investment" as const,
      is_active: true,
      sort_order: 10
    };
    await repository.saveAccounts(snapshot.revision, [...snapshot.rows, account]);
    manager.connection().prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category,counterparty,product,source,account_key,amount)
      VALUES ('2026-01','2026-01-01','加仓','','','理财转入','',?,100)
    `).run(account.account_key);

    const current = repository.accounts();
    const saved = await repository.saveAccounts(
      current.revision,
      current.rows.filter((row) => row.account_key !== account.account_key)
    );
    expect(saved.rows.find((row) => row.account_key === account.account_key)).toMatchObject({
      is_active: false,
      usage_count: 1,
      impact_months: ["2026-01"]
    });
  });

  it("blocks category type changes when a paid-on-behalf row uses the category", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{
        transaction_date: "2026-01-01",
        type: "代付",
        category_key: food,
        category: "餐饮基础",
        product: "代买",
        amount: 20
      }],
      []
    );
    const snapshot = repository.categories();
    await expect(repository.saveCategories(
      snapshot.revision,
      snapshot.rows.map((row) => row.category_key === food
        ? { ...row, transaction_type: "收入" as const }
        : row)
    )).rejects.toMatchObject({ code: "category.type_change_referenced" });
  });

  it("bumps affected month revisions when a category name is rewritten", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category_key: food,
        category: "餐饮基础",
        product: "午餐",
        amount: 20
      }],
      []
    );
    const snapshot = repository.categories();
    await repository.saveCategories(
      snapshot.revision,
      snapshot.rows.map((row) => row.category_key === food
        ? { ...row, name: "餐饮基础新名" }
        : row)
    );
    expect(repository.getRevision("2026-01")).toBe(saved.revision + 1);
    await expect(repository.saveMonth(
      "2026-01",
      saved.revision,
      saved.cash_accounts,
      saved.investment_accounts,
      saved.transactions,
      saved.fixed_assets
    )).rejects.toMatchObject({ status: 409 });
  });
});
