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
  LEGACY_CATEGORY_ALIASES,
  previousMonths,
  type ExtendedAnnualRow,
  type MonthlyCalculation
} from "../domain/calculator";
import { normalizeProductKey } from "../domain/rules";
import {
  monthEnd,
  previousMonth,
  shiftMonth
} from "../domain/dates";
import {
  createMonthReadWindow,
  MONTHLY_ANALYSIS_MONTHS,
  sampleMonths
} from "../domain/readWindows";
import { roundHalfEven, sum } from "../domain/money";
import { RepositoryValidationError, type Row, rows, text, fixedAssetFromRow, transactionFromRow } from "./repositoryPrimitives";

export interface AnalysisReadContext {
  readonly largeExpenseThreshold: number;
  readonly reconciliationTolerance: number;
  getMonths(db: DatabaseSync): string[];
  savedMonths(db: DatabaseSync): string[];
  categoryDefinitions(db: DatabaseSync): CategoryDefinition[];
  cashAccounts(db: DatabaseSync, month: string): CashAccountBalance[];
  investmentAccounts(db: DatabaseSync, month: string): InvestmentAccountBalance[];
}

export class AnalysisReadModel {
  constructor(private readonly context: AnalysisReadContext) {}

  private transactionsByMonth(
    db: DatabaseSync,
    months: string[],
    knownTransactions: Map<string, Transaction[]> = new Map()
  ): Map<string, Transaction[]> {
    const orderedMonths = [...new Set(months)].sort();
    const grouped = new Map<string, Transaction[]>(orderedMonths.map((month) => {
      const known = knownTransactions.get(month);
      return [month, known ? [...known] : []];
    }));
    const missingMonths = orderedMonths.filter((month) => !knownTransactions.has(month));
    if (!missingMonths.length) return grouped;
    const placeholders = missingMonths.map(() => "?").join(",");
    for (const row of rows(db.prepare(
      `SELECT id,month,transaction_date,type,category_key,category,counterparty,
              product,source,account_key,amount
       FROM transactions WHERE month IN (${placeholders}) ORDER BY month,id`
    ).all(...missingMonths))) {
      const month = text(row.month);
      grouped.get(month)?.push(transactionFromRow(row));
    }
    return grouped;
  }

  private monthlyByMonth(
    db: DatabaseSync,
    categories: CategoryDefinition[],
    months: string[],
    knownTransactions: Map<string, Transaction[]> = new Map()
  ): Map<string, MonthlyCalculation> {
    const orderedMonths = [...new Set(months)].sort();
    if (!orderedMonths.length) return new Map();
    const grouped = this.transactionsByMonth(db, orderedMonths, knownTransactions);
    return new Map([...orderedMonths].map((month) => [
      month,
      calculateMonthly(grouped.get(month) ?? [], categories, this.context.largeExpenseThreshold)
    ]));
  }

  private activeDebtByMonth(
    db: DatabaseSync,
    months: string[]
  ): Map<string, number> {
    const orderedMonths = [...new Set(months)].sort();
    if (!orderedMonths.length) return new Map();
    const latestEnd = monthEnd(orderedMonths.at(-1)!);
    const debts = rows(db.prepare(`
      SELECT amount,start_date,is_paid,paid_date
      FROM debt_manager
      WHERE start_date<=?
    `).all(latestEnd));
    return new Map(orderedMonths.map((month) => {
      const end = monthEnd(month);
      const total = sum(debts
        .filter((row) =>
          String(row.start_date) <= end
          && (
            Number(row.is_paid ?? 0) === 0
            || Boolean(row.paid_date)
              && String(row.paid_date) > end
          )
        )
        .map((row) => Number(row.amount ?? 0)));
      return [month, total];
    }));
  }

  private annualRows(
    db: DatabaseSync,
    months: string[],
    categories = this.context.categoryDefinitions(db),
    knownTransactions: Map<string, Transaction[]> = new Map()
  ): ExtendedAnnualRow[] {
    const orderedMonths = [...new Set(months)].sort();
    if (!orderedMonths.length) return [];
    const placeholders = orderedMonths.map(() => "?").join(",");
    const monthly = this.monthlyByMonth(db, categories, orderedMonths, knownTransactions);
    const debts = this.activeDebtByMonth(db, orderedMonths);
    const cash = new Map(rows(db.prepare(`
      SELECT month,SUM(balance) AS total
      FROM cash_account_balances WHERE month IN (${placeholders}) GROUP BY month
    `).all(...orderedMonths)).map((row) => [text(row.month), Number(row.total ?? 0)]));
    const investments = new Map(rows(db.prepare(`
      SELECT month,SUM(principal) AS principal,SUM(market_value) AS market_value,
             SUM(cash_balance) AS cash_balance
      FROM investment_account_balances WHERE month IN (${placeholders}) GROUP BY month
    `).all(...orderedMonths)).map((row) => [text(row.month), row]));
    return buildAnnualRows(orderedMonths.map((month) => {
      const investment = investments.get(month);
      return {
        month,
        cash: cash.get(month) ?? 0,
        debt: debts.get(month) ?? 0,
        principal: Number(investment?.principal ?? 0),
        market_value: Number(investment?.market_value ?? 0),
        investment_cash: Number(investment?.cash_balance ?? 0),
        monthly: monthly.get(month)
          ?? calculateMonthly([], categories, this.context.largeExpenseThreshold)
      };
    }));
  }

  private anomalyRows(
    month: string,
    current: Transaction[],
    history: Array<Transaction & { month: string }>,
    categories: CategoryDefinition[]
  ): MonthOverview["anomalies"] {
    const categoryByKey = new Map(categories.map((row) => [row.category_key, row]));
    const categoryByName = new Map(categories.map((row) => [row.name, row]));
    const categoryName = (row: Transaction): string => {
      const definition = row.category_key
        ? categoryByKey.get(row.category_key)
        : categoryByName.get(row.category);
      return definition?.name ?? row.category;
    };
    const currentExpense = current.filter((row) => row.type === "支出");
    const currentByCategory = new Map<string, number>();
    currentExpense.forEach((row) => {
      const category = categoryName(row);
      currentByCategory.set(
        category,
        (currentByCategory.get(category) ?? 0) + row.amount
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
        (row) => row.type === "支出" && months.includes(row.month)
      );
      if (!selected.length) continue;
      const monthCategory = new Map<string, Map<string, number>>();
      months.forEach((value) => monthCategory.set(value, new Map()));
      selected.forEach((row) => {
        const values = monthCategory.get(row.month)!;
        const category = categoryName(row);
        values.set(category, (values.get(category) ?? 0) + row.amount);
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
    const historyProducts = new Set(history.map((row) => normalizeProductKey(row.product)));
    const products = new Map<string, { product: string; category: string; amount: number }>();
    currentExpense.forEach((row) => {
      const productKey = normalizeProductKey(row.product);
      const existing = products.get(productKey) ?? {
        product: row.product,
        category: categoryName(row),
        amount: 0
      };
      existing.amount += row.amount;
      products.set(productKey, existing);
    });
    const newBig = [...products]
      .filter(([productKey, value]) =>
        productKey
        && value.amount >= this.context.largeExpenseThreshold
        && !historyProducts.has(productKey)
      )
      .map(([, value]) => ({
        "商品": value.product,
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
    return this.monthOverviewInternal(db, month, transactions, categories, false);
  }

  draftMonthOverview(
    db: DatabaseSync,
    month: string,
    transactions: Transaction[],
    categories: CategoryDefinition[]
  ): MonthOverview {
    return this.monthOverviewInternal(db, month, transactions, categories, true);
  }

  private monthOverviewInternal(
    db: DatabaseSync,
    month: string,
    transactions: Transaction[],
    categories: CategoryDefinition[],
    includeDraftMonth: boolean
  ): MonthOverview {
    const savedMonths = this.context.savedMonths(db);
    const currentIsSaved = savedMonths.includes(month);
    if (!currentIsSaved && !includeDraftMonth) return { available: false };
    const windowFrom = shiftMonth(month, -(MONTHLY_ANALYSIS_MONTHS - 1));
    const analysisMonths = savedMonths
      .filter((candidate) => candidate >= windowFrom && candidate <= month);
    if (includeDraftMonth && !analysisMonths.includes(month)) analysisMonths.push(month);
    analysisMonths.sort();
    const transactionRows = this.transactionsByMonth(
      db,
      analysisMonths,
      new Map([[month, transactions]])
    );
    const allRows = this.annualRows(db, analysisMonths, categories, transactionRows);
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
    const previousValue = previousMonth(month);
    const previous = rowIndex > 0
      && previousValue !== null
      && savedMonths.includes(previousValue)
      && allRows[rowIndex - 1]?.month === previousValue
      ? allRows[rowIndex - 1]
      : null;
    const previousTransactions = previousValue && savedMonths.includes(previousValue)
      ? transactionRows.get(previousValue) ?? []
      : [];
    const previousMonthly = calculateMonthly(
      previousTransactions,
      categories,
      this.context.largeExpenseThreshold
    );
    const previousInvestmentAccounts = previousValue && savedMonths.includes(previousValue)
      ? this.context.investmentAccounts(db, previousValue)
      : [];
    const previousPosition = previousInvestmentAccounts.length
      ? sum(previousInvestmentAccounts.map((account) =>
          account.market_value + account.cash_balance
        ))
      : null;
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
      analysis_window: createMonthReadWindow("analysis", windowFrom, month),
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
      anomalies: this.anomalyRows(
        month,
        transactions,
        [...transactionRows.entries()]
          .filter(([candidate]) => candidate < month)
          .flatMap(([candidate, rowsForMonth]) =>
            rowsForMonth.map((row) => ({ ...row, month: candidate }))
          ),
        categories
      ),
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
        .filter(([, amount]) => amount !== 0)
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
    year: string,
    annualRows: ExtendedAnnualRow[],
    categories: CategoryDefinition[],
    transactionsByMonth: Map<string, Transaction[]>
  ): AnnualCostAudit {
    const metadata = new Map(categories.map((row) => [row.name, row]));
    const metadataByKey = new Map(categories.map((row) => [row.category_key, row]));
    const categoryName = (row: Transaction): string => {
      const rawCategory = row.category ?? "";
      const legacyCategory = LEGACY_CATEGORY_ALIASES[rawCategory] ?? rawCategory;
      const definition = row.category_key
        ? metadataByKey.get(row.category_key)
        : metadata.get(legacyCategory);
      return definition?.name ?? legacyCategory;
    };
    const expenses = [...transactionsByMonth.entries()]
      .filter(([month]) => month.startsWith(year))
      .flatMap(([month, transactions]) => transactions
        .filter((row) => row.type === "支出" || row.type === "代付")
        .map((row) => ({
          month,
          type: row.type,
          category: categoryName(row),
          product: row.product,
          amount: row.type === "代付" ? -row.amount : row.amount
        })));
    const monthsCount = Math.max(1, new Set(annualRows.map((row) => row.month)).size);
    const total = sum(expenses.map((row) => row.amount));
    const byCategory = new Map<string, number>();
    const byPattern = new Map<string, number>();
    expenses.forEach((row) => {
      const category = row.category;
      if (!category) return;
      const amount = row.amount;
      byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
      const pattern = metadata.get(category)?.pattern ?? "偶尔";
      byPattern.set(pattern, (byPattern.get(pattern) ?? 0) + amount);
    });
    const necessaryTotal = sum(expenses.filter(
      (row) => metadata.get(row.category)?.necessity === "必要"
    ).map((row) => row.amount));
    const controlledTotal = sum(expenses.filter(
      (row) => metadata.get(row.category)?.necessity === "可控"
    ).map((row) => row.amount));
    const productSummary = (category: string, divisor: number) => {
      const grouped = new Map<string, number>();
      expenses.filter((row) => row.type === "支出" && row.category === category).forEach((row) => {
        const product = row.product;
        grouped.set(product, (grouped.get(product) ?? 0) + row.amount);
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
        const category = row.category;
        return row.type === "支出" && (
          Boolean(metadata.get(category)?.is_big_ticket)
          || row.amount >= this.context.largeExpenseThreshold
        );
      }).map((row) => ({
        month: row.month,
        product: row.product,
        category: row.category,
        amount: roundHalfEven(row.amount)
      })).sort((left, right) => right.amount - left.amount),
      subscriptions: productSummary("订阅服务", 12),
      daily_essentials: productSummary("日常必需", monthsCount)
    };
  }

  annual(db: DatabaseSync, year: string): AnnualOverview {
    if (!/^\d{4}$/.test(year)) {
      throw new RepositoryValidationError({ code: "analysis.year_invalid", params: { year } });
    }
    const availableMonths = this.context.savedMonths(db).sort();
    const annualMonths = availableMonths.filter((month) => month.startsWith(year));
    if (!annualMonths.length) {
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
    const latestMonth = annualMonths.at(-1)!;
    const rollingStart = shiftMonth(latestMonth, -11);
    const rollingMonths = availableMonths.filter(
      (month) => month >= rollingStart && month <= latestMonth
    );
    const trendMonths = sampleMonths(availableMonths);
    const requiredMonths = new Set<string>([
      ...annualMonths,
      ...rollingMonths,
      ...trendMonths
    ]);
    const baseline = previousMonth(annualMonths[0]);
    if (baseline && availableMonths.includes(baseline)) requiredMonths.add(baseline);
    const categories = this.context.categoryDefinitions(db);
    const requiredMonthList = [...requiredMonths];
    const transactionsByMonth = this.transactionsByMonth(db, requiredMonthList);
    const full = this.annualRows(
      db,
      requiredMonthList,
      categories,
      transactionsByMonth
    );
    const annualRows = full.filter((row) => row.month.startsWith(year));
    const annual = annualRows;
    const totalIncome = sum(annual.map((row) => row.total_income));
    const totalExpense = sum(annual.map((row) => row.total_expense));
    const savings = roundHalfEven(totalIncome - totalExpense);
    const latest = annual.at(-1)!;
    const rollingRows = full.filter(
      (row) => row.month >= rollingStart && row.month <= latestMonth
    );
    const annualFixedAssets = new Map<string, AnnualFixedAsset>();
    const fixedAssetMonths = annualMonths.filter((month) => month.startsWith(year));
    const fixedAssetPlaceholders = fixedAssetMonths.map(() => "?").join(",");
    for (const row of rows(db.prepare(`
      SELECT * FROM fixed_assets
      WHERE month IN (${fixedAssetPlaceholders})
      ORDER BY month DESC, id DESC
    `).all(...fixedAssetMonths))) {
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
      months: annualRows.map((row) => row.month),
      rows: annualRows,
      metrics: {
        total_income: totalIncome,
        total_expense: totalExpense,
        savings,
        savings_rate: totalIncome > 0
          ? roundHalfEven(savings / totalIncome * 100, 1) : 0
      },
      latest,
      rolling_rows: rollingRows,
      recurring_expenses: this.recurringExpenses(
        latest.month,
        rollingMonths,
        categories,
        transactionsByMonth
      ),
      fixed_assets: [...annualFixedAssets.values()].sort((left, right) =>
        left.asset_name.localeCompare(right.asset_name)
        || left.last_seen_month.localeCompare(right.last_seen_month)
      ),
      all_trend_rows: full.filter((row) => trendMonths.includes(row.month)),
      cost_audit: this.annualCostAudit(
        year,
        annual,
        categories,
        transactionsByMonth
      )
    };
  }

  currentAsset(db: DatabaseSync): CurrentAsset {
    const latest = this.context.savedMonths(db).at(-1);
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
    const investment = db.prepare(`
      SELECT COALESCE(SUM(principal),0) AS principal,
             COALESCE(SUM(market_value),0) AS market_value,
             COALESCE(SUM(cash_balance),0) AS cash_balance
      FROM investment_account_balances WHERE month=?
    `).get(latest) as Row;
    const principal = Number(investment.principal ?? 0);
    const marketValue = Number(investment.market_value ?? 0);
    const investmentCash = Number(investment.cash_balance ?? 0);
    const debt = this.activeDebtByMonth(db, [latest]).get(latest) ?? 0;
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
    latestMonth: string,
    selectedMonths: string[],
    categories: CategoryDefinition[],
    transactionsByMonth: Map<string, Transaction[]>
  ): RecurringExpenseSummary[] {
    const selected = new Set(selectedMonths.filter((month) => month <= latestMonth));
    if (!selected.size) return [];
    const periodicCategories = new Map(
      categories
        .filter((category) => category.pattern === "周期")
        .map((category) => [category.category_key, category.name])
    );
    const result = new Map<string, {
      category: string;
      months: Set<string>;
      count: number;
      total: number;
      latestAmount: number;
      lastDate: string;
    }>();
    [...transactionsByMonth.entries()]
      .filter(([month]) => selected.has(month))
      .flatMap(([month, transactions]) => transactions
        .filter((transaction) =>
          transaction.type === "支出"
          && periodicCategories.has(transaction.category_key ?? "")
        )
        .map((transaction) => ({ month, transaction })))
      .sort((left, right) =>
        left.transaction.transaction_date.localeCompare(right.transaction.transaction_date)
        || left.month.localeCompare(right.month)
      )
      .forEach(({ month, transaction }) => {
        const product = transaction.product;
        const category = periodicCategories.get(transaction.category_key ?? "")
          ?? transaction.category;
        const current = result.get(product) ?? {
          category,
          months: new Set<string>(),
          count: 0,
          total: 0,
          latestAmount: 0,
          lastDate: ""
        };
        current.months.add(month);
        current.count += 1;
        current.total += transaction.amount;
        const date = transaction.transaction_date || `${month}-01`;
        if (date >= current.lastDate) {
          current.lastDate = date;
          current.latestAmount = transaction.amount;
          current.category = category;
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
