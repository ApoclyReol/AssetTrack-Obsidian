import type { DatabaseSync } from "node:sqlite";
import type {
  CashAccountBalance,
  InvestmentAccountBalance
} from "../types/configuration";
import type {
  DebtRecord,
  FixedAsset,
  MonthSectionSaveRequest
} from "../types/month";
import type {
  OperationPreviewChange,
  PendingOperationLog
} from "../types/operations";
import type {
  Transaction
} from "../types/transactions";
import { finiteNumber } from "../domain/money";
import {
  isMonth,
  localMonth,
  localTimestamp,
  monthEnd,
  nextMonth,
  normalizeDate,
  previousMonth
} from "../domain/dates";
import { validateTransactions } from "../domain/validators";
import { transactionKey } from "../domain/transactionOperations";
import type { ValidationIssue } from "../domain/validators";
import { RepositoryValidationError, RevisionConflictError, rows, text, transactionFromRow, debtFromRow, normalizeAsset, boolean, type Row } from "./repositoryPrimitives";
import type { MonthWriteDependencies } from "./repositoryWriteContext";

export class MonthWriteRepository {
  constructor(private readonly context: MonthWriteDependencies) {}

  createMonth(db: DatabaseSync, month: string): void {
    if (!isMonth(month)) throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    if (this.context.monthStatus(db, month)) return;
    const months = this.context.getMonths(db);
    const target = months.length ? nextMonth(months.at(-1)!) : localMonth();
    const max = nextMonth(localMonth());
    if (month !== target) {
      throw new RepositoryValidationError({ code: "month.creation_order", params: { target } });
    }
    if (month > max) throw new RepositoryValidationError({ code: "month.creation_limit", params: { max } });
    const draft = db.prepare(
      "SELECT month FROM month_status WHERE status='draft' LIMIT 1"
    ).get() as Row | undefined;
    if (draft) {
      throw new RepositoryValidationError({
        code: "month.draft_exists",
        params: { month: text(draft.month) }
      });
    }
    db.prepare(`
      INSERT INTO month_status
        (month,status,fixed_assets_initialized,updated_at,revision)
      VALUES (?, 'draft', 0, ?, 0)
    `).run(month, localTimestamp());
  }

  deleteMonth(
    db: DatabaseSync,
    month: string,
    expectedRevision: number
  ): Record<string, number> {
    if (this.context.monthStatus(db, month)?.status === "locked") {
      throw new RepositoryValidationError({ code: "month.locked", params: { month } });
    }
    this.context.checkMonthRevision(db, month, expectedRevision);
    let exists = Boolean(this.context.monthStatus(db, month));
    const deleted: Record<string, number> = {};
    for (const table of [
      "transactions",
      "cash_account_balances",
      "investment_account_balances",
      "fixed_assets"
    ]) {
      const present = db.prepare(`SELECT 1 FROM ${table} WHERE month=? LIMIT 1`).get(month);
      exists ||= Boolean(present);
      const result = db.prepare(`DELETE FROM ${table} WHERE month=?`).run(month);
      deleted[table] = Number(result.changes);
    }
    if (!exists) throw new RepositoryValidationError({ code: "month.not_found", params: { month } });
    deleted.month_status = Number(
      db.prepare("DELETE FROM month_status WHERE month=?").run(month).changes
    );
    return deleted;
  }

  ensureFixedAssetsInherited(db: DatabaseSync, month: string): number {
    if (!isMonth(month)) return 0;
    const current = this.context.monthStatus(db, month);
    if (Number(current?.fixed_assets_initialized ?? 0) || current?.status === "locked") return 0;
    const existing = db.prepare(
      "SELECT 1 FROM fixed_assets WHERE month=? LIMIT 1"
    ).get(month);
    let inherited = 0;
    if (!existing) {
      const previous = previousMonth(month);
      if (previous) {
        const source = rows(db.prepare(`
          SELECT * FROM fixed_assets
          WHERE month=? AND status IN ('在用','闲置') ORDER BY id
        `).all(previous));
        const insert = db.prepare(`
          INSERT OR IGNORE INTO fixed_assets
            (month,asset_key,asset_name,category,purchase_date,
             purchase_price,status,note)
          VALUES (?,?,?,?,?,?,?,?)
        `);
        source.forEach((row) => {
          insert.run(
            month, text(row.asset_key), text(row.asset_name), text(row.category),
            text(row.purchase_date) || null, Number(row.purchase_price ?? 0),
            text(row.status) || "在用", text(row.note)
          );
        });
        inherited = source.length;
      }
    }
    db.prepare(`
      INSERT INTO month_status
        (month,status,fixed_assets_initialized,updated_at,revision)
      VALUES (?,?,1,?,0)
      ON CONFLICT(month) DO UPDATE SET
        fixed_assets_initialized=1,updated_at=excluded.updated_at
    `).run(month, text(current?.status) || "draft", localTimestamp());
    return inherited;
  }

  private normalizedTransactions(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): { rows: Transaction[]; issues: ValidationIssue[] } {
    const categories = this.context.categoryDefinitions(db);
    const byKey = new Map(categories.map((row) => [row.category_key, row]));
    const byName = new Map(categories.map((row) => [row.name, row]));
    const accounts = this.accountDefinitions(db);
    const investmentAccounts = [...accounts.entries()]
      .filter(([, accountType]) => accountType === "investment");
    // A missing account is safe to infer only when the database has one
    // possible investment destination.  With multiple destinations, an
    // imported deposit/withdrawal must be explicitly assigned in the draft;
    // silently choosing the first account corrupts account-level history.
    const defaultInvestmentAccount = investmentAccounts.length === 1
      ? investmentAccounts[0][0]
      : null;
    const issues = validateTransactions(input, month, categories);
    const normalized = input.map((row, index) => {
      const type = text(row.type);
      let definition = byKey.get(text(row.category_key)) ?? byName.get(text(row.category));
      if (["加仓", "提现"].includes(type)) definition = undefined;
      let transactionDate: string;
      try {
        transactionDate = normalizeDate(row.transaction_date, month);
      } catch {
        transactionDate = `${month}-01`;
      }
      let amount: number;
      try {
        amount = finiteNumber(row.amount);
      } catch {
        amount = 0;
      }
      const rawAccountKey = text(row.account_key);
      const accountKey = ["加仓", "提现"].includes(type)
        ? rawAccountKey || defaultInvestmentAccount
        : null;
      if (["加仓", "提现"].includes(type)
        && (!accountKey || accounts.get(accountKey) !== "investment")) {
        issues.push({
          severity: "错误",
          blocking: true,
          row_index: index,
          type,
          product: text(row.product) || "(空商品)",
          field: "账户",
          issue: "加仓或提现必须选择有效的理财账户",
          suggestion: "选择一个理财账户后再保存"
        });
      }
      return {
        ...row,
        transaction_date: transactionDate,
        type,
        account_key: accountKey,
        counterparty: ["加仓", "提现"].includes(type) ? type : text(row.counterparty),
        product: ["加仓", "提现"].includes(type)
          ? accountKey ?? type
          : text(row.product),
        source: text(row.source),
        amount,
        category_key: definition?.category_key ?? null,
        category: definition?.name ?? ""
      };
    });
    return { rows: normalized, issues };
  }

  validateTransactionRows(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): ValidationIssue[] {
    return this.normalizedTransactions(db, month, input).issues;
  }

  /**
   * Reconcile an operation preview against the canonical rows immediately
   * before the monthly transaction write. The UI preview is only a proposal:
   * ids, rule revision, protection metadata and before-values are checked again
   * inside the same write transaction, and the audit payload is rebuilt from
   * the rows that are actually submitted.
   */
  validateOperationLogs(
    db: DatabaseSync,
    month: string,
    input: Transaction[],
    logs: PendingOperationLog[] = []
  ): PendingOperationLog[] {
    if (!logs.length) return [];
    const current = rows(db.prepare(`
      SELECT id,month,transaction_date,type,category_key,category,counterparty,product,source,account_key,amount
      FROM transactions WHERE month=? ORDER BY id
    `).all(month)).map(transactionFromRow);
    const currentById = new Map(current.flatMap((row) =>
      typeof row.id === "number" ? [[row.id, row] as const] : []
    ));
    const virtualById = new Map(currentById);
    const virtualByKey = new Map<string, Transaction>();
    const submittedById = new Map(input.flatMap((row) =>
      typeof row.id === "number" ? [[row.id, row] as const] : []
    ));
    const submittedByKey = new Map(input.map((row, index) => [transactionKey(row, index), row] as const));
    const rulesRevision = this.context.rules(db).revision;
    const currentRevision = this.context.getRevision(month, db);
    const reconciled: PendingOperationLog[] = [];
    const touchedIds = new Set<number>();
    const touchedKeys = new Set<string>();
    for (const entry of logs) {
      const metadata = entry.preview.metadata ?? {};
      const expectedRulesRevision = metadata.rules_revision;
      if (typeof expectedRulesRevision === "number"
        && Number.isFinite(expectedRulesRevision)
        && expectedRulesRevision !== rulesRevision) {
        throw new RevisionConflictError(expectedRulesRevision, rulesRevision);
      }
      const expectedRevision = Number(metadata.expected_revision);
      if (metadata.expected_revision !== undefined
        && (!Number.isFinite(expectedRevision) || expectedRevision !== currentRevision)) {
        throw new RevisionConflictError(
          Number.isFinite(expectedRevision) ? expectedRevision : 0,
          currentRevision
        );
      }
      const selection = new Set(entry.selection);
      const rawChangeKeys = entry.preview.changes.map((change) =>
        change.transaction_key ?? (change.transaction_id === null ? "" : `id:${change.transaction_id}`)
      );
      if (rawChangeKeys.some((key) => !key)
        || new Set(rawChangeKeys).size !== rawChangeKeys.length
        || !sameStringSet(selection, new Set(rawChangeKeys))) {
        throw new RepositoryValidationError({ code: "operation.preview_selection_mismatch" });
      }
      const metadataKeys = Array.isArray(metadata.transaction_keys)
        ? metadata.transaction_keys.filter((value): value is string => typeof value === "string")
        : [];
      if (metadataKeys.length && !sameStringSet(selection, new Set(metadataKeys))) {
        throw new RepositoryValidationError({ code: "operation.preview_metadata_mismatch" });
      }
      const declaredIds = Array.isArray(metadata.transaction_ids)
        ? metadata.transaction_ids.filter((value): value is number => typeof value === "number")
        : [];
      const changeIds = entry.preview.changes.flatMap((change) =>
        change.transaction_id === null ? [] : [change.transaction_id]
      );
      if (declaredIds.length && !sameNumberSet(new Set(declaredIds), new Set(changeIds))) {
        throw new RepositoryValidationError({ code: "operation.preview_ids_mismatch" });
      }
      const declaredCounts = {
        total_count: entry.preview.changes.length,
        change_count: entry.preview.changes.filter((change) => change.status === "change").length,
        skipped_count: entry.preview.changes.filter((change) => change.status === "skip").length,
        failure_count: entry.preview.changes.filter((change) => change.status === "failure").length,
        protected_count: entry.preview.changes.filter((change) => change.reason === "位于本次保护范围").length
      };
      if (entry.preview.total_count !== declaredCounts.total_count
        || entry.preview.change_count !== declaredCounts.change_count
        || entry.preview.skipped_count !== declaredCounts.skipped_count
        || entry.preview.failure_count !== declaredCounts.failure_count
        || (entry.preview.protected_count ?? declaredCounts.protected_count) !== declaredCounts.protected_count) {
        throw new RepositoryValidationError({ code: "operation.preview_counts_changed" });
      }
      this.validateOperationTarget(db, entry.preview.operation_type, metadata, entry.preview.changes);
      const changes = entry.preview.changes.map((change) => {
        if (change.month && change.month !== month) {
          throw new RepositoryValidationError({ code: "operation.preview_month_mismatch" });
        }
        const key = change.transaction_key ?? (change.transaction_id === null ? "" : `id:${change.transaction_id}`);
        const canonical = change.transaction_id === null
          ? virtualByKey.get(key)
          : virtualById.get(change.transaction_id);
        if (change.transaction_id !== null && !currentById.has(change.transaction_id)) {
          throw new RepositoryValidationError({ code: "operation.preview_row_deleted" });
        }
        const submitted = change.transaction_id !== null
          ? submittedById.get(change.transaction_id)
          : submittedByKey.get(change.transaction_key ?? "");
        if (!submitted) {
          throw new RepositoryValidationError({ code: "operation.preview_row_missing" });
        }
        if (!hasOperationFields(change.before) || !hasOperationFields(change.after)) {
          throw new RepositoryValidationError({ code: "operation.preview_fields_missing" });
        }
        if (canonical && !matchesExpectedFields(canonical, change.before)) {
          throw new RevisionConflictError(
            metadata.expected_revision === undefined
              ? 0
              : Number(metadata.expected_revision),
            currentRevision
          );
        }
        const after = change.after;
        const changed = !sameJson(change.before, after);
        if ((change.status === "skip" || change.status === "failure") && changed) {
          throw new RepositoryValidationError({ code: "operation.preview_status_changed" });
        }
        if (change.status === "change" && !changed) {
          throw new RepositoryValidationError({ code: "operation.preview_change_mismatch" });
        }
        const status: OperationPreviewChange["status"] = change.status === "failure"
          ? "failure"
          : changed ? "change" : "skip";
        const nextVirtual = transactionFromOperationFields(after, canonical ?? submitted);
        if (change.transaction_id !== null) {
          virtualById.set(change.transaction_id, nextVirtual);
          touchedIds.add(change.transaction_id);
        }
        else if (key) virtualByKey.set(key, nextVirtual);
        if (change.transaction_id === null) touchedKeys.add(key);
        return {
          ...change,
          transaction_key: key,
          before: canonical ? operationFields(canonical) : change.before,
          after,
          status,
          reason: status === "skip"
            ? change.reason ?? "保存前后没有字段变化"
            : change.reason
        };
      });
      const preview = {
        ...entry.preview,
        total_count: changes.length,
        change_count: changes.filter((change) => change.status === "change").length,
        skipped_count: changes.filter((change) => change.status === "skip").length,
        failure_count: changes.filter((change) => change.status === "failure").length,
        protected_count: changes.filter((change) => change.reason === "位于本次保护范围").length,
        changes,
        metadata: {
          ...metadata,
          expected_revision: currentRevision,
          committed_from_canonical_rows: true
        }
      };
      reconciled.push({ ...entry, preview });
    }
    for (const id of touchedIds) {
      const expected = virtualById.get(id);
      const actual = submittedById.get(id);
      if (!expected || !actual || !sameJson(operationFields(expected), operationFields(actual))) {
        throw new RepositoryValidationError({ code: "operation.preview_draft_mismatch" });
      }
    }
    for (const key of touchedKeys) {
      const expected = virtualByKey.get(key);
      const actual = submittedByKey.get(key);
      if (!expected || !actual || !sameJson(operationFields(expected), operationFields(actual))) {
        throw new RepositoryValidationError({ code: "operation.preview_draft_mismatch" });
      }
    }
    return reconciled;
  }

  private validateOperationTarget(
    db: DatabaseSync,
    operationType: string,
    metadata: Record<string, unknown>,
    changes: OperationPreviewChange[]
  ): void {
    if (operationType !== "bulk-edit-category") return;
    const targetKey = text(metadata.target_category_key);
    const targetValue = text(metadata.target_value);
    const category = this.context.categoryDefinitions(db).find((row) => row.category_key === targetKey);
    const isUncategorized = !targetKey && !targetValue;
    const selectedTypes = new Set<string>();
    if (isUncategorized) {
      for (const change of changes) {
        const type = scalarOperationText(change.before.type, "");
        const categoryType = type === "代付" ? "支出" : type;
        if (categoryType !== "支出" && categoryType !== "收入") {
          throw new RepositoryValidationError({ code: "transaction.category.invalid_selection" });
        }
        selectedTypes.add(categoryType);
        if (selectedTypes.size > 1) {
          throw new RepositoryValidationError({ code: "transaction.category.mixed_types" });
        }
        if (scalarOperationText(change.after.category_key, "")
          || scalarOperationText(change.after.category, "")) {
          throw new RepositoryValidationError({ code: "operation.preview_uncategorized_changed" });
        }
      }
      return;
    }
    if (!category || !category.is_active) {
      throw new RepositoryValidationError({ code: "transaction.category.invalid_target" });
    }
    for (const change of changes) {
      const type = scalarOperationText(change.before.type, "");
      const categoryType = type === "代付" ? "支出" : type;
      if (categoryType !== "支出" && categoryType !== "收入") {
        throw new RepositoryValidationError({ code: "transaction.category.invalid_selection" });
      }
      selectedTypes.add(categoryType);
      if (selectedTypes.size > 1) {
        throw new RepositoryValidationError({ code: "transaction.category.mixed_types" });
      }
      if (category.transaction_type !== categoryType) {
        throw new RepositoryValidationError({ code: "transaction.category.mismatched_target" });
      }
      if (scalarOperationText(change.after.category_key, "") !== targetKey
        || scalarOperationText(change.after.category, "") !== category.name) {
        throw new RepositoryValidationError({ code: "operation.preview_category_changed" });
      }
    }
  }

  private saveTransactionRows(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): Transaction[] {
    const normalized = this.normalizedTransactions(db, month, input);
    if (normalized.issues.some((issue) => issue.blocking)) {
      throw new RepositoryValidationError({ code: "transaction.validation_failed", issues: normalized.issues });
    }
    const existing = new Set(rows(db.prepare(
      "SELECT id FROM transactions WHERE month=?"
    ).all(month)).map((row) => Number(row.id)));
    const submitted = new Set<number>();
    const insert = db.prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category_key,category,counterparty,product,source,account_key,amount)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE transactions SET
        transaction_date=?,type=?,category_key=?,category=?,counterparty=?,product=?,source=?,account_key=?,amount=?
      WHERE id=? AND month=?
    `);
    for (const row of normalized.rows) {
      const values = [
        row.transaction_date, row.type, row.category_key ?? null,
        row.category, row.counterparty ?? "", row.product, row.source ?? "", row.account_key ?? null, row.amount
      ] as const;
      if (row.id === undefined) {
        row.id = Number(insert.run(month, ...values).lastInsertRowid);
      } else {
        const id = Number(row.id);
        if (!existing.has(id) || submitted.has(id)) {
          throw new RepositoryValidationError({ code: "transaction.id_invalid" });
        }
        submitted.add(id);
        update.run(...values, id, month);
      }
    }
    const remove = db.prepare("DELETE FROM transactions WHERE id=?");
    for (const id of existing) if (!submitted.has(id)) remove.run(id);
    return rows(db.prepare(`
      SELECT id,transaction_date,type,category_key,category,counterparty,product,source,account_key,amount
      FROM transactions WHERE month=? ORDER BY id
    `).all(month)).map(transactionFromRow);
  }

  saveMonth(
    db: DatabaseSync,
    month: string,
    expectedRevision: number,
    cashAccounts: CashAccountBalance[],
    investmentAccounts: InvestmentAccountBalance[],
    transactions: Transaction[],
    fixedAssets: FixedAsset[],
    debts?: {
      expected_revision: number;
      rows: DebtRecord[];
    }
  ): number {
    if (this.context.monthStatus(db, month)?.status === "locked") {
      throw new RepositoryValidationError({ code: "month.locked", params: { month } });
    }
    const current = this.context.checkMonthRevision(db, month, expectedRevision);
    if (debts) this.saveMonthDebtRows(db, month, debts.expected_revision, debts.rows);
    this.saveAccountBalances(db, month, cashAccounts, investmentAccounts);
    this.saveTransactionRows(db, month, transactions);
    this.saveFixedAssets(db, month, fixedAssets);
    return this.context.touchMonth(db, month, current, 1);
  }

  saveMonthSection(db: DatabaseSync, month: string, payload: MonthSectionSaveRequest): number {
    if (this.context.monthStatus(db, month)?.status === "locked") {
      throw new RepositoryValidationError({ code: "month.locked", params: { month } });
    }
    const current = this.context.checkMonthRevision(db, month, payload.expected_revision);
    switch (payload.section) {
      case "assets":
        this.saveAccountBalances(db, month, payload.cash_accounts, payload.investment_accounts);
        break;
      case "transactions":
        this.saveTransactionRows(db, month, payload.transactions);
        break;
      case "debts":
        this.saveMonthDebtRows(db, month, payload.debt_revision, payload.debts);
        break;
      case "fixed_assets":
        this.saveFixedAssets(db, month, payload.fixed_assets);
        break;
      default: {
        const section = (payload as { section?: unknown }).section;
        const sectionText = typeof section === "string" || typeof section === "number"
          ? String(section)
          : "";
        throw new RepositoryValidationError({
          code: "month.section_invalid",
          params: { section: sectionText }
        });
      }
    }
    return this.context.touchMonth(db, month, current, 1);
  }

  private accountDefinitions(db: DatabaseSync): Map<string, string> {
    return new Map(rows(db.prepare(
      `SELECT account_key,account_type
       FROM account_definitions
       ORDER BY account_type,is_active DESC,sort_order,account_key`
    ).all()).map((row) => [text(row.account_key), text(row.account_type)]));
  }

  private saveAccountBalances(
    db: DatabaseSync,
    month: string,
    cashAccounts: CashAccountBalance[],
    investmentAccounts: InvestmentAccountBalance[]
  ): void {
    const definitions = this.accountDefinitions(db);
    const requiredCash = new Set(rows(db.prepare(`
      SELECT d.account_key
      FROM account_definitions d
      LEFT JOIN cash_account_balances b
        ON b.account_key=d.account_key AND b.month=?
      WHERE d.account_type='cash' AND (d.is_active=1 OR b.account_key IS NOT NULL)
    `).all(month)).map((row) => text(row.account_key)));
    const requiredInvestment = new Set(rows(db.prepare(`
      SELECT d.account_key
      FROM account_definitions d
      LEFT JOIN investment_account_balances b
        ON b.account_key=d.account_key AND b.month=?
      WHERE d.account_type='investment' AND (d.is_active=1 OR b.account_key IS NOT NULL)
    `).all(month)).map((row) => text(row.account_key)));
    db.prepare("DELETE FROM cash_account_balances WHERE month=?").run(month);
    const seenCash = new Set<string>();
    const cashInsert = db.prepare(
      "INSERT INTO cash_account_balances(month,account_key,balance) VALUES (?,?,?)"
    );
    cashAccounts.forEach((row) => {
      const key = text(row.account_key);
      if (definitions.get(key) !== "cash" || seenCash.has(key)) {
        throw new RepositoryValidationError({ code: "account.cash_invalid" });
      }
      seenCash.add(key);
      cashInsert.run(month, key, finiteNumber(row.balance, { nonNegative: true }));
    });
    const missingCash = [...requiredCash].filter((key) => !seenCash.has(key));
    if (missingCash.length) {
      throw new RepositoryValidationError({
        code: "account.cash_missing",
        params: { account_keys: missingCash }
      });
    }
    db.prepare("DELETE FROM investment_account_balances WHERE month=?").run(month);
    const seenInvestment = new Set<string>();
    const investmentInsert = db.prepare(`
      INSERT INTO investment_account_balances
        (month,account_key,principal,market_value,cash_balance)
      VALUES (?,?,?,?,?)
    `);
    investmentAccounts.forEach((row) => {
      const key = text(row.account_key);
      if (definitions.get(key) !== "investment" || seenInvestment.has(key)) {
        throw new RepositoryValidationError({ code: "account.investment_invalid" });
      }
      seenInvestment.add(key);
      investmentInsert.run(
        month, key,
        finiteNumber(row.principal, { nonNegative: true }),
        finiteNumber(row.market_value, { nonNegative: true }),
        finiteNumber(row.cash_balance, { nonNegative: true })
      );
    });
    const missingInvestment = [...requiredInvestment].filter((key) => !seenInvestment.has(key));
    if (missingInvestment.length) {
      throw new RepositoryValidationError({
        code: "account.investment_missing",
        params: { account_keys: missingInvestment }
      });
    }
  }

  private saveFixedAssets(
    db: DatabaseSync,
    month: string,
    fixedAssets: FixedAsset[]
  ): void {
    const existingAssets = new Map(rows(db.prepare(
      "SELECT id,asset_key FROM fixed_assets WHERE month=?"
    ).all(month)).map((row) => [text(row.asset_key), Number(row.id)]));
    const existingById = new Map(rows(db.prepare(
      "SELECT id,asset_key FROM fixed_assets WHERE month=?"
    ).all(month)).map((row) => [Number(row.id), text(row.asset_key)]));
    const submittedAssets = new Set<string>();
    const insertAsset = db.prepare(`
      INSERT INTO fixed_assets
        (month,asset_key,asset_name,category,purchase_date,purchase_price,status,note)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const updateAsset = db.prepare(`
      UPDATE fixed_assets SET
        asset_name=?,category=?,purchase_date=?,purchase_price=?,status=?,note=?
      WHERE id=? AND month=?
    `);
    fixedAssets.forEach((source, index) => {
      const sourceId = source.id === undefined || source.id === null
        ? null : Number(source.id);
      const existingKey = sourceId === null ? undefined : existingById.get(sourceId);
      if (sourceId !== null && !existingKey) {
        throw new RepositoryValidationError({ code: "fixed_asset.id_invalid" });
      }
      const row = normalizeAsset(
        existingKey && !text(source.asset_key)
          ? { ...source, asset_key: existingKey }
          : source,
        index
      );
      if (sourceId !== null && row.asset_key !== existingKey) {
        throw new RepositoryValidationError({ code: "fixed_asset.identity_conflict" });
      }
      if (submittedAssets.has(row.asset_key)) {
        throw new RepositoryValidationError({ code: "fixed_asset.key_duplicate" });
      }
      submittedAssets.add(row.asset_key);
      const id = existingAssets.get(row.asset_key);
      const values = [
        row.asset_name, row.category, row.purchase_date ?? null,
        row.purchase_price, row.status, row.note
      ] as const;
      if (id) updateAsset.run(...values, id, month);
      else insertAsset.run(month, row.asset_key, ...values);
    });
    const deleteAsset = db.prepare("DELETE FROM fixed_assets WHERE id=?");
    for (const [key, id] of existingAssets) {
      if (!submittedAssets.has(key)) deleteAsset.run(id);
    }
  }

  private debtRowsForMonth(
    db: DatabaseSync,
    month: string,
    viewState: boolean
  ): DebtRecord[] {
    if (!isMonth(month)) throw new RepositoryValidationError({ code: "month.invalid", params: { month } });
    const start = `${month}-01`;
    const end = monthEnd(month);
    return rows(db.prepare(`
      SELECT * FROM debt_manager
      WHERE start_date<=?
        AND (
          is_paid=0
          OR paid_date>?
          OR (
            paid_date>=?
            AND paid_date<=?
          )
          OR (
            start_date>=?
            AND start_date<=?
          )
        )
      ORDER BY
        CASE
          WHEN is_paid=0 OR paid_date>? THEN 0
          ELSE 1
        END,
        start_date DESC,
        id
    `).all(end, end, start, end, start, end, end)).map((row) => {
      const debt = debtFromRow(row);
      return viewState
        ? {
            ...debt,
            is_paid: Boolean(debt.is_paid && debt.paid_date && debt.paid_date <= end)
          }
        : debt;
    });
  }

  private saveMonthDebtRows(
    db: DatabaseSync,
    month: string,
    expectedRevision: number,
    input: DebtRecord[]
  ): void {
    const current = this.context.monthDebts(db, month);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    const end = monthEnd(month);
    const currentFacts = new Map(
      this.debtRowsForMonth(db, month, false)
        .filter((row) => row.id !== undefined)
        .map((row) => [Number(row.id), row])
    );
    const submitted = new Set<number>();
    const insert = db.prepare(`
      INSERT INTO debt_manager
        (description,counterparty,amount,start_date,is_paid,paid_date)
      VALUES (?,?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE debt_manager SET
        description=?,counterparty=?,amount=?,start_date=?,is_paid=?,paid_date=?
      WHERE id=?
    `);
    for (const row of input) {
      const id = row.id === undefined || row.id === null ? null : Number(row.id);
      const source = id === null ? null : currentFacts.get(id);
      if (id !== null) {
        if (!source || submitted.has(id)) throw new RepositoryValidationError({ code: "debt.id_invalid" });
        submitted.add(id);
      }
      const startsThisMonth = source ? source.start_date.slice(0, 7) === month : true;
      const nextPaidInThisMonth = boolean(row.is_paid);
      const description = startsThisMonth ? text(row.description) : source?.description ?? "";
      const counterparty = startsThisMonth ? text(row.counterparty) : source?.counterparty ?? "";
      const amount = startsThisMonth
        ? finiteNumber(row.amount, { label: "借款金额" })
        : source?.amount ?? 0;
      const sourcePaidInFuture = Boolean(
        source?.is_paid && source.paid_date && source.paid_date > end
      );
      if (source && sourcePaidInFuture && (
        nextPaidInThisMonth
        || description !== source.description
        || counterparty !== source.counterparty
        || amount !== source.amount
      )) {
        throw new RepositoryValidationError({
          code: "debt.future_locked",
          params: { paid_date: source.paid_date ?? "" }
        });
      }
      const sourcePaidInThisMonth = Boolean(
        source?.is_paid && source.paid_date && source.paid_date <= end
      );
      const paidDate = nextPaidInThisMonth
        ? sourcePaidInThisMonth ? source?.paid_date ?? end : end
        : source?.is_paid && source.paid_date && source.paid_date > end
          ? source.paid_date
          : null;
      const values = [
        description,
        counterparty,
        amount,
        source?.start_date ?? `${month}-01`,
        paidDate !== null ? 1 : 0,
        paidDate
      ] as const;
      if (id === null) insert.run(...values);
      else update.run(...values, id);
    }
    const remove = db.prepare("DELETE FROM debt_manager WHERE id=?");
    for (const row of currentFacts.values()) {
      if (row.id === undefined || submitted.has(Number(row.id))) continue;
      if (row.start_date.slice(0, 7) === month) {
        if (row.is_paid && row.paid_date && row.paid_date > end) {
          throw new RepositoryValidationError({
            code: "debt.future_locked",
            params: { paid_date: row.paid_date }
          });
        }
        remove.run(Number(row.id));
      }
    }
  }

  saveDebts(db: DatabaseSync, expectedRevision: number, input: Row[]): void {
    const current = this.context.debts(db);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    const existingRows = rows(db.prepare("SELECT * FROM debt_manager").all())
      .map(debtFromRow);
    const existing = new Map(existingRows.flatMap((row) =>
      row.id === undefined ? [] : [[Number(row.id), row] as const]
    ));
    const submitted = new Set<number>();
    const currentEnd = monthEnd(localMonth());
    const isFutureLocked = (row: DebtRecord): boolean => Boolean(
      row.is_paid && row.paid_date && row.paid_date > currentEnd
    );
    const insert = db.prepare(`
      INSERT INTO debt_manager
        (description,counterparty,amount,start_date,is_paid,paid_date)
      VALUES (?,?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE debt_manager SET
        description=?,counterparty=?,amount=?,start_date=?,is_paid=?,paid_date=?
      WHERE id=?
    `);
    for (const row of input) {
      let startDate: string;
      let paidDate: string | null = null;
      try {
        startDate = normalizeDate(row.start_date);
      } catch {
        throw new RepositoryValidationError({ code: "debt.start_date_invalid" });
      }
      if (text(row.paid_date)) {
        try { paidDate = normalizeDate(row.paid_date); } catch {
          throw new RepositoryValidationError({ code: "debt.paid_date_invalid" });
        }
      }
      const isPaid = boolean(row.is_paid);
      if (isPaid && !paidDate) throw new RepositoryValidationError({ code: "debt.paid_date_required" });
      if (!isPaid && paidDate) throw new RepositoryValidationError({ code: "debt.paid_date_unexpected" });
      if (paidDate && paidDate < startDate) {
        throw new RepositoryValidationError({ code: "debt.paid_date_before_start" });
      }
      const id = row.id === undefined || row.id === null ? null : Number(row.id);
      const source = id === null ? null : existing.get(id);
      if (id !== null && (!source || submitted.has(id))) {
        throw new RepositoryValidationError({ code: "debt.id_invalid" });
      }
      if (source && isFutureLocked(source) && (
        text(source.description) !== text(row.description)
        || text(source.counterparty) !== text(row.counterparty)
        || source.amount !== finiteNumber(row.amount)
        || source.start_date !== startDate
        || source.is_paid !== isPaid
        || (source.paid_date ?? null) !== paidDate
      )) {
        throw new RepositoryValidationError({
          code: "debt.future_locked",
          params: { paid_date: source.paid_date ?? "" }
        });
      }
      const values = [
        text(row.description), text(row.counterparty), finiteNumber(row.amount),
        startDate, isPaid ? 1 : 0, paidDate
      ] as const;
      if (id === null) {
        insert.run(...values);
      } else {
        submitted.add(id);
        update.run(...values, id);
      }
    }
    const remove = db.prepare("DELETE FROM debt_manager WHERE id=?");
    for (const [id, row] of existing) {
      if (submitted.has(id)) continue;
      if (isFutureLocked(row)) {
        throw new RepositoryValidationError({
          code: "debt.future_locked",
          params: { paid_date: row.paid_date ?? "" }
        });
      }
      remove.run(id);
    }
  }
}

function operationFields(row: Transaction): Record<string, unknown> {
  return {
    transaction_date: row.transaction_date,
    type: row.type,
    account_key: row.account_key ?? null,
    counterparty: row.counterparty ?? "",
    product: row.product,
    source: row.source ?? "",
    category_key: row.category_key ?? null,
    category: row.category,
    amount: row.amount
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sameNumberSet(left: Set<number>, right: Set<number>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function hasOperationFields(value: Record<string, unknown>): boolean {
  return [
    "transaction_date",
    "type",
    "account_key",
    "counterparty",
    "product",
    "source",
    "category_key",
    "category",
    "amount"
  ].every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function matchesExpectedFields(row: Transaction, expected: Record<string, unknown>): boolean {
  const actual = operationFields(row);
  return Object.entries(expected).every(([key, value]) => sameJson(actual[key], value));
}

function transactionFromOperationFields(
  fields: Record<string, unknown>,
  base: Transaction
): Transaction {
  return {
    ...base,
    transaction_date: scalarOperationText(fields.transaction_date, base.transaction_date),
    type: scalarOperationText(fields.type, base.type),
    account_key: fields.account_key === null || fields.account_key === undefined
      ? null
      : scalarOperationText(fields.account_key, base.account_key ?? ""),
    counterparty: scalarOperationText(fields.counterparty, base.counterparty ?? ""),
    product: scalarOperationText(fields.product, base.product),
    source: scalarOperationText(fields.source, base.source ?? ""),
    category_key: fields.category_key === null || fields.category_key === undefined
      ? null
      : scalarOperationText(fields.category_key, ""),
    category: scalarOperationText(fields.category, base.category),
    amount: Number(fields.amount ?? base.amount)
  };
}

function scalarOperationText(value: unknown, fallback: string): string {
  return value === undefined || value === null ? fallback : text(value);
}
