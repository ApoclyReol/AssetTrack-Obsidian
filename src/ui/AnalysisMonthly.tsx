import {
  Bar,
  ComposedChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type {
  InvestmentAccountAnalysis
} from "../types/configuration";
import type {
  MonthOverview
} from "../types/month";
import type { TransactionAnalysisDrilldown } from "../types/analysis";
import {
  buildAnomalyDisplayRows,
  changeTone,
  reconciliationTone,
  reconciliationStatus
} from "./analysisModel";
import { businessLabel, displayError, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { StaticTableHeader } from "./TablePrimitives";
import {
  Cards,
  ChartPanel,
  ComparisonBarLabel,
  ComparisonCategoryTick,
  Empty,
  type LoadState,
  PIE_COLORS,
  percent,
  PURPLE,
  signed,
  tooltipMoney
} from "./AnalysisPrimitives";

export function MonthlyAnalysis({
  month,
  state,
  reconciliationTolerance,
  onOpenTransactions
}: {
  month: string;
  state: LoadState<MonthOverview>;
  reconciliationTolerance: number;
  onOpenTransactions?: (drilldown?: TransactionAnalysisDrilldown) => void;
}) {
  if (state.kind === "loading") return <Empty text={t(`正在加载 ${month} 月度分析…`, `Loading ${month} monthly analysis…`)} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const overview = state.data;
  if (!overview.available || !overview.metrics) return (
    <section className="asset-track-analysis-integrity is-warning" role="status">
      <h2>{t(`${month} 暂无完整分析数据`, `Incomplete analysis data for ${month}`)}</h2>
      <p>{t("分析需要已保存的流水和资产快照。请先回到流水页完成导入、整理并保存。", "Analysis needs saved transactions and asset snapshots. Return to the transactions page to import, organize, and save first.")}</p>
      {onOpenTransactions && <button type="button" onClick={() => onOpenTransactions()}>{t("返回当前月流水", "Return to this month's transactions")}</button>}
    </section>
  );
  const categories = overview.category_summary ?? [];
  const comparison = overview.category_comparison;
  const comparisonRows = comparison?.rows ?? [];
  const discrepancy = overview.reconciliation?.available
    ? overview.reconciliation.discrepancy
    : null;
  const discrepancyStatus = reconciliationStatus(discrepancy, reconciliationTolerance);
  const investmentAccounts: InvestmentAccountAnalysis[] = overview.investment_accounts
    ?? (overview.investment ? [{
      account_key: "aggregate",
      name: t("全部理财账户", "All investment accounts"),
      principal: overview.investment.principal,
      deposit: 0,
      withdraw: 0,
      market_value: overview.investment.market_value,
      cash_balance: overview.investment.cash_balance,
      position: overview.investment.position,
      profit: overview.investment.profit,
      roi_percent: overview.investment.roi_percent,
      comparison: {
        ...overview.investment.comparison,
        previous_roi_percent: null,
        roi_delta_percent: null
      }
    }] : []);
  const reconciliationIncomplete = !overview.reconciliation?.available
    || overview.reconciliation.theoretical.previous_cash === null;
  return (
    <>
      {reconciliationIncomplete && (
        <section className="asset-track-analysis-integrity is-warning" role="status">
          <strong>{t("数据完整性提示", "Data integrity check")}</strong>
          <p>{t("当前月度指标可以查看，但缺少上月现金或资产快照，因此对账差额和部分环比结果不可比较。下一步请补充资产账户或创建前置月份。", "Monthly metrics are available, but the previous cash or asset snapshot is missing. Reconciliation and some comparisons cannot be computed. Complete asset accounts or create the preceding month next.")}</p>
          {onOpenTransactions && <button type="button" onClick={() => onOpenTransactions()}>{t("去补充资产和流水", "Complete assets and transactions")}</button>}
        </section>
      )}
      <Cards items={[
        { label: t("收入", "Income"), value: money(overview.metrics.total_income), tone: "inflow", hint: t("本月入账合计", "Total income this month") },
        { label: t("净支出", "Net expense"), value: money(overview.metrics.total_expense), tone: "outflow", hint: t("支出减去代付", "Expenses minus paid-on-behalf transactions") },
        {
          label: t("储蓄", "Savings"),
          value: money(overview.metrics.surplus),
          tone: overview.metrics.surplus >= 0 ? "inflow" : "outflow",
          hint: t("收入减净支出", "Income minus net expense")
        },
        {
          label: t("储蓄率", "Savings rate"),
          value: overview.metrics.savings_rate === null
            ? t("不可计算", "Unavailable")
            : percent(overview.metrics.savings_rate),
          tone: overview.metrics.savings_rate === null
            ? undefined
            : overview.metrics.savings_rate >= 0
              ? "inflow"
              : "outflow",
          hint: t("储蓄占收入比例", "Savings as a share of income")
        },
        { label: t("总资产", "Total assets"), value: money(overview.metrics.total_assets), hint: t("现金减借款加投入本金", "Cash minus debt plus invested principal") },
        { label: t("市场净资产", "Market net assets"), value: money(overview.metrics.market_net_assets), hint: t("按当前理财市值计算", "Uses current investment market value") },
        {
          label: t("资产环比", "Asset change"),
          value: overview.metrics.asset_delta === null
            ? t("不可比较", "Unavailable")
            : money(overview.metrics.asset_delta),
          tone: changeTone(overview.metrics.asset_delta),
          hint: t("与上月资产比较", "Compared with the previous month")
        },
        {
          label: t("对账差额", "Reconciliation difference"),
          value: overview.reconciliation?.available
            ? money(overview.reconciliation.discrepancy)
            : t("不可比较", "Unavailable"),
          tone: reconciliationTone(discrepancy, reconciliationTolerance),
          suffix: discrepancyStatus ? businessLabel(discrepancyStatus) : undefined,
          hint: t("实际净支出减理论消费", "Actual net expense minus theoretical consumption")
        }
      ]} />
      <div className="asset-track-analysis-grid">
        <ChartPanel title={t("现金账户", "Cash accounts")}>
          <div className="asset-track-analysis-list">
            {(overview.cash_accounts ?? []).map((row) => (
              <div key={row.account}><span>{row.account}</span><strong>{money(row.balance)}</strong></div>
            ))}
            <div><span>{t("现金合计", "Total cash")}</span><strong>{money(overview.cash_total)}</strong></div>
          </div>
        </ChartPanel>
        <ChartPanel title={t("理财状态", "Investment status")}>
          {investmentAccounts.length ? investmentAccounts.map((account) => {
            const flow = [
              account.deposit > 0 ? `${t("加仓", "Added")} ${money(account.deposit)}` : "",
              account.withdraw > 0 ? `${t("提现", "Withdrawn")} ${money(account.withdraw)}` : ""
            ].filter(Boolean).join("，");
            return <section className="asset-track-investment-account" key={account.account_key}>
              <h3 className="asset-track-investment-account-heading">{account.name}</h3>
              <div className="asset-track-analysis-list">
                <div><span>{t("本金", "Principal")}</span><strong>{money(account.principal)}{flow ? <small>（{flow}）</small> : null}</strong></div>
                <div><span>{t("市值", "Market value")}</span><strong>{money(account.market_value)}</strong></div>
                <div><span>{t("流动资金", "Liquid funds")}</span><strong>{money(account.cash_balance)}</strong></div>
                <div><span>{t("仓位", "Position")}</span><strong>{money(account.position)}</strong></div>
                <div><span>{t("收益率", "Return")}</span><strong>{percent(account.roi_percent)}</strong></div>
                <div>
                  <span>{t("对比上月", "Compared with previous month")}</span>
                  <strong className={account.comparison.amount_delta !== null && account.comparison.amount_delta > 0
                    ? "is-growth"
                    : account.comparison.amount_delta !== null && account.comparison.amount_delta < 0
                      ? "is-decline" : ""}>
                    {account.comparison.available
                      ? `${signed(account.comparison.amount_delta, money)}（${t("收益率", "Return")} ${signed(account.comparison.roi_delta_percent, percent)}）`
                      : t("不可比较", "Unavailable")}
                  </strong>
                </div>
              </div>
            </section>;
          }) : <Empty text={t("暂无理财账户。", "No investment accounts.")} />}
        </ChartPanel>
      </div>
      <div className="asset-track-analysis-grid is-three">
        <PiePanel
          title={t("具体分类", "Categories")}
          data={categories.map((row) => ({ name: row.category, value: row.amount, months: [month] }))}
          onOpenTransactions={onOpenTransactions}
        />
        <MonthlyDimensionPanel title={t("属性", "Attributes")} rows={(overview.attribute_summary ?? []).map((row) => ({
          name: `${row.group} · ${row.attribute}`,
          amount: row.amount,
          count: row.transaction_count,
          drilldown: { dimension: "attribute", key: row.attribute_key, label: `${row.group} · ${row.attribute}`, months: [month] }
        }))} onOpenTransactions={onOpenTransactions} />
        <MonthlyDimensionPanel title={t("标签", "Tags")} rows={(overview.tag_summary ?? []).map((row) => ({
          name: row.tag,
          amount: row.amount,
          count: row.transaction_count,
          categories: row.categories,
          drilldown: { dimension: "tag", key: row.tag_key, label: row.tag, months: [month] }
        }))} note={t("同一笔流水可计入多个标签，标签金额不能相加。", "A transaction can appear in multiple tags; tag amounts must not be added together.")} onOpenTransactions={onOpenTransactions} />
      </div>
      <ChartPanel title={t(`分类与上月对比${comparison?.previous_month ? `（${comparison.previous_month}）` : ""}`, `Category comparison with previous month${comparison?.previous_month ? ` (${comparison.previous_month})` : ""}`)}>
        {comparison?.available && comparisonRows.length ? (
          <ResponsiveContainer width="100%" height={Math.max(300, comparisonRows.length * 48)}>
            <ComposedChart
              layout="vertical"
              data={comparisonRows}
              margin={{ top: 8, right: 150, bottom: 8, left: 12 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="category"
                width={190}
                tick={<ComparisonCategoryTick rows={comparisonRows} />}
              />
              <Tooltip formatter={tooltipMoney} />
              <Bar
                dataKey="previous"
                name={t("上月", "Previous month")}
                fill="var(--text-faint)"
                label={
                  <ComparisonBarLabel
                    prefix={t("上月", "Previous")}
                    color="var(--text-muted)"
                  />
                }
              />
              <Bar
                dataKey="current"
                name={t("本月", "Current month")}
                fill={PURPLE}
                label={
                  <ComparisonBarLabel
                    prefix={t("本月", "Current")}
                    color="var(--text-normal)"
                  />
                }
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <Empty text={t("严格上一个自然月没有可比较数据。", "The immediately preceding calendar month has no comparable data.")} />}
      </ChartPanel>
      <div className="asset-track-analysis-grid asset-track-anomaly-grid">
        <BigTicketPanel rows={overview.big_tickets ?? []} />
        <AnomalyPanel anomalies={overview.anomalies} />
        <IncomePanel rows={overview.income_transactions ?? []} />
      </div>
    </>
  );
}

function PiePanel({
  title,
  data,
  onOpenTransactions
}: {
  title: string;
  data: Array<{ name: string; value: number; months?: string[] }>;
  onOpenTransactions?: (drilldown?: TransactionAnalysisDrilldown) => void;
}) {
  const coloredData = data.map((item, index) => ({
    ...item,
    fill: PIE_COLORS[index % PIE_COLORS.length]
  }));
  return (
    <ChartPanel title={title}>
      {data.length ? (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={coloredData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={88} />
            <Tooltip formatter={tooltipMoney} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : <Empty text={t("暂无数据。", "No data.")} />}
      {onOpenTransactions && data.length > 0 && <div className="asset-track-analysis-drilldown-list">
        {data.map((item) => <button
          key={item.name}
          type="button"
          className="asset-track-analysis-drilldown"
          onClick={() => onOpenTransactions({
            dimension: "category",
            key: item.name,
            label: item.name,
            months: item.months
          })}
        >{t("查看", "View")} {item.name} {t("流水", "transactions")}</button>)}
      </div>}
    </ChartPanel>
  );
}

function MonthlyDimensionPanel({
  title,
  rows,
  note,
  onOpenTransactions
}: {
  title: string;
  rows: Array<{
    name: string;
    amount: number;
    count: number;
    categories?: Array<{ category: string; amount: number }>;
    drilldown?: TransactionAnalysisDrilldown;
  }>;
  note?: string;
  onOpenTransactions?: (drilldown?: TransactionAnalysisDrilldown) => void;
}) {
  return <ChartPanel title={title}>
    {note && <p className="asset-track-rule-history-message" role="note">{note}</p>}
    {rows.length ? <div className="asset-track-analysis-list">
      {rows.map((row) => <div key={row.name}>
        <span>{row.name}
          {row.categories?.length ? <small>（{row.categories.map((category) => `${category.category} ${money(category.amount)}`).join("、")}）</small> : null}
        </span>
        <strong>{money(row.amount)} <small>（{row.count}）</small>
          {onOpenTransactions && row.drilldown && <button
            type="button"
            className="asset-track-analysis-drilldown"
            onClick={() => onOpenTransactions(row.drilldown)}
          >{t("查看流水", "View transactions")}</button>}
        </strong>
      </div>)}
    </div> : <Empty text={t("暂无数据。", "No data.")} />}
  </ChartPanel>;
}

function BigTicketPanel({
  rows
}: {
  rows: Array<{ product: string; category: string; amount: number }>;
}) {
  return (
    <ChartPanel title={t("大额支出", "Large expenses")} className="asset-track-big-ticket-panel">
      {rows.length ? (
        <div className="asset-track-table-scroll">
          <table className="asset-track-analysis-big-ticket-table">
            <thead>
              <tr><StaticTableHeader label={t("商品", "Item")} /><StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" /></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.product}-${index}`}>
                  <td>{row.product || t("未填写商品", "Item not specified")}</td>
                  <td className="asset-track-amount-cell">{money(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty text={t("暂无记录。", "No records.")} />}
    </ChartPanel>
  );
}

function AnomalyPanel({
  anomalies
}: {
  anomalies: MonthOverview["anomalies"];
}) {
  const rows = buildAnomalyDisplayRows(anomalies);
  return (
    <ChartPanel title={t("异常与变化", "Anomalies and changes")} className="asset-track-anomaly-panel">
      {rows.length ? (
        <>
          <div className="asset-track-table-scroll">
            <table className="asset-track-analysis-anomaly-table">
            <thead>
              <tr>
                <StaticTableHeader label={t("分类", "Category")} />
                <StaticTableHeader label={t("异常情况", "Anomaly")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td>{displayError(row.situation)}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </>
      ) : <Empty text={t("暂无达到阈值的异常变化。", "No anomalous changes reached the threshold.")} />}
    </ChartPanel>
  );
}

function IncomePanel({ rows }: { rows: NonNullable<MonthOverview["income_transactions"]> }) {
  return <ChartPanel title={t("收入分析", "Income analysis")} className="asset-track-income-panel">
    {rows.length ? <>
      <div className="asset-track-table-scroll">
        <table className="asset-track-analysis-income-table">
          <thead><tr>
            <StaticTableHeader label={t("日期", "Date")} className="asset-track-date-column" />
            <StaticTableHeader label={t("商品", "Item")} />
            <StaticTableHeader label={t("交易对手", "Counterparty")} />
            <StaticTableHeader label={t("分类", "Category")} />
            <StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" />
          </tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id ?? `${row.transaction_date}-${index}`}>
            <td className="asset-track-date-cell">{row.transaction_date}</td>
            <td>{row.product || t("未填写商品", "Item not specified")}</td>
            <td>{row.counterparty || t("未填写交易对手", "Counterparty not specified")}</td>
            <td>{row.category || t("未分类", "Uncategorized")}</td>
            <td className="asset-track-amount-cell">{money(row.amount)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th scope="row" colSpan={4}>{t("合计", "Total")}</th>
            <td className="asset-track-amount-cell">{money(rows.reduce((sum, row) => sum + row.amount, 0))}</td>
          </tr></tfoot>
        </table>
      </div>
    </> : <Empty text={t("本月没有收入流水。", "No income transactions this month.")} />}
  </ChartPanel>;
}
