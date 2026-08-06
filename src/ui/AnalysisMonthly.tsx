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
  reconciliationTolerance
}: {
  month: string;
  state: LoadState<MonthOverview>;
  reconciliationTolerance: number;
}) {
  if (state.kind === "loading") return <Empty text={t(`正在加载 ${month} 月度分析…`, `Loading ${month} monthly analysis…`)} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const overview = state.data;
  if (!overview.available || !overview.metrics) return <Empty text={t(`${month} 暂无可分析数据。`, `No analyzable data is available for ${month}.`)} />;
  const structure = overview.structure;
  const necessity = structure
    ? [
        { name: t("必要", "Essential"), value: structure.necessary },
        { name: t("可控", "Discretionary"), value: structure.controlled }
      ].filter((item) => item.value > 0)
    : [];
  const pattern = structure
    ? [
        { name: t("周期", "Recurring"), value: structure.periodic },
        { name: t("日常", "Everyday"), value: structure.daily },
        { name: t("偶尔", "Occasional"), value: structure.occasional }
      ].filter((item) => item.value > 0)
    : [];
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
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div><h2>{t(`${month} 月度分析`, `${month} monthly analysis`)}</h2><span>{t("固定资产不参与资产、对账和消费计算", "Fixed assets are excluded from assets, reconciliation, and spending calculations")}</span></div>
      </div>
      <Cards items={[
        { label: t("收入", "Income"), value: money(overview.metrics.total_income), tone: "inflow" },
        { label: t("净支出", "Net expense"), value: money(overview.metrics.total_expense), tone: "outflow" },
        {
          label: t("储蓄", "Savings"),
          value: money(overview.metrics.surplus),
          tone: overview.metrics.surplus >= 0 ? "inflow" : "outflow"
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
              : "outflow"
        },
        { label: t("总资产", "Total assets"), value: money(overview.metrics.total_assets) },
        { label: t("市场净资产", "Market net assets"), value: money(overview.metrics.market_net_assets) },
        {
          label: t("资产环比", "Asset change"),
          value: overview.metrics.asset_delta === null
            ? t("不可比较", "Unavailable")
            : money(overview.metrics.asset_delta),
          tone: changeTone(overview.metrics.asset_delta)
        },
        {
          label: t("对账差额", "Reconciliation difference"),
          value: overview.reconciliation?.available
            ? money(overview.reconciliation.discrepancy)
            : t("不可比较", "Unavailable"),
          tone: reconciliationTone(discrepancy, reconciliationTolerance),
          suffix: discrepancyStatus ? businessLabel(discrepancyStatus) : undefined
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
            return <div className="asset-track-investment-account" key={account.account_key}>
              <h4>{account.name}</h4>
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
            </div>;
          }) : <Empty text={t("暂无理财账户。", "No investment accounts.")} />}
        </ChartPanel>
      </div>
      <div className="asset-track-analysis-grid is-three">
        <PiePanel title={t("必要 / 可控", "Essential / discretionary")} data={necessity} />
        <PiePanel title={t("周期 / 日常 / 偶尔", "Recurring / everyday / occasional")} data={pattern} />
        <PiePanel
          title={t("具体分类", "Categories")}
          data={categories.map((row) => ({ name: row.category, value: row.amount }))}
        />
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
      </div>
    </>
  );
}

function PiePanel({
  title,
  data
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
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
    </ChartPanel>
  );
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
        <div className="asset-track-table-scroll">
          <table className="asset-track-analysis-anomaly-table">
            <thead>
              <tr>
                <StaticTableHeader label={t("分类", "Category")} />
                <StaticTableHeader label={t("金额", "Amount")} className="asset-track-amount-column" />
                <StaticTableHeader label={t("异常情况", "Anomaly")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td className="asset-track-amount-cell">{money(row.amount)}</td>
                  <td>{displayError(row.situation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty text={t("暂无达到阈值的异常变化。", "No anomalous changes reached the threshold.")} />}
    </ChartPanel>
  );
}
