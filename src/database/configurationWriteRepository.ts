import type { DatabaseSync } from "node:sqlite";
import type {
  AccountDefinition,
  CategoryDefinition
} from "../types/configuration";
import {
  detectRewriteChains,
  findRuleConflicts,
  normalizeRuleDefinition,
  RULE_TYPES
} from "../domain/rules";
import { categoryColor } from "./schema";
import {
  RepositoryValidationError,
  RevisionConflictError,
  rows,
  text,
  type Row
} from "./repositoryPrimitives";
import type { ConfigurationWriteDependencies } from "./repositoryWriteContext";

export class ConfigurationWriteRepository {
  constructor(private readonly context: ConfigurationWriteDependencies) {}

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
          throw new RepositoryValidationError({ code: "account.definition_invalid" });
        }
        const old = existing.get(key);
        if (old && text(old.account_type) !== row.account_type) {
          throw new RepositoryValidationError({ code: "account.type_immutable" });
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
        throw new RepositoryValidationError({ code: "category.definition_invalid" });
      }
      if (!["支出", "收入"].includes(row.transaction_type)) {
        throw new RepositoryValidationError({ code: "category.type_invalid" });
      }
      if (!["必要", "可控", "不适用"].includes(row.necessity)) {
        throw new RepositoryValidationError({ code: "category.necessity_invalid" });
      }
      if (!["周期", "日常", "偶尔", "不适用"].includes(row.pattern)) {
        throw new RepositoryValidationError({ code: "category.pattern_invalid" });
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
          throw new RepositoryValidationError({
            code: "category.type_change_referenced",
            params: { name: text(old.name) }
          });
        }
      }
      if (!row.is_active && old?.is_active) {
        const usage = db.prepare(`
          SELECT
            (SELECT COUNT(*) FROM transactions WHERE category_key=?) AS transaction_count,
            (SELECT COUNT(*) FROM auto_rules WHERE category_key=?) AS rule_count
        `).get(key, key) as Row;
        const transactionCount = Number(usage.transaction_count ?? 0);
        const ruleCount = Number(usage.rule_count ?? 0);
        if (transactionCount || ruleCount) {
          throw new RepositoryValidationError({
            code: "category.deactivation_referenced",
            params: { name, transaction_count: transactionCount, rule_count: ruleCount }
          });
        }
      }
      submitted.add(key);
      names.add(name);
      db.prepare(`
        INSERT INTO category_definitions
          (category_key,name,transaction_type,necessity,pattern,
           is_big_ticket,color,is_active,sort_order,description)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(category_key) DO UPDATE SET
          name=excluded.name,transaction_type=excluded.transaction_type,
          necessity=excluded.necessity,pattern=excluded.pattern,
          is_big_ticket=excluded.is_big_ticket,color=excluded.color,
          is_active=excluded.is_active,sort_order=excluded.sort_order,
          description=excluded.description
      `).run(
        key, name, row.transaction_type, row.necessity, row.pattern,
        row.is_big_ticket ? 1 : 0, text(row.color) || categoryColor(index),
        row.is_active ? 1 : 0, Number(row.sort_order ?? index), text(row.description)
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
        throw new RepositoryValidationError({
          code: "category.delete_referenced",
          params: {
            name: text(existing.get(key)?.name),
            transaction_count: transactionCount,
            rule_count: ruleCount
          }
        });
      }
      db.prepare("DELETE FROM category_definitions WHERE category_key=?").run(key);
    }
  }

  private writeRules(db: DatabaseSync, input: Row[]): void {
    const categories = this.context.categoryRows(db);
    const byKey = new Map(categories.map((row) => [row.category_key, row]));
    const byName = new Map(categories.map((row) => [row.name, row]));
    const existingRows = rows(db.prepare("SELECT id FROM auto_rules").all());
    const existing = new Set(existingRows.map((row) => Number(row.id)));
    const submitted = new Set<number>();
    const normalized = input.map((source, index) => {
      const explicitScope = Boolean(source.match_scope);
      const inferredScope = source.match_scope
        || (text(source.product) ? "product" : text(source.counterparty) ? "merchant" : undefined);
      const category = byKey.get(text(source.category_key))
        ?? byName.get(text(source.category));
      const type = text(source.transaction_type) || text(category?.transaction_type);
      const result = normalizeRuleDefinition({
        id: source.id === undefined || source.id === null ? undefined : Number(source.id),
        transaction_type: type,
        match_scope: inferredScope as "product" | "merchant" | "merchant_product" | undefined,
        // Legacy callers used counterparty as transaction context for
        // product-only rules. New UI callers provide the inferred scope.
        counterparty: explicitScope ? text(source.counterparty) : "",
        product: text(source.product),
        category_key: category?.category_key ?? text(source.category_key),
        category: category?.name ?? text(source.category),
        rewrite_merchant: text(source.rewrite_merchant),
        rewrite_product: text(source.rewrite_product)
      });
      if (!result.value) {
        throw new RepositoryValidationError({
          code: "rule.definition_invalid",
          params: { row: index + 1, issues: result.issues }
        });
      }
      const rule = result.value;
      const definition = byKey.get(rule.category_key);
      if (!definition) {
        throw new RepositoryValidationError({ code: "rule.category_missing", params: { row: index + 1 } });
      }
      if (!definition.is_active) {
        throw new RepositoryValidationError({ code: "rule.category_inactive" });
      }
      if (!RULE_TYPES.has(rule.transaction_type)) {
        throw new RepositoryValidationError({ code: "rule.type_invalid" });
      }
      if (definition.transaction_type !== rule.transaction_type) {
        throw new RepositoryValidationError({
          code: "rule.category_type_mismatch",
          params: { transaction_type: rule.transaction_type, category: definition.name }
        });
      }
      return rule;
    });
    const conflicts = findRuleConflicts(normalized);
    if (conflicts.length) {
      const conflict = conflicts[0];
      throw new RepositoryValidationError({
        code: "rule.conflict",
        params: { description: conflict.description, rule_ids: conflict.rule_ids }
      });
    }
    const chains = detectRewriteChains(normalized);
    if (chains.length) {
      const chain = chains[0];
      throw new RepositoryValidationError({
        code: "rule.rewrite_chain",
        params: { reason: chain.reason, rule_id: chain.rule_id ?? null }
      });
    }
    const insert = db.prepare(`
      INSERT INTO auto_rules
        (transaction_type,match_scope,counterparty,product,
         category_key,category,
         rewrite_merchant,rewrite_product)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE auto_rules SET
        transaction_type=?,match_scope=?,counterparty=?,product=?,
        category_key=?,category=?,rewrite_merchant=?,rewrite_product=?
      WHERE id=?
    `);
    for (const rule of normalized) {
      if (rule.id === undefined || rule.id === null) {
        insert.run(
          rule.transaction_type, rule.match_scope, rule.counterparty, rule.product,
          rule.category_key, rule.category,
          rule.rewrite_merchant, rule.rewrite_product
        );
      } else {
        const id = Number(rule.id);
        if (!existing.has(id) || submitted.has(id)) {
          throw new RepositoryValidationError({ code: "rule.id_invalid" });
        }
        submitted.add(id);
        update.run(
          rule.transaction_type, rule.match_scope, rule.counterparty, rule.product,
          rule.category_key, rule.category, rule.rewrite_merchant, rule.rewrite_product,
          id
        );
      }
    }
    for (const id of existing) if (!submitted.has(id)) {
      db.prepare("DELETE FROM auto_rules WHERE id=?").run(id);
    }
  }
}
