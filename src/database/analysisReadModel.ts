import type { DatabaseSync } from "node:sqlite";
import type {
  AnnualFixedAsset,
  CurrentAsset,
  MonthOverview
} from "../types/month";
import type {
  AnnualCostAudit,
  AnnualOverview,
  RecurringExpenseSummary
} from "../types/analysis";
import type {
  CashAccountBalance,
  CategoryDefinition,
  InvestmentAccountAnalysis,
  InvestmentAccountBalance
} from "../types/configuration";
import type {
  Transaction
} from "../types/transactions";
import {
  buildAnnualRows,
  calculateMonthly,
  explainReconciliation,
  previousMonths,
  type ExtendedAnnualRow,
  type MonthlyCalculation
} from "../domain/calculator";
import {
  monthEnd,
  previousMonth,
  shiftMonth
} from "../domain/dates";
import { roundHalfEven, sum } from "../domain/money";
import { RepositoryValidationError, type Row, rows, text, fixedAssetFromRow, transactionFromRow } from "./repositoryPrimitives";

export interface AnalysisReadContext {
  readonly largeExpenseThreshold: number;
  readonly reconciliationTolerance: number;
  getMonths(db: DatabaseSync): string[];
  categoryRows(db: DatabaseSync): CategoryDefinition[];
  cashAccounts(db: DatabaseSync, month: string): CashAccountBalance[];
  investmentAccounts(db: DatabaseSync, month: string): InvestmentAccountBalance[];
}

export class AnalysisReadModel {
  constructor(private readonly context: AnalysisReadContext) {}

  private monthlyByMonth(
    db: DatabaseSync,
    categories: CategoryDefinition[]
  ): Map<string, MonthlyCalculation> {
    const grouped = new Map<string, Transaction[]>();
    for (const row of rows(db.prepare(
      "SELECT * FROM transactions ORDER BY month,id"
    ).all())) {
      const month = text(row.month);
      const group = grouped.get(month) ?? [];
      group.push(transactionFromRow(row));
      grouped.set(month, group);
    }
    return new Map([...grouped].map(([month, values]) => [
      month,
      calculateMonthly(values, categories, this.context.largeExpenseThreshold)
    ]));
  }

  private activeDebt(db: DatabaseSync, month: string): number {
    const end = monthEnd(month);
    return sum(rows(db.prepare(`
      SELECT amount FROM debt_manager
      WHERE REPLACE(start_date,'/','-')<=?
        AND (is_paid=0 OR REPLACE(paid_date,'/','-')>?)
    `).all(end, end)).map((row) => Number(row.amount ?? 0)));
  }

  private annualRows(db: DatabaseSync): ExtendedAnnualRow[] {
    const categories = this.context.categoryRows(db);
    const monthly = this.monthlyByMonth(db, categories);
    const cash = new Map(rows(db.prepare(`
      SELECT month,SUM(balance) AS total
      FROM cash_account_balances GROUP BY month
    `).all()).map((row) => [text(row.month), Number(row.total ?? 0)]));
    const investments = new Map(rows(db.prepare(`
      SELECT month,SUM(principal) AS principal,SUM(market_value) AS market_value,
             SUM(cash_balance) AS cash_balance
      FROM investment_account_balances GROUP BY month
    `).all()).map((row) => [text(row.month), row]));
    return buildAnnualRows(this.context.getMonths(db).map((month) => {
      const investment = investments.get(month);
      return {
        month,
        cash: cash.get(month) ?? 0,
        debt: this.activeDebt(db, month),
        principal: Number(investment?.principal ?? 0),
        market_value: Number(investment?.market_value ?? 0),
        investment_cash: Number(investment?.cash_balance ?? 0),
        monthly: monthly.get(month)
          ?? calculateMonthly([], categories, this.context.largeExpenseThreshold)
      };
    }));
  }

  private anomalyRows(
    db: DatabaseSync,
    month: string,
    current: Transaction[],
    categories: CategoryDefinition[]
  ): MonthOverview["anomalies"] {
    const history = rows(db.prepare(`
      SELECT month,type,category,counterparty,product,amount FROM transactions
      WHERE month>=? AND month<? ORDER BY month,id
    `).all(shiftMonth(month, -12), month));
    const currentExpense = current.filter((row) => row.type === "支出");
    const currentByCategory = new Map<string, number>();
    currentExpense.forEach((row) => {
      currentByCategory.set(
        row.category,
        (currentByCategory.get(row.category) ?? 0) + row.amount
      );
    });
    const periodic = new Set(categories.filter(
      (row) => row.transaction_type === "支出" && row.pattern === "周期"
    ).map((row) => row.name));
    const bigTicketCategories = new Set(categories.filter(
      (row) => row.transaction_type === "支出" && row.is_big_ticket
    ).map((row) => row.name));
    const categoryChanges: Array<Record<string, string | number>> = [];
    const missingPeriodic: Array<Record<string, string | number>> = [];
    for (const window of [1, 3]) {
      const months = previousMonths(month, window);
      const selected = history.filter(
        (row) => row.type === "支出" && months.includes(text(row.month))
      );
      if (!selected.length) continue;
      const monthCategory = new Map<string, Map<string, number>>();
      months.forEach((value) => monthCategory.set(value, new Map()));
      selected.forEach((row) => {
        const values = monthCategory.get(text(row.month))!;
        const category = text(row.category);
        values.set(category, (values.get(category) ?? 0) + Number(row.amount ?? 0));
      });
      const allCategories = new Set(currentByCategory.keys());
      monthCategory.forEach((values) => values.forEach((_amount, category) => allCategories.add(category)));
      const label = window === 1 ? "较上月" : `较近${window}月均值`;
      for (const category of [...allCategories].sort()) {
        const currentAmount = currentByCategory.get(category) ?? 0;
        const average = sum(months.map(
          (value) => monthCategory.get(value)?.get(category) ?? 0
        )) / window;
        const delta = currentAmount - average;
        const appeared = months.filter(
          (value) => (monthCategory.get(value)?.get(category) ?? 0) > 0
        ).length;
        if (
          periodic.has(category) && currentAmount <= 0
          && appeared >= (window === 1 ? 1 : 2) && average > 0
        ) {
          missingPeriodic.push({
            "对比口径": label,
            "分类": category,
            "历史出现月数": appeared,
            "历史基准": roundHalfEven(average),
            "判断": "周期项本月未出现，建议确认是否漏记或已取消"
          });
        }
        const threshold = Math.max(100, average * 0.3);
        if (
          bigTicketCategories.has(category)
          || Math.abs(delta) < threshold
        ) {
          continue;
        }
        categoryChanges.push({
          "对比口径": label,
          "分类": category,
          "本月金额": roundHalfEven(currentAmount),
          "历史基准": roundHalfEven(average),
          "触发阈值": roundHalfEven(threshold),
          "增减方向": delta > 0 ? "增加" : delta < 0 ? "减少" : "持平",
          "增减金额": roundHalfEven(delta),
          "增减比例": average <= 0 && currentAmount > 0
            ? "新增"
            : average > 0 ? `${roundHalfEven(delta / average * 100, 1).toFixed(1)}%` : "0.0%"
        });
      }
    }
    categoryChanges.sort((left, right) =>
      String(left["对比口径"]).localeCompare(String(right["对比口径"]))
      || Math.abs(Number(right["增减金额"])) - Math.abs(Number(left["增减金额"]))
    );
    const historyProducts = new Set(history.map((row) => text(row.product)));
    const products = new Map<string, { category: string; amount: number }>();
    currentExpense.forEach((row) => {
      const existing = products.get(row.product) ?? { category: row.category, amount: 0 };
      existing.amount += row.amount;
      products.set(row.product, existing);
    });
    const newBig = [...products]
      .filter(([product, value]) =>
        product
        && value.amount >= this.context.largeExpenseThreshold
        && !historyProducts.has(product)
      )
      .map(([product, value]) => ({
        "商品": product,
        "分类": value.category,
        "金额": roundHalfEven(value.amount),
        "判断": "过去 12 个月未出现的大额商品"
      }))
      .sort((left, right) => right["金额"] - left["金额"]);
    return {
      category_changes: categoryChanges,
      new_big_items: newBig,
      missing_periodic: missingPeriodic
    };
  }

  monthOverview(
    db: DatabaseSync,
    month: string,
    transactions: Transaction[],
    categories: CategoryDefinition[]
  ): MonthOverview {
    const allRows = this.annualRows(db);
    const rowIndex = allRows.findIndex((row) => row.month === month);
    if (rowIndex < 0) return { available: false };
    const row = allRows[rowIndex];
    const monthly = calculateMonthly(
      transactions,
      categories,
      this.context.largeExpenseThreshold
    );
    const cashAccounts = this.context.cashAccounts(db, month);
    const cashTotal = sum(cashAccounts.map((account) => account.balance));
    const investments = this.context.investmentAccounts(db, month);
    const principal = sum(investments.map((account) => account.principal));
    const marketValue = sum(investments.map((account) => account.market_value));
    const investmentCash = sum(investments.map((account) => account.cash_balance));
    const position = marketValue + investmentCash;
    const aggregateDeposit = monthly.total_deposit;
    const aggregateWithdraw = monthly.total_withdraw;
    const flowAdjustedPosition = position - aggregateDeposit + aggregateWithdraw;
    const flowAdjustedPrincipal = principal - aggregateDeposit + aggregateWithdraw;
    const previous = rowIndex > 0 ? allRows[rowIndex - 1] : null;
    const previousValue = previousMonth(month);
    const previousTransactions = previousValue
      ? rows(db.prepare(
        "SELECT * FROM transactions WHERE month=? ORDER BY id"
      ).all(previousValue)).map(transactionFromRow)
      : [];
    const previousMonthly = calculateMonthly(
      previousTransactions,
      categories,
      this.context.largeExpenseThreshold
    );
    const previousInvestment = previousValue
      ? db.prepare(`
          SELECT COUNT(*) AS count,
                 COALESCE(SUM(market_value),0) + COALESCE(SUM(cash_balance),0)
                   AS position
          FROM investment_account_balances WHERE month=?
        `).get(previousValue) as Row
      : null;
    const previousPosition = previousInvestment
      && Number(previousInvestment.count) > 0
      ? Number(previousInvestment.position ?? 0)
      : null;
    const previousInvestmentAccounts = previousValue
      ? this.context.investmentAccounts(db, previousValue)
      : [];
    const previousInvestmentByKey = new Map(
      previousInvestmentAccounts.map((account) => [account.account_key, account])
    );
    const investmentAccounts: InvestmentAccountAnalysis[] = investments.map((account) => {
      const accountTransactions = transactions.filter(
        (transaction) => transaction.account_key === account.account_key
          && (transaction.type === "加仓" || transaction.type === "提现")
      );
      const deposit = sum(accountTransactions
        .filter((transaction) => transaction.type === "加仓")
        .map((transaction) => transaction.amount));
      const withdraw = sum(accountTransactions
        .filter((transaction) => transaction.type === "提现")
        .map((transaction) => transaction.amount));
      const accountPosition = account.market_value + account.cash_balance;
      const flowAdjustedAccountPosition = accountPosition - deposit + withdraw;
      const flowAdjustedAccountPrincipal = account.principal - deposit + withdraw;
      const accountRoi = flowAdjustedAccountPrincipal > 0
        ? (flowAdjustedAccountPosition - flowAdjustedAccountPrincipal) / flowAdjustedAccountPrincipal * 100
        : 0;
      const previousAccount = previousInvestmentByKey.get(account.account_key);
      const previousAccountPosition = previousAccount
        ? previousAccount.market_value + previousAccount.cash_balance
        : null;
      const previousAccountTransactions = previousTransactions.filter(
        (transaction) => transaction.account_key === account.account_key
          && (transaction.type === "加仓" || transaction.type === "提现")
      );
      const previousDeposit = sum(previousAccountTransactions
        .filter((transaction) => transaction.type === "加仓")
        .map((transaction) => transaction.amount));
      const previousWithdraw = sum(previousAccountTransactions
        .filter((transaction) => transaction.type === "提现")
        .map((transaction) => transaction.amount));
      const previousAccountAdjustedPosition = previousAccountPosition === null
        ? null
        : previousAccountPosition - previousDeposit + previousWithdraw;
      const previousAccountAdjustedPrincipal = previousAccount
        ? previousAccount.principal - previousDeposit + previousWithdraw
        : null;
      const previousAccountRoi = previousAccount && previousAccountAdjustedPrincipal !== null && previousAccountAdjustedPrincipal > 0
        ? (previousAccountAdjustedPosition! - previousAccountAdjustedPrincipal) / previousAccountAdjustedPrincipal * 100
        : previousAccount ? 0 : null;
      return {
        account_key: account.account_key,
        name: account.name ?? account.account_key,
        principal: roundHalfEven(account.principal),
        deposit: roundHalfEven(deposit),
        withdraw: roundHalfEven(withdraw),
        market_value: roundHalfEven(account.market_value),
        cash_balance: roundHalfEven(account.cash_balance),
        position: roundHalfEven(accountPosition),
        profit: roundHalfEven(flowAdjustedAccountPosition - flowAdjustedAccountPrincipal),
        roi_percent: roundHalfEven(accountRoi, 1),
        comparison: {
          available: previousAccountPosition !== null,
          previous_position: previousAccountPosition === null ? null : roundHalfEven(previousAccountPosition),
          amount_delta: previousAccountPosition === null
            ? null : roundHalfEven(flowAdjustedAccountPosition - previousAccountPosition),
          percent_delta: previousAccountPosition === null || previousAccountPosition === 0
            ? null : roundHalfEven((flowAdjustedAccountPosition - previousAccountPosition) / previousAccountPosition * 100, 1),
          previous_roi_percent: previousAccountRoi === null ? null : roundHalfEven(previousAccountRoi, 1),
          roi_delta_percent: previousAccountRoi === null
            ? null : roundHalfEven(accountRoi - previousAccountRoi, 1)
        }
      };
    });
    const comparison = [...new Set([
      ...Object.keys(monthly.category_summary),
      ...Object.keys(previousMonthly.category_summary)
    ])].filter((category) =>
      !categories.find((definition) => definition.name === category)?.is_big_ticket
    ).sort().map((category) => ({
      category,
      current: monthly.category_summary[category] ?? 0,
      previous: previousMonthly.category_summary[category] ?? 0,
      delta: roundHalfEven(
        (monthly.category_summary[category] ?? 0)
        - (previousMonthly.category_summary[category] ?? 0)
      )
    }));
    const necessary = monthly.structure.necessary;
    const controlled = monthly.structure.controlled;
    const structureTotal = necessary + controlled;
    const surplus = row.total_income - row.total_expense;
    return {
      available: true,
      metrics: {
        asset_delta: row.asset_delta,
        total_income: row.total_income,
        total_expense: row.total_expense,
        surplus: roundHalfEven(surplus),
        savings_rate: row.total_income > 0
          ? roundHalfEven(surplus / row.total_income * 100) : null,
        cost_assets: row.cost_assets,
        market_net_assets: row.market_net_assets,
        total_assets: row.total_assets
      },
      cash_accounts: cashAccounts.map((account) => ({
        account: account.account ?? account.name ?? "",
        balance: account.balance,
        share_percent: (account as CashAccountBalance & { share_percent: number }).share_percent
      })),
      cash_total: cashTotal,
      investment: {
        principal,
        market_value: marketValue,
        cash_balance: investmentCash,
        position: roundHalfEven(position),
        profit: roundHalfEven(flowAdjustedPosition - flowAdjustedPrincipal),
        roi_percent: flowAdjustedPrincipal > 0
          ? roundHalfEven((flowAdjustedPosition - flowAdjustedPrincipal) / flowAdjustedPrincipal * 100, 1) : 0,
        comparison: {
          available: previousPosition !== null,
          previous_position: previousPosition,
          amount_delta: previousPosition === null
            ? null
            : roundHalfEven(flowAdjustedPosition - previousPosition),
          percent_delta: previousPosition === null || previousPosition === 0
            ? null
            : roundHalfEven(
              (flowAdjustedPosition - previousPosition) / previousPosition * 100,
              1
            )
        }
      },
      investment_accounts: investmentAccounts,
      reconciliation: {
        available: row.theoretical_expense !== null,
        actual: {
          all_out: monthly.all_out,
          daifu: monthly.total_daifu,
          net_expense: monthly.total_expense
        },
        theoretical: {
          previous_cash: previous?.cash ?? null,
          income: row.total_income,
          debt_change: row.debt_change,
          cash: row.cash,
          deposit: row.total_deposit,
          withdraw: row.total_withdraw,
          net_expense: row.theoretical_expense
        },
        discrepancy: row.discrepancy,
        explanation: explainReconciliation(
          row.discrepancy,
          this.context.reconciliationTolerance
        )
      },
      anomalies: this.anomalyRows(db, month, transactions, categories),
      structure: {
        necessary,
        controlled,
        controlled_percent: structureTotal > 0
          ? roundHalfEven(controlled / structureTotal * 100, 1) : 0,
        leverage: necessary > 0 ? roundHalfEven(controlled / necessary) : 0,
        periodic: monthly.structure.periodic,
        daily: monthly.structure.daily,
        occasional: monthly.structure.occasional,
        necessary_categories: categories.filter(
          (category) =>
            category.transaction_type === "支出" && category.necessity === "必要"
        ).map((category) => category.name),
        controlled_categories: categories.filter(
          (category) =>
            category.transaction_type === "支出" && category.necessity === "可控"
        ).map((category) => category.name)
      },
      category_summary: Object.entries(monthly.category_summary)
        .filter(([, amount]) => amount > 0)
        .sort((left, right) => right[1] - left[1])
        .map(([category, amount]) => ({ category, amount })),
      category_comparison: {
        available: previousTransactions.length > 0,
        previous_month: previousValue,
        rows: comparison
      },
      big_tickets: monthly.big_tickets
    };
  }

  private annualCostAudit(
    db: DatabaseSync,
    year: string,
    annualRows: ExtendedAnnualRow[],
    categories: CategoryDefinition[]
  ): AnnualCostAudit {
    const metadata = new Map(categories.map((row) => [row.name, row]));
    const expenses = rows(db.prepare(`
      SELECT month,category,product,amount FROM transactions
      WHERE month LIKE ? AND type='支出' ORDER BY month,id
    `).all(`${year}-%`));
    const monthsCount = Math.max(1, new Set(annualRows.map((row) => row.month)).size);
    const total = sum(expenses.map((row) => Number(row.amount ?? 0)));
    const byCategory = new Map<string, number>();
    const byPattern = new Map<string, number>();
    expenses.forEach((row) => {
      const category = text(row.category);
      const amount = Number(row.amount ?? 0);
      byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
      const pattern = metadata.get(category)?.pattern ?? "偶尔";
      byPattern.set(pattern, (byPattern.get(pattern) ?? 0) + amount);
    });
    const necessaryTotal = sum(expenses.filter(
      (row) => metadata.get(text(row.category))?.necessity === "必要"
    ).map((row) => Number(row.amount ?? 0)));
    const controlledTotal = sum(expenses.filter(
      (row) => metadata.get(text(row.category))?.necessity === "可控"
    ).map((row) => Number(row.amount ?? 0)));
    const productSummary = (category: string, divisor: number) => {
      const grouped = new Map<string, number>();
      expenses.filter((row) => text(row.category) === category).forEach((row) => {
        const product = text(row.product);
        grouped.set(product, (grouped.get(product) ?? 0) + Number(row.amount ?? 0));
      });
      return [...grouped].sort((left, right) => right[1] - left[1]).slice(0, 10)
        .map(([product, amount]) => ({
          product,
          total: roundHalfEven(amount),
          monthly_average: roundHalfEven(amount / divisor)
        }));
    };
    const latestAssets = annualRows.at(-1)?.total_assets ?? 0;
    const average = total / monthsCount;
    return {
      months_count: monthsCount,
      total_expense: total,
      necessary_total: necessaryTotal,
      controlled_total: controlledTotal,
      controlled_percent: total > 0
        ? roundHalfEven(controlledTotal / total * 100, 1) : 0,
      asset_support_months: average > 0
        ? roundHalfEven(latestAssets / average, 1) : null,
      categories: [...byCategory].sort((left, right) => right[1] - left[1])
        .map(([category, amount]) => ({
          category,
          necessity: metadata.get(category)?.necessity ?? "必要",
          pattern: metadata.get(category)?.pattern ?? "偶尔",
          total: roundHalfEven(amount),
          monthly_average: roundHalfEven(amount / monthsCount),
          share_percent: total > 0 ? roundHalfEven(amount / total * 100, 1) : 0
        })),
      patterns: ["周期", "日常", "偶尔"].filter((pattern) => byPattern.has(pattern))
        .map((pattern) => {
          const amount = byPattern.get(pattern) ?? 0;
          return {
            pattern,
            total: roundHalfEven(amount),
            monthly_average: roundHalfEven(amount / monthsCount),
            share_percent: total > 0 ? roundHalfEven(amount / total * 100, 1) : 0
          };
        }),
      big_tickets: expenses.filter((row) => {
        const category = text(row.category);
        return metadata.get(category)?.is_big_ticket
          || Number(row.amount ?? 0) >= this.context.largeExpenseThreshold;
      }).map((row) => ({
        month: text(row.month),
        product: text(row.product),
        category: text(row.category),
        amount: roundHalfEven(Number(row.amount ?? 0))
      })).sort((left, right) => right.amount - left.amount),
      subscriptions: productSummary("订阅服务", 12),
      daily_essentials: productSummary("日常必需", monthsCount)
    };
  }

  annual(db: DatabaseSync, year: string): AnnualOverview {
    if (!/^\d{4}$/.test(year)) {
      throw new RepositoryValidationError({ code: "analysis.year_invalid", params: { year } });
    }
    const full = this.annualRows(db);
    const annual = full.filter((row) => row.month.startsWith(year));
    if (!annual.length) {
      return {
        year,
        months: [],
        rows: [],
        metrics: {
          total_income: 0,
          total_expense: 0,
          savings: 0,
          savings_rate: 0
        },
        latest: null,
        rolling_rows: [],
        recurring_expenses: [],
        fixed_assets: [],
        all_trend_rows: [],
        cost_audit: {
          months_count: 1,
          total_expense: 0,
          necessary_total: 0,
          controlled_total: 0,
          controlled_percent: 0,
          asset_support_months: null,
          categories: [],
          patterns: [],
          big_tickets: [],
          subscriptions: [],
          daily_essentials: []
        }
      };
    }
    const totalIncome = sum(annual.map((row) => row.total_income));
    const totalExpense = sum(annual.map((row) => row.total_expense));
    const savings = roundHalfEven(totalIncome - totalExpense);
    const latest = annual.at(-1)!;
    const rollingStart = shiftMonth(latest.month, -11);
    const annualFixedAssets = new Map<string, AnnualFixedAsset>();
    for (const row of rows(db.prepare(`
      SELECT * FROM fixed_assets
      WHERE month LIKE ?
      ORDER BY month DESC, id DESC
    `).all(`${year}-%`))) {
      const assetKey = text(row.asset_key);
      if (!annualFixedAssets.has(assetKey)) {
        annualFixedAssets.set(assetKey, {
          ...fixedAssetFromRow(row),
          last_seen_month: text(row.month)
        });
      }
    }
    return {
      year,
      months: annual.map((row) => row.month),
      rows: annual,
      metrics: {
        total_income: totalIncome,
        total_expense: totalExpense,
        savings,
        savings_rate: totalIncome > 0
          ? roundHalfEven(savings / totalIncome * 100, 1) : 0
      },
      latest,
      rolling_rows: full.filter(
        (row) => row.month >= rollingStart && row.month <= latest.month
      ),
      recurring_expenses: this.recurringExpenses(db, latest.month),
      fixed_assets: [...annualFixedAssets.values()].sort((left, right) =>
        left.asset_name.localeCompare(right.asset_name)
        || left.last_seen_month.localeCompare(right.last_seen_month)
      ),
      all_trend_rows: full,
      cost_audit: this.annualCostAudit(
        db,
        year,
        annual,
        this.context.categoryRows(db)
      )
    };
  }

  currentAsset(db: DatabaseSync): CurrentAsset {
    const latest = this.context.getMonths(db).at(-1);
    if (!latest) {
      return {
        month: null,
        cost_assets: 0,
        market_net_assets: 0,
        total_assets: 0,
        fixed_assets: []
      };
    }
    const cash = Number((db.prepare(`
      SELECT COALESCE(SUM(balance),0) AS total
      FROM cash_account_balances WHERE month=?
    `).get(latest) as Row).total ?? 0);
    const principal = Number((db.prepare(`
      SELECT COALESCE(SUM(principal),0) AS total
      FROM investment_account_balances WHERE month=?
    `).get(latest) as Row).total ?? 0);
    const investment = db.prepare(`
      SELECT COALESCE(SUM(market_value),0) AS market_value,
             COALESCE(SUM(cash_balance),0) AS cash_balance
      FROM investment_account_balances WHERE month=?
    `).get(latest) as Row;
    const marketValue = Number(investment.market_value ?? 0);
    const investmentCash = Number(investment.cash_balance ?? 0);
    const debt = this.activeDebt(db, latest);
    const costAssets = roundHalfEven(cash - debt + principal);
    const marketNetAssets = roundHalfEven(cash - debt + marketValue + investmentCash);
    return {
      month: latest,
      cash: roundHalfEven(cash),
      debt,
      principal: roundHalfEven(principal),
      market_value: roundHalfEven(marketValue),
      investment_cash: roundHalfEven(investmentCash),
      cost_assets: costAssets,
      market_net_assets: marketNetAssets,
      total_assets: costAssets,
      fixed_assets: rows(db.prepare(`
        SELECT * FROM fixed_assets
        WHERE month=? AND status IN ('在用','闲置') ORDER BY id
      `).all(latest)).map(fixedAssetFromRow),
      fixed_assets_note: "固定资产记录不计入总资产"
    };
  }

  private recurringExpenses(
    db: DatabaseSync,
    latestMonth: string
  ): RecurringExpenseSummary[] {
    const selectedMonths = new Set(
      this.context.getMonths(db).filter((month) => month <= latestMonth).slice(-12)
    );
    const result = new Map<string, {
      category: string;
      months: Set<string>;
      count: number;
      total: number;
      latestAmount: number;
      lastDate: string;
    }>();
    rows(db.prepare(`
      SELECT t.month,t.transaction_date,t.category,t.product,t.amount
      FROM transactions t
      JOIN category_definitions c ON c.category_key=t.category_key
      WHERE t.type='支出' AND c.pattern='周期'
      ORDER BY t.transaction_date,t.id
    `).all()).filter((row) => selectedMonths.has(text(row.month))).forEach((row) => {
      const product = text(row.product);
      const current = result.get(product) ?? {
        category: text(row.category),
        months: new Set<string>(),
        count: 0,
        total: 0,
        latestAmount: 0,
        lastDate: ""
      };
      current.months.add(text(row.month));
      current.count += 1;
      current.total += Number(row.amount ?? 0);
      const date = text(row.transaction_date) || `${text(row.month)}-01`;
      if (date >= current.lastDate) {
        current.lastDate = date;
        current.latestAmount = Number(row.amount ?? 0);
        current.category = text(row.category);
      }
      result.set(product, current);
    });
    return [...result].map(([product, row]) => ({
      product,
      category: row.category,
      months_count: row.months.size,
      transaction_count: row.count,
      total: roundHalfEven(row.total),
      average_amount: roundHalfEven(row.total / row.count),
      latest_amount: roundHalfEven(row.latestAmount),
      last_date: row.lastDate
    })).sort((left, right) => right.total - left.total);
  }
}
