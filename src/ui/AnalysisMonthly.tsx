import { useEffect, useState } from "react";
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
import type { MonthWorkspace } from "../types";
import type { AssetTrackService } from "../services/AssetTrackService";
import {
  buildAnomalyDisplayRows,
  changeTone,
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
  api,
  month,
  dataVersion,
  reconciliationTolerance
}: {
  api: AssetTrackService;
  month: string;
  dataVersion: number;
  reconciliationTolerance: number;
}) {
  const [state, setState] = useState<LoadState<MonthWorkspace>>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void api.month(month)
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((error) => active && setState({
        kind: "error",
        message: displayError(error)
      }));
    return () => { active = false; };
  }, [api, dataVersion, month]);
  if (state.kind === "loading") return <Empty text={t(`正在加载 ${month} 月度分析…`, `Loading ${month} monthly analysis…`)} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const overview = state.data.overview;
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
        { label: t("资金投入资产", "Cost assets"), value: money(overview.metrics.cost_assets) },
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
          tone: overview.reconciliation?.available
            ? changeTone(overview.reconciliation.discrepancy)
            : undefined,
          suffix: overview.reconciliation?.available
            ? businessLabel(reconciliationStatus(
              overview.reconciliation.discrepancy,
              reconciliationTolerance
            ))
            : undefined
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
          <div className="asset-track-analysis-list">
            <div><span>{t("本金", "Principal")}</span><strong>{money(overview.investment?.principal)}</strong></div>
            <div><span>{t("市值", "Market value")}</span><strong>{money(overview.investment?.market_value)}</strong></div>
            <div><span>{t("流动现金", "Liquid cash")}</span><strong>{money(overview.investment?.cash_balance)}</strong></div>
            <div><span>{t("收益率", "Return")}</span><strong>{percent(overview.investment?.roi_percent)}</strong></div>
            <div>
              <span>{t("对比上月", "Compared with previous month")}</span>
              <strong className={
                (overview.investment?.comparison.amount_delta ?? 0) > 0
                  ? "is-growth"
                  : (overview.investment?.comparison.amount_delta ?? 0) < 0
                    ? "is-decline"
                    : ""
              }>
                {overview.investment?.comparison.available
                  ? `${signed(
                    overview.investment.comparison.amount_delta,
                    money
                  )}（${signed(
                    overview.investment.comparison.percent_delta,
                    percent
                  )}）`
                  : t("不可比较", "Unavailable")}
              </strong>
            </div>
          </div>
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
  anomalies: MonthWorkspace["overview"]["anomalies"];
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
