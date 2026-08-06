import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type {
  AnnualOverview
} from "../types/analysis";
import { businessLabel, getLocale, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { sampleAnnualRows } from "./analysisModel";
import { StaticTableHeader } from "./TablePrimitives";
import {
  axis,
  BLUE,
  Cards,
  ChartPanel,
  Empty,
  GOLD,
  INFLOW,
  OUTFLOW,
  percent,
  PURPLE,
  SavingsBarShape,
  tooltipMoney,
  tooltipPercent
} from "./AnalysisPrimitives";
import type { LoadState } from "./AnalysisPrimitives";

export function AnnualAnalysis({
  year,
  state
}: {
  year: string;
  state: LoadState<AnnualOverview>;
}) {
  const [recurringSort, setRecurringSort] = useState<
    "product" | "total" | "last_date"
  >("total");
  if (state.kind === "loading") return <Empty text={t(`正在加载 ${year} 年度分析…`, `Loading ${year} annual analysis…`)} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const data = state.data;
  if (!data.rows.length) return <Empty text={t(`${year} 暂无数据。`, `No data is available for ${year}.`)} />;
  const latest = data.latest;
  const monthlySavings = data.rolling_rows.filter(
    (row) => row.savings_rate !== null
  );
  const history = sampleAnnualRows(data.all_trend_rows);
  const recurring = [...data.recurring_expenses].sort((left, right) => {
    if (recurringSort === "product") return left.product.localeCompare(right.product, getLocale());
    if (recurringSort === "last_date") return right.last_date.localeCompare(left.last_date);
    return right.total - left.total;
  });
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div><h2>{t(`${year} 年度总览`, `${year} annual overview`)}</h2><span>{t("自然年汇总与近 12 月滚动观察", "Calendar-year summary and rolling 12-month view")}</span></div>
      </div>
      <Cards items={[
        { label: t("年度收入", "Annual income"), value: money(data.metrics.total_income), tone: "inflow" },
        { label: t("年度净支出", "Annual net expense"), value: money(data.metrics.total_expense), tone: "outflow" },
        {
          label: t("年度储蓄", "Annual savings"),
          value: money(data.metrics.savings),
          tone: data.metrics.savings >= 0 ? "inflow" : "outflow"
        },
        {
          label: t("年度储蓄率", "Annual savings rate"),
          value: data.metrics.savings_rate === null
            ? t("不可计算", "Unavailable")
            : percent(data.metrics.savings_rate),
          tone: data.metrics.savings_rate === null
            ? undefined
            : data.metrics.savings_rate >= 0
              ? "inflow"
              : "outflow"
        }
      ]} />
      <Cards items={[
        { label: t("年末总资产", "Year-end total assets"), value: money(latest?.total_assets) },
        { label: t("年末净资产", "Year-end net assets"), value: money(latest?.market_net_assets) },
        { label: t("年末现金", "Year-end cash"), value: money(latest?.cash) },
        { label: t("年末借款", "Year-end debt"), value: money(latest?.debt) }
      ]} />
      <ChartPanel title={t("近 12 个月综合趋势", "Combined 12-month trend")} className="is-wide">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={data.rolling_rows}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="month" />
            <YAxis yAxisId="flow" tickFormatter={axis} />
            <YAxis yAxisId="asset" orientation="right" tickFormatter={axis} />
            <Tooltip formatter={tooltipMoney} />
            <Legend />
            <Bar yAxisId="flow" dataKey="total_income" name={t("收入", "Income")} fill={INFLOW} />
            <Bar yAxisId="flow" dataKey="total_expense" name={t("支出", "Expense")} fill={OUTFLOW} />
            <Line yAxisId="asset" type="monotone" dataKey="cash" name={t("现金", "Cash")} stroke={GOLD} strokeWidth={2} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="market_net_assets" name={t("市场净资产", "Market net assets")} stroke={PURPLE} strokeWidth={3} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="cost_assets" name={t("总资产", "Total assets")} stroke={BLUE} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartPanel>
      <ChartPanel title={t("周期消费（最近 12 个有数据月份）", "Recurring expenses (latest 12 data months)")} className="is-wide">
        <div className="asset-track-analysis-toolbar">
          <button onClick={() => setRecurringSort("product")}>{t("按商品", "Sort by item")}</button>
          <button onClick={() => setRecurringSort("total")}>{t("按累计金额", "Sort by total")}</button>
          <button onClick={() => setRecurringSort("last_date")}>{t("按最近日期", "Sort by latest date")}</button>
        </div>
        {recurring.length ? (
          <div className="asset-track-table-scroll">
            <table className="asset-track-analysis-recurring-table">
              <thead><tr>
                <StaticTableHeader label={t("商品", "Item")} /><StaticTableHeader label={t("分类", "Category")} />
                <StaticTableHeader label={t("出现月份", "Months")} className="asset-track-count-column" /><StaticTableHeader label={t("次数", "Transactions")} className="asset-track-count-column" />
                <StaticTableHeader label={t("累计金额", "Total")} className="asset-track-amount-column" /><StaticTableHeader label={t("平均单次", "Average")} className="asset-track-amount-column" />
                <StaticTableHeader label={t("最近金额", "Latest amount")} className="asset-track-amount-column" /><StaticTableHeader label={t("最后发生日期", "Last date")} className="asset-track-date-column" />
              </tr></thead>
              <tbody>{recurring.map((row) => (
                <tr key={row.product || "__empty__"}>
                  <td>{row.product || t("未填写商品", "Item not specified")}</td>
                  <td>{row.category}</td><td className="asset-track-count-cell">{row.months_count}</td>
                  <td className="asset-track-count-cell">{row.transaction_count}</td><td className="asset-track-amount-cell">{money(row.total)}</td>
                  <td className="asset-track-amount-cell">{money(row.average_amount)}</td><td className="asset-track-amount-cell">{money(row.latest_amount)}</td>
                  <td className="asset-track-date-cell">{row.last_date}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty text={t("最近 12 个有数据月份没有周期消费。", "No recurring expenses were found in the latest 12 data months.")} />}
      </ChartPanel>
      <ChartPanel title={t(`固定资产（${data.fixed_assets.length} 项）`, `Fixed assets (${data.fixed_assets.length})`)} className="is-wide">
        <p className="asset-track-analysis-note">
          {t("显示当年出现过的固定资产，并保留年度内最后状态；固定资产不计入总资产。", "Shows fixed assets that appeared during the year with their last status; fixed assets are excluded from total assets.")}
        </p>
        {data.fixed_assets.length ? (
          <div className="asset-track-table-scroll">
            <table className="asset-track-analysis-fixed-assets-table">
              <thead><tr>
                <StaticTableHeader label={t("名称", "Name")} />
                <StaticTableHeader label={t("类别", "Category")} />
                <StaticTableHeader label={t("状态", "Status")} className="asset-track-status-column" />
                <StaticTableHeader label={t("购买价格", "Purchase price")} className="asset-track-amount-column" />
                <StaticTableHeader label={t("最后出现月", "Last seen month")} className="asset-track-date-column" />
              </tr></thead>
              <tbody>{data.fixed_assets.map((row) => (
                <tr key={row.asset_key ?? row.id}>
                  <td>{row.asset_name}</td>
                  <td>{row.category}</td>
                  <td className="asset-track-status-cell">{businessLabel(row.status)}</td>
                  <td className="asset-track-amount-cell">{money(row.purchase_price)}</td>
                  <td className="asset-track-date-cell">{row.last_seen_month}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty text={t("该年度没有出现固定资产。", "No fixed assets appeared during this year.")} />}
      </ChartPanel>
      <ChartPanel title={t("近 12 月逐月储蓄率", "Monthly savings rate over 12 months")} className="is-wide">
        {monthlySavings.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlySavings}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
              <Tooltip formatter={tooltipPercent} />
              <ReferenceLine y={0} stroke="var(--text-muted)" />
              <Bar
                dataKey="savings_rate"
                name={t("单月储蓄率", "Monthly savings rate")}
                shape={SavingsBarShape}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <Empty text={t("近 12 月没有收入大于零的月份。", "No month in the last 12 months has income above zero.")} />}
      </ChartPanel>
      <div className="asset-track-analysis-grid">
        <ChartPanel title={t("年度分类成本", "Annual category costs")}>
          <ResponsiveContainer width="100%" height={Math.max(280, data.cost_audit.categories.length * 32)}>
            <ComposedChart layout="vertical" data={[...data.cost_audit.categories].reverse()}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis type="number" tickFormatter={axis} />
              <YAxis type="category" dataKey="category" width={80} />
              <Tooltip formatter={tooltipMoney} />
              <Bar dataKey="total" name={t("年度金额", "Annual amount")} fill={PURPLE} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title={t("消费频率", "Spending frequency")}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data.cost_audit.patterns}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="pattern" />
              <YAxis tickFormatter={axis} />
              <Tooltip formatter={tooltipMoney} />
              <Bar dataKey="total" name={t("年度金额", "Annual amount")} fill={GOLD} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
      <Cards items={[
        { label: t("必要支出", "Essential expenses"), value: money(data.cost_audit.necessary_total) },
        { label: t("可控支出", "Discretionary expenses"), value: money(data.cost_audit.controlled_total) },
        { label: t("可控占比", "Discretionary share"), value: percent(data.cost_audit.controlled_percent) },
        {
          label: t("总资产支撑月", "Months supported by total assets"),
          value: data.cost_audit.asset_support_months === null
            ? t("不可计算", "Unavailable")
            : t(`${data.cost_audit.asset_support_months.toFixed(1)} 个月`, `${data.cost_audit.asset_support_months.toFixed(1)} months`)
        }
      ]} />
      <ChartPanel title={t("全历史趋势", "All-time trend")} className="is-wide">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={history}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="month" />
            <YAxis yAxisId="flow" tickFormatter={axis} />
            <YAxis yAxisId="asset" orientation="right" tickFormatter={axis} />
            <Tooltip formatter={tooltipMoney} />
            <Legend />
            <Bar yAxisId="flow" dataKey="total_income" name={t("收入", "Income")} fill={INFLOW} />
            <Bar yAxisId="flow" dataKey="total_expense" name={t("支出", "Expense")} fill={OUTFLOW} />
            <Line yAxisId="asset" type="monotone" dataKey="cash" name={t("现金", "Cash")} stroke={GOLD} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="market_net_assets" name={t("市场净资产", "Market net assets")} stroke={PURPLE} strokeWidth={2.5} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="cost_assets" name={t("总资产", "Total assets")} stroke={BLUE} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartPanel>
    </>
  );
}
