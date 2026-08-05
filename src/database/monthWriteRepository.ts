import type { DatabaseSync } from "node:sqlite";
import type {
  CashAccountBalance,
  DebtRecord,
  FixedAsset,
  InvestmentAccountBalance,
  MonthSectionSaveRequest,
  Transaction
} from "../types";
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
import type { ValidationIssue } from "../domain/validators";
import { RepositoryValidationError, RevisionConflictError, rows, text, transactionFromRow, debtFromRow, normalizeAsset, boolean, type Row } from "./repositoryPrimitives";
import type { RepositoryWriteContext } from "./repositoryWriteContext";

export class MonthWriteRepository {
  constructor(private readonly context: RepositoryWriteContext) {}

  createMonth(db: DatabaseSync, month: string): void {
    if (!isMonth(month)) throw new RepositoryValidationError(`非法月份：${month}`);
    if (this.context.monthStatus(db, month)) return;
    const months = this.context.getMonths(db);
    const target = months.length ? nextMonth(months.at(-1)!) : localMonth();
    const max = nextMonth(localMonth());
    if (month !== target) {
      throw new RepositoryValidationError(`只能按自然顺序创建下一个月份 ${target}`);
    }
    if (month > max) throw new RepositoryValidationError(`当前最多只能创建到 ${max}`);
    const draft = db.prepare(
      "SELECT month FROM month_status WHERE status='draft' LIMIT 1"
    ).get() as Row | undefined;
    if (draft) {
      throw new RepositoryValidationError(
        `最多只能有一个草稿月份；请先保存或删除 ${text(draft.month)}`
      );
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
    if (!exists) throw new RepositoryValidationError(`${month} 不存在，无需删除`);
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
    const categories = this.context.categoryRows(db);
    const byKey = new Map(categories.map((row) => [row.category_key, row]));
    const byName = new Map(categories.map((row) => [row.name, row]));
    const issues = validateTransactions(input, month, categories);
    const normalized = input.map((row) => {
      const type = text(row.type);
      let definition = byKey.get(text(row.category_key)) ?? byName.get(text(row.category));
      if (["代付", "加仓", "提现"].includes(type)) definition = undefined;
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
      return {
        ...row,
        transaction_date: transactionDate,
        type,
        counterparty: text(row.counterparty),
        product: text(row.product),
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

  private saveTransactionRows(
    db: DatabaseSync,
    month: string,
    input: Transaction[]
  ): Transaction[] {
    const normalized = this.normalizedTransactions(db, month, input);
    if (normalized.issues.some((issue) => issue.blocking)) {
      throw new RepositoryValidationError("流水质检未通过", normalized.issues);
    }
    const existing = new Set(rows(db.prepare(
      "SELECT id FROM transactions WHERE month=?"
    ).all(month)).map((row) => Number(row.id)));
    const submitted = new Set<number>();
    const insert = db.prepare(`
      INSERT INTO transactions
        (month,transaction_date,type,category_key,category,counterparty,product,amount)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const update = db.prepare(`
      UPDATE transactions SET
        transaction_date=?,type=?,category_key=?,category=?,counterparty=?,product=?,amount=?
      WHERE id=? AND month=?
    `);
    for (const row of normalized.rows) {
      const values = [
        row.transaction_date, row.type, row.category_key ?? null,
        row.category, row.counterparty ?? "", row.product, row.amount
      ] as const;
      if (row.id === undefined) {
        row.id = Number(insert.run(month, ...values).lastInsertRowid);
      } else {
        const id = Number(row.id);
        if (!existing.has(id) || submitted.has(id)) {
          throw new RepositoryValidationError("流水 id 不属于当前月份或重复");
        }
        submitted.add(id);
        update.run(...values, id, month);
      }
    }
    const remove = db.prepare("DELETE FROM transactions WHERE id=?");
    for (const id of existing) if (!submitted.has(id)) remove.run(id);
    return rows(db.prepare(`
      SELECT id,transaction_date,type,category_key,category,counterparty,product,amount
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
    const current = this.context.checkMonthRevision(db, month, expectedRevision);
    if (debts) this.saveMonthDebtRows(db, month, debts.expected_revision, debts.rows);
    const definitions = new Map(rows(db.prepare(
        "SELECT account_key,account_type FROM account_definitions"
      ).all()).map((row) => [text(row.account_key), text(row.account_type)]));
      db.prepare("DELETE FROM cash_account_balances WHERE month=?").run(month);
      const seenCash = new Set<string>();
      const cashInsert = db.prepare(
        "INSERT INTO cash_account_balances(month,account_key,balance) VALUES (?,?,?)"
      );
      cashAccounts.forEach((row) => {
        const key = text(row.account_key);
        if (definitions.get(key) !== "cash" || seenCash.has(key)) {
          throw new RepositoryValidationError("现金账户无效或重复");
        }
        seenCash.add(key);
        cashInsert.run(month, key, finiteNumber(row.balance, { nonNegative: true }));
      });
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
          throw new RepositoryValidationError("理财账户无效或重复");
        }
        seenInvestment.add(key);
        investmentInsert.run(
          month, key,
          finiteNumber(row.principal, { nonNegative: true }),
          finiteNumber(row.market_value, { nonNegative: true }),
          finiteNumber(row.cash_balance, { nonNegative: true })
        );
      });
      this.saveTransactionRows(db, month, transactions);
      this.saveFixedAssets(db, month, fixedAssets);
    return this.context.touchMonth(db, month, current, 1);
  }

  saveMonthSection(db: DatabaseSync, month: string, payload: MonthSectionSaveRequest): number {
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
      }
    return this.context.touchMonth(db, month, current, 1);
  }

  private accountDefinitions(db: DatabaseSync): Map<string, string> {
    return new Map(rows(db.prepare(
      "SELECT account_key,account_type FROM account_definitions"
    ).all()).map((row) => [text(row.account_key), text(row.account_type)]));
  }

  private saveAccountBalances(
    db: DatabaseSync,
    month: string,
    cashAccounts: CashAccountBalance[],
    investmentAccounts: InvestmentAccountBalance[]
  ): void {
    const definitions = this.accountDefinitions(db);
    db.prepare("DELETE FROM cash_account_balances WHERE month=?").run(month);
    const seenCash = new Set<string>();
    const cashInsert = db.prepare(
      "INSERT INTO cash_account_balances(month,account_key,balance) VALUES (?,?,?)"
    );
    cashAccounts.forEach((row) => {
      const key = text(row.account_key);
      if (definitions.get(key) !== "cash" || seenCash.has(key)) {
        throw new RepositoryValidationError("现金账户无效或重复");
      }
      seenCash.add(key);
      cashInsert.run(month, key, finiteNumber(row.balance, { nonNegative: true }));
    });
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
        throw new RepositoryValidationError("理财账户无效或重复");
      }
      seenInvestment.add(key);
      investmentInsert.run(
        month, key,
        finiteNumber(row.principal, { nonNegative: true }),
        finiteNumber(row.market_value, { nonNegative: true }),
        finiteNumber(row.cash_balance, { nonNegative: true })
      );
    });
  }

  private saveFixedAssets(
    db: DatabaseSync,
    month: string,
    fixedAssets: FixedAsset[]
  ): void {
    const existingAssets = new Map(rows(db.prepare(
      "SELECT id,asset_key FROM fixed_assets WHERE month=?"
    ).all(month)).map((row) => [text(row.asset_key), Number(row.id)]));
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
      const row = normalizeAsset(source, index);
      if (submittedAssets.has(row.asset_key)) {
        throw new RepositoryValidationError("固定资产 asset_key 重复");
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
    for (const [key, id] of existingAssets) {
      if (!submittedAssets.has(key)) db.prepare("DELETE FROM fixed_assets WHERE id=?").run(id);
    }
  }

  private debtRowsForMonth(
    db: DatabaseSync,
    month: string,
    viewState: boolean
  ): DebtRecord[] {
    if (!isMonth(month)) throw new RepositoryValidationError(`非法月份：${month}`);
    const start = `${month}-01`;
    const end = monthEnd(month);
    return rows(db.prepare(`
      SELECT * FROM debt_manager
      WHERE REPLACE(start_date,'/','-')<=?
        AND (
          is_paid=0
          OR REPLACE(paid_date,'/','-')>?
          OR (
            REPLACE(paid_date,'/','-')>=?
            AND REPLACE(paid_date,'/','-')<=?
          )
          OR (
            REPLACE(start_date,'/','-')>=?
            AND REPLACE(start_date,'/','-')<=?
          )
        )
      ORDER BY
        CASE
          WHEN is_paid=0 OR REPLACE(paid_date,'/','-')>? THEN 0
          ELSE 1
        END,
        start_date DESC,
        id
    `).all(end, end, start, end, start, end, end)).map((row) => {
      const debt = debtFromRow(row);
      const normalized: DebtRecord = {
        ...debt,
        start_date: (() => {
          try { return normalizeDate(debt.start_date); } catch { return debt.start_date; }
        })(),
        paid_date: debt.paid_date
          ? (() => {
            try { return normalizeDate(debt.paid_date); } catch { return debt.paid_date; }
          })()
          : null
      };
      return viewState
        ? {
            ...normalized,
            is_paid: Boolean(normalized.is_paid && normalized.paid_date && normalized.paid_date <= end)
          }
        : normalized;
    });
  }

  private futureDebtLockedMessage(paidDate: string): string {
    return `借款未来 ${paidDate} 已还清，不可修改此月借款。`;
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
        if (!source || submitted.has(id)) throw new RepositoryValidationError("借款 id 无效或重复");
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
        throw new RepositoryValidationError(this.futureDebtLockedMessage(source.paid_date ?? ""));
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
    for (const row of current.rows) {
      if (row.id === undefined || submitted.has(Number(row.id))) continue;
      if (row.start_date.slice(0, 7) === month) {
        if (row.is_paid && row.paid_date && row.paid_date > end) {
          throw new RepositoryValidationError(this.futureDebtLockedMessage(row.paid_date));
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
      const existing = new Set(rows(db.prepare(
        "SELECT id FROM debt_manager"
      ).all()).map((row) => Number(row.id)));
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
        let startDate: string;
        let paidDate: string | null = null;
        try {
          startDate = normalizeDate(row.start_date);
        } catch {
          throw new RepositoryValidationError(
            "借款发生日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM"
          );
        }
        if (text(row.paid_date)) {
          try { paidDate = normalizeDate(row.paid_date); } catch {
            throw new RepositoryValidationError(
              "借款还清日期必须是 YYYY-MM-DD、YYYY/MM/DD 或 YYYY-MM"
            );
          }
        }
        const isPaid = boolean(row.is_paid);
        if (isPaid && !paidDate) throw new RepositoryValidationError("已还借款必须填写还清日期");
        if (paidDate && paidDate < startDate) {
          throw new RepositoryValidationError("借款还清日期不能早于发生日期");
        }
        const values = [
          text(row.description), text(row.counterparty), finiteNumber(row.amount),
          startDate, isPaid ? 1 : 0, paidDate
        ] as const;
        if (row.id === undefined || row.id === null) {
          insert.run(...values);
        } else {
          const id = Number(row.id);
          if (!existing.has(id) || submitted.has(id)) {
            throw new RepositoryValidationError("借款 id 无效或重复");
          }
          submitted.add(id);
          update.run(...values, id);
        }
      }
    for (const id of existing) if (!submitted.has(id)) {
      db.prepare("DELETE FROM debt_manager WHERE id=?").run(id);
    }
  }
}
