import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  CategoryDefinition,
  SaveRuleWorkspaceRequest
} from "../types";
import { normalizeProductKey, RULE_TYPES } from "../domain/rules";
import { categoryColor } from "./schema";
import {
  RepositoryValidationError,
  RevisionConflictError,
  rows,
  text,
  type Row
} from "./repositoryPrimitives";
import type { RepositoryWriteContext } from "./repositoryWriteContext";

export class ConfigurationWriteRepository {
  constructor(private readonly context: RepositoryWriteContext) {}

  saveCategories(
    db: DatabaseSync,
    expectedRevision: number,
    input: CategoryDefinition[]
  ): void {
    const current = this.context.categories(db);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    this.writeCategories(db, input);
  }

  saveAccounts(
    db: DatabaseSync,
    expectedRevision: number,
    input: AccountDefinition[]
  ): void {
    const current = this.context.accounts(db);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    const existing = new Map(rows(db.prepare(
        "SELECT * FROM account_definitions"
      ).all()).map((row) => [text(row.account_key), row]));
      const submitted = new Set<string>();
      const names = new Set<string>();
      input.forEach((row, index) => {
        const key = text(row.account_key);
        const name = text(row.name);
        const identity = `${row.account_type}\u0000${name}`;
        if (
          !key || !name || submitted.has(key) || names.has(identity)
          || !["cash", "investment"].includes(row.account_type)
        ) {
          throw new RepositoryValidationError("账户 key、名称或类型无效或重复");
        }
        const old = existing.get(key);
        if (old && text(old.account_type) !== row.account_type) {
          throw new RepositoryValidationError("已有账户不能改变现金/理财类型");
        }
        submitted.add(key);
        names.add(identity);
        db.prepare(`
          INSERT INTO account_definitions
            (account_key,name,account_type,is_active,sort_order)
          VALUES (?,?,?,?,?)
          ON CONFLICT(account_key) DO UPDATE SET
            name=excluded.name,is_active=excluded.is_active,sort_order=excluded.sort_order
        `).run(key, name, row.account_type, row.is_active ? 1 : 0, row.sort_order ?? index);
      });
    for (const [key, definition] of existing) {
      if (submitted.has(key)) continue;
      const table = text(definition.account_type) === "cash"
        ? "cash_account_balances" : "investment_account_balances";
      const used = db.prepare(
        `SELECT 1 FROM ${table} WHERE account_key=? LIMIT 1`
      ).get(key);
      if (used) {
        db.prepare("UPDATE account_definitions SET is_active=0 WHERE account_key=?").run(key);
      } else {
        db.prepare("DELETE FROM account_definitions WHERE account_key=?").run(key);
      }
    }
  }

  saveRules(db: DatabaseSync, expectedRevision: number, input: Row[]): void {
    const current = this.context.rules(db);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    this.writeRules(db, input);
  }

  saveRuleWorkspace(db: DatabaseSync, request: SaveRuleWorkspaceRequest): void {
    const currentCategories = this.context.categories(db);
    const currentRules = this.context.rules(db);
    if (currentCategories.revision !== request.categories_revision) {
      throw new RevisionConflictError(request.categories_revision, currentCategories.revision);
    }
    if (currentRules.revision !== request.rules_revision) {
      throw new RevisionConflictError(request.rules_revision, currentRules.revision);
    }
    this.writeCategories(db, request.categories, true);
    this.writeRules(db, request.rules as unknown as Row[]);
  }

  private writeCategories(
    db: DatabaseSync,
    input: CategoryDefinition[],
    allowRuleTypeChanges = false
  ): void {
    const existing = new Map(rows(db.prepare(
      "SELECT * FROM category_definitions"
    ).all()).map((row) => [text(row.category_key), row]));
    const submitted = new Set<string>();
    const names = new Set<string>();
    input.forEach((row, index) => {
      const key = text(row.category_key);
      const name = text(row.name);
      if (!key || !name || submitted.has(key) || names.has(name)) {
        throw new RepositoryValidationError("分类 key 和名称不能为空或重复");
      }
      if (!["支出", "收入"].includes(row.transaction_type)) {
        throw new RepositoryValidationError("分类收支类型只能是收入或支出");
      }
      if (!["必要", "可控", "不适用"].includes(row.necessity)) {
        throw new RepositoryValidationError("分类必要性无效");
      }
      if (!["周期", "日常", "偶尔", "不适用"].includes(row.pattern)) {
        throw new RepositoryValidationError("分类消费频率无效");
      }
      const old = existing.get(key);
      if (old && text(old.transaction_type) !== row.transaction_type) {
        const conflictingTransaction = db.prepare(`
          SELECT 1 FROM transactions
          WHERE category_key=? AND type IN ('支出','收入') AND type<>?
          LIMIT 1
        `).get(key, row.transaction_type);
        const conflictingRule = !allowRuleTypeChanges && db.prepare(`
          SELECT 1 FROM auto_rules
          WHERE category_key=? AND transaction_type<>?
          LIMIT 1
        `).get(key, row.transaction_type);
        if (conflictingTransaction || conflictingRule) {
          throw new RepositoryValidationError(
            `分类“${text(old.name)}”已有不匹配的历史引用，不能改变收支类型`
          );
        }
      }
      submitted.add(key);
      names.add(name);
      db.prepare(`
        INSERT INTO category_definitions
          (category_key,name,transaction_type,necessity,pattern,
           is_big_ticket,color,is_active,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(category_key) DO UPDATE SET
          name=excluded.name,transaction_type=excluded.transaction_type,
          necessity=excluded.necessity,pattern=excluded.pattern,
          is_big_ticket=excluded.is_big_ticket,color=excluded.color,
          is_active=excluded.is_active,sort_order=excluded.sort_order
      `).run(
        key, name, row.transaction_type, row.necessity, row.pattern,
        row.is_big_ticket ? 1 : 0, text(row.color) || categoryColor(index),
        row.is_active ? 1 : 0, Number(row.sort_order ?? index)
      );
      if (old && text(old.name) !== name) {
        db.prepare("UPDATE transactions SET category=? WHERE category_key=?").run(name, key);
        db.prepare("UPDATE auto_rules SET category=? WHERE category_key=?").run(name, key);
      }
    });
    for (const key of existing.keys()) {
      if (submitted.has(key)) continue;
      const usage = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE category_key=?) AS transaction_count,
          (SELECT COUNT(*) FROM auto_rules WHERE category_key=?) AS rule_count
      `).get(key, key) as Row;
      const transactionCount = Number(usage.transaction_count ?? 0);
      const ruleCount = Number(usage.rule_count ?? 0);
      if (transactionCount || ruleCount) {
        throw new RepositoryValidationError(
          `分类“${text(existing.get(key)?.name)}”仍有 ${transactionCount} 条历史流水和 ${ruleCount} 条规则引用，不能删除`
        );
      }
      db.prepare("DELETE FROM category_definitions WHERE category_key=?").run(key);
    }
  }

  private writeRules(db: DatabaseSync, input: Row[]): void {
    const categories = this.context.categoryRows(db);
    const byKey = new Map(categories.map((row) => [row.category_key, row]));
    const byName = new Map(categories.map((row) => [row.name, row]));
    const existingRows = rows(db.prepare(
      "SELECT id,counterparty FROM auto_rules"
    ).all());
    const existing = new Set(existingRows.map((row) => Number(row.id)));
    const legacyCounterpartyById = new Map(
      existingRows.map((row) => [Number(row.id), text(row.counterparty)])
    );
    const submitted = new Set<number>();
    const keys = new Set<string>();
    const insert = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,counterparty,product,category_key,category)
      VALUES (?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE auto_rules SET
        transaction_type=?,counterparty=?,product=?,category_key=?,category=?
      WHERE id=?
    `);
    for (const source of input) {
      const product = text(source.product);
      const category = byKey.get(text(source.category_key))
        ?? byName.get(text(source.category));
      const type = text(source.transaction_type) || category?.transaction_type || "";
      if (!product || !category) {
        throw new RepositoryValidationError("自动规则必须填写商品，并选择分类");
      }
      if (!category.is_active && (source.id === undefined || source.id === null)) {
        throw new RepositoryValidationError("新自动规则不能使用停用分类");
      }
      if (!RULE_TYPES.has(type)) {
        throw new RepositoryValidationError("自动规则的收支类型只能是支出或收入");
      }
      if (category.transaction_type !== type) {
        throw new RepositoryValidationError(`${type}规则不能使用分类“${category.name}”`);
      }
      const key = [type, normalizeProductKey(product)].join("\u0000");
      if (keys.has(key)) {
        throw new RepositoryValidationError("同一收支类型和商品下不能存在重复规则");
      }
      keys.add(key);
      if (source.id === undefined || source.id === null) {
        insert.run(type, "", product, category.category_key, category.name);
      } else {
        const id = Number(source.id);
        if (!existing.has(id) || submitted.has(id)) {
          throw new RepositoryValidationError("自动规则 id 无效或重复");
        }
        submitted.add(id);
        update.run(
          type,
          legacyCounterpartyById.get(id) ?? "",
          product,
          category.category_key,
          category.name,
          id
        );
      }
    }
    for (const id of existing) if (!submitted.has(id)) {
      db.prepare("DELETE FROM auto_rules WHERE id=?").run(id);
    }
  }
}
