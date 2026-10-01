import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

describe("configuration repository", () => {

  it("transfers referenced tags atomically and bumps the affected month revision", async () => {
    const { repository } = fixture();
    const initial = repository.taxonomy();
    const created = await repository.saveTaxonomy(initial.attribute_revision, initial.groups, initial.options,
      initial.tag_revision, [...initial.tags, {
        tag_key: "tag-test-target", name: "目标", description: "", color: "#7c3aed", is_active: true,
        sort_order: initial.tags.length
      }]);
    await repository.saveMonth("2026-01", 0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{ transaction_date: "2026-01-01", type: "支出", category: "", product: "车票", amount: 20,
        tag_keys: ["tag-travel"] }], []);
    const before = repository.taxonomy();
    const revision = repository.getRevision("2026-01");
    const saved = await repository.saveTaxonomy(created.attribute_revision, created.groups, created.options,
      created.tag_revision, created.tags.filter((tag) => tag.tag_key !== "tag-travel"), [{
        kind: "tag", key: "tag-travel", action: "transfer", target_key: "tag-test-target", expected_count: 1,
        expected_usage_revision: before.tags.find((tag) => tag.tag_key === "tag-travel")!.usage_revision!
      }]);
    expect(before.tags.find((tag) => tag.tag_key === "tag-travel")?.transaction_count).toBe(1);
    expect(saved.tags.some((tag) => tag.tag_key === "tag-travel")).toBe(false);
    expect((await repository.getMonth("2026-01")).transactions[0].tag_keys).toEqual(["tag-test-target"]);
    expect(repository.getRevision("2026-01")).not.toBe(revision);
    const removalLog = repository.operationLogs(10).find((item) => item.operation_type === "remove-taxonomy");
    expect(removalLog).toBeDefined();
    expect(repository.operationDetails(removalLog!.operation_id)).toMatchObject({
      metadata: { affected_months: ["2026-01"] }
    });
  });

  it("rejects a stale removal preview without changing tags or definitions", async () => {
    const { repository } = fixture();
    await repository.saveMonth("2026-01", 0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{ transaction_date: "2026-01-01", type: "支出", category: "", product: "车票", amount: 20,
        tag_keys: ["tag-travel"] }], []);
    const before = repository.taxonomy();
    const revision = repository.getRevision("2026-01");
    await expect(repository.saveTaxonomy(before.attribute_revision, before.groups, before.options,
      before.tag_revision, before.tags.filter((tag) => tag.tag_key !== "tag-travel")))
      .rejects.toMatchObject({ code: "taxonomy.removal_invalid" });
    await expect(repository.saveTaxonomy(before.attribute_revision, before.groups, before.options,
      before.tag_revision, before.tags.filter((tag) => tag.tag_key !== "tag-travel"), [{
        kind: "tag", key: "tag-travel", action: "clear", expected_count: 0,
        expected_usage_revision: before.tags.find((tag) => tag.tag_key === "tag-travel")!.usage_revision!
      }])).rejects.toMatchObject({ status: 409 });
    expect((await repository.getMonth("2026-01")).transactions[0].tag_keys).toEqual(["tag-travel"]);
    expect(repository.taxonomy().tags.some((tag) => tag.tag_key === "tag-travel")).toBe(true);
    expect(repository.getRevision("2026-01")).toBe(revision);
  });

  it("rejects a same-count tag association change after removal was prepared", async () => {
    const { repository } = fixture();
    const saved = await repository.saveMonth("2026-01", 0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [
        { transaction_date: "2026-01-01", type: "支出", category: "", product: "甲", amount: 10,
          tag_keys: ["tag-travel"] },
        { transaction_date: "2026-01-02", type: "支出", category: "", product: "乙", amount: 20,
          tag_keys: [] }
      ], []);
    const preview = repository.taxonomy();
    await repository.saveMonth("2026-01", saved.revision, saved.cash_accounts,
      saved.investment_accounts, saved.transactions.map((row, index) => ({
        ...row, tag_keys: index === 0 ? [] : ["tag-travel"]
      })), saved.fixed_assets);
    const current = repository.taxonomy();
    expect(current.tags.find((tag) => tag.tag_key === "tag-travel")?.transaction_count).toBe(1);
    await expect(repository.saveTaxonomy(preview.attribute_revision, preview.groups, preview.options,
      preview.tag_revision, preview.tags.filter((tag) => tag.tag_key !== "tag-travel"), [{
        kind: "tag", key: "tag-travel", action: "clear", expected_count: 1,
        expected_usage_revision: preview.tags.find((tag) => tag.tag_key === "tag-travel")!.usage_revision!
      }])).rejects.toMatchObject({ status: 409 });
    expect((await repository.getMonth("2026-01")).transactions[1].tag_keys).toEqual(["tag-travel"]);
  });

  it("transfers a category attribute value and clears a referenced attribute group", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const initial = repository.taxonomy();
    const category = repository.categories().rows.find((row) => row.category_key === food);
    const sourceKey = category?.attribute_keys?.[0];
    expect(sourceKey).toBeDefined();
    const source = initial.options.find((option) => option.attribute_key === sourceKey)!;
    const target = initial.options.find((option) => option.group_key === source.group_key && option.attribute_key !== sourceKey)!;
    await repository.saveMonth("2026-01", 0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{ transaction_date: "2026-01-01", type: "支出", category_key: food,
        category: "餐饮基础", product: "午餐", amount: 20 }], []);
    const before = repository.taxonomy();
    await repository.saveTaxonomy(before.attribute_revision, before.groups,
      before.options.filter((option) => option.attribute_key !== sourceKey), before.tag_revision, before.tags,
      [{ kind: "option", key: sourceKey!, action: "transfer", target_key: target.attribute_key,
        expected_count: source.category_count ?? 1, expected_usage_revision: source.usage_revision! }]);
    expect(repository.categories().rows.find((row) => row.category_key === food)?.attribute_keys)
      .toContain(target.attribute_key);
    const current = repository.taxonomy();
    const group = current.groups.find((item) => item.group_key === source.group_key)!;
    await repository.saveTaxonomy(current.attribute_revision,
      current.groups.filter((item) => item.group_key !== group.group_key),
      current.options.filter((item) => item.group_key !== group.group_key),
      current.tag_revision, current.tags,
      [{ kind: "group", key: group.group_key, action: "clear", expected_count: group.usage_count ?? 0,
        expected_usage_revision: group.usage_revision! }]);
    expect(repository.categories().rows.find((row) => row.category_key === food)?.attribute_keys)
      .not.toContain(target.attribute_key);
    expect(repository.taxonomy().groups.some((item) => item.group_key === group.group_key)).toBe(false);
  });

  it("transfers a referenced attribute group to one target value and replaces target-group choices", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    await repository.saveMonth("2026-01", 0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{ transaction_date: "2026-01-01", type: "支出", category_key: food,
        category: "餐饮基础", product: "午餐", amount: 20 }], []);
    const before = repository.taxonomy();
    const sourceOption = before.options.find((option) =>
      repository.categories().rows.find((category) => category.category_key === food)?.attribute_keys?.includes(option.attribute_key))!;
    const sourceGroup = before.groups.find((group) => group.group_key === sourceOption.group_key)!;
    const targetGroup = before.groups.find((group) => group.group_key !== sourceGroup.group_key
      && before.options.some((option) => option.group_key === group.group_key))!;
    const targetOption = before.options.find((option) => option.group_key === targetGroup.group_key
      && option.is_active)!;
    await repository.saveTaxonomy(before.attribute_revision,
      before.groups.filter((group) => group.group_key !== sourceGroup.group_key),
      before.options.filter((option) => option.group_key !== sourceGroup.group_key),
      before.tag_revision, before.tags, [{
        kind: "group", key: sourceGroup.group_key, action: "transfer", target_key: targetOption.attribute_key,
        expected_count: sourceGroup.usage_count!, expected_usage_revision: sourceGroup.usage_revision!,
        expected_target_group_usage_revision: targetGroup.usage_revision!
      }]);
    const keys = repository.categories().rows.find((row) => row.category_key === food)?.attribute_keys ?? [];
    expect(keys).toContain(targetOption.attribute_key);
    expect(keys.some((key) => before.options.some((option) => option.attribute_key === key
      && option.group_key === sourceGroup.group_key))).toBe(false);
    expect(keys.filter((key) => before.options.some((option) => option.attribute_key === key
      && option.group_key === targetGroup.group_key))).toEqual([targetOption.attribute_key]);
  });

  it("saves taxonomy revisions and keeps referenced definitions inactive", async () => {
    const { repository } = fixture();
    const current = repository.taxonomy();
    const travel = current.tags.find((tag) => tag.tag_key === "tag-travel");
    expect(travel).toBeDefined();
    const saved = await repository.saveTaxonomy(
      current.attribute_revision,
      current.groups,
      current.options,
      current.tag_revision,
      current.tags.map((tag) => tag.tag_key === "tag-travel" ? { ...tag, is_active: false } : tag)
    );
    expect(saved.tags.find((tag) => tag.tag_key === "tag-travel")?.is_active).toBe(false);
    await expect(repository.saveTaxonomy(
      current.attribute_revision,
      current.groups,
      current.options,
      current.tag_revision,
      current.tags
    )).rejects.toMatchObject({ status: 409 });
  });

  it("keeps taxonomy definition revisions stable when historical usage changes", async () => {
    const { repository } = fixture();
    const before = repository.taxonomy();
    const saved = await repository.saveMonth(
      "2026-01",
      0,
      [{ account_key: "cash-default", balance: 100 }],
      [{ account_key: "investment-default", principal: 0, market_value: 0, cash_balance: 0 }],
      [{
        transaction_date: "2026-01-01",
        type: "支出",
        category: "",
        product: "旅行",
        amount: 20,
        tag_keys: ["tag-travel"]
      }],
      []
    );
    const afterUsage = repository.taxonomy();
    expect(afterUsage.tag_revision).toBe(before.tag_revision);
    expect(afterUsage.tags.find((tag) => tag.tag_key === "tag-travel"))
      .toMatchObject({ transaction_count: 1, impact_months: ["2026-01"] });
    await expect(repository.saveTaxonomy(
      before.attribute_revision,
      before.groups,
      before.options,
      before.tag_revision,
      before.tags
    )).resolves.toMatchObject({ tag_revision: before.tag_revision });
    expect(repository.getRevision("2026-01")).toBe(saved.revision);
  });

  it("includes category attribute assignments in the category revision", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const before = repository.categories();
    const foodRow = before.rows.find((row) => row.category_key === food);
    expect(foodRow).toBeDefined();
    await repository.saveCategories(
      before.revision,
      before.rows.map((row) => row.category_key === food
        ? { ...row, attribute_keys: ["attr-necessity-controlled", "attr-pattern-daily"] }
        : row)
    );
    expect(repository.categories().revision).not.toBe(before.revision);
  });

  it("rejects assigning an attribute option that was deactivated after the category draft was opened", async () => {
    const { repository } = fixture();
    const categories = repository.categories();
    const taxonomy = repository.taxonomy();
    const food = categoryKey("餐饮基础");
    await repository.saveTaxonomy(
      taxonomy.attribute_revision,
      taxonomy.groups,
      taxonomy.options.map((option) => option.attribute_key === "attr-scale-large"
        ? { ...option, is_active: false }
        : option),
      taxonomy.tag_revision,
      taxonomy.tags
    );
    await expect(repository.saveCategories(
      categories.revision,
      categories.rows.map((row) => row.category_key === food
        ? { ...row, attribute_keys: [...(row.attribute_keys ?? []), "attr-scale-large"] }
        : row)
    )).rejects.toMatchObject({ code: "category.attribute_invalid" });
  });

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

  it("saves paid-on-behalf rules with expense categories and rejects income categories", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const income = categoryKey("工资收入");
    const saved = await repository.saveRules(repository.rules().revision, [{
      transaction_type: "代付" as const,
      match_scope: "product" as const,
      counterparty: "",
      product: "AA 回款",
      category_key: food,
      category: "餐饮基础"
    }]);
    expect(saved.rows[0]).toMatchObject({
      transaction_type: "代付",
      category_key: food
    });

    await expect(repository.saveRules(saved.revision, [{
      transaction_type: "代付" as const,
      match_scope: "product" as const,
      counterparty: "",
      product: "奖金回款",
      category_key: income,
      category: "工资收入"
    }])).rejects.toMatchObject({ code: "rule.category_type_mismatch" });
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
