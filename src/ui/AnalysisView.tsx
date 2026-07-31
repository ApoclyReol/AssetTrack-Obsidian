import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ANALYSIS_MODES, type AnalysisMode } from "../constants";
import type {
  AnnualOverview,
  CurrentAsset,
  MonthWorkspace
} from "../types";
import type { AssetTrackService } from "../services/AssetTrackService";
import {
  buildAnomalyDisplayRows,
  changeTone,
  INFLOW_COLOR,
  OUTFLOW_COLOR,
  reconciliationStatus,
  sampleAnnualRows,
  savingsColor
} from "./analysisModel";
import { businessLabel, displayError, getLocale, t } from "../i18n";
import { money } from "../domain/moneyFormat";

const INFLOW = INFLOW_COLOR;
const OUTFLOW = OUTFLOW_COLOR;
const GOLD = "var(--asset-track-cash)";
const BLUE = "var(--asset-track-investment)";
const PURPLE = "var(--asset-track-total-assets)";
const PIE_COLORS = [
  "var(--asset-track-chart-1)",
  "var(--asset-track-chart-2)",
  "var(--asset-track-chart-3)",
  "var(--asset-track-chart-4)",
  "var(--asset-track-chart-5)",
  "var(--asset-track-chart-6)",
  "var(--asset-track-chart-7)",
  "var(--asset-track-chart-8)",
  "var(--asset-track-chart-9)",
  "var(--asset-track-chart-10)"
];

type LoadState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

function percent(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : "—";
}

function signed(value: unknown, formatter: (input: unknown) => string): string {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${parsed > 0 ? "+" : ""}${formatter(parsed)}`;
}

function axis(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  if (Math.abs(parsed) >= 10_000 && getLocale() === "zh-CN") return `${(parsed / 10_000).toFixed(1)}万`;
  return String(Math.round(parsed));
}

function Cards({
  items
}: {
  items: Array<{
    label: string;
    value: string;
    tone?: "inflow" | "outflow";
    suffix?: string;
  }>;
}) {
  return (
    <div className="asset-track-analysis-cards">
      {items.map((item) => (
        <div className={`asset-track-analysis-card ${item.tone ?? ""}`} key={item.label}>
          <span>{item.label}</span>
          <strong>
            {item.value}
            {item.suffix ? (
              <small className="asset-track-analysis-card-suffix">（{item.suffix}）</small>
            ) : null}
          </strong>
        </div>
      ))}
    </div>
  );
}

function ChartPanel({
  title,
  children,
  className = ""
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`asset-track-analysis-panel ${className}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="asset-track-analysis-empty">{text}</div>;
}

interface ComparisonTickProps {
  x?: number;
  y?: number;
  payload?: { value?: string };
  rows: Array<{ category: string; delta: number }>;
}

function ComparisonCategoryTick({
  x = 0,
  y = 0,
  payload,
  rows
}: ComparisonTickProps) {
  const category = String(payload?.value ?? "");
  const row = rows.find((item) => item.category === category);
  const delta = row?.delta ?? 0;
  const color = delta > 0 ? INFLOW : delta < 0 ? OUTFLOW : "var(--text-muted)";
  return (
    <text
      x={x - 8}
      y={y}
      dominantBaseline="central"
      textAnchor="end"
      fill="var(--text-normal)"
      fontSize={12}
    >
      <tspan>{category}</tspan>
      <tspan dx={6} fill={color}>{signed(delta, money)}</tspan>
    </text>
  );
}

interface ComparisonBarLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
  prefix: string;
  color: string;
}

function ComparisonBarLabel({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value,
  prefix,
  color
}: ComparisonBarLabelProps) {
  const labelX = Number(x) + Number(width) + 8;
  const labelY = Number(y) + Number(height) / 2;
  return (
    <text
      x={labelX}
      y={labelY}
      dominantBaseline="central"
      textAnchor="start"
      fill={color}
      fontSize={12}
    >
      {`${prefix} ${money(value)}`}
    </text>
  );
}

export function AnalysisView({
  api,
  months,
  month,
  onMonthChange,
  initialMode,
  onModeChange,
  dataVersion,
  reconciliationTolerance
}: {
  api: AssetTrackService;
  months: string[];
  month: string;
  onMonthChange: (month: string) => void;
  initialMode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  dataVersion: number;
  reconciliationTolerance: number;
}) {
  const [mode, setMode] = useState<AnalysisMode>(initialMode);
  useEffect(() => setMode(initialMode), [initialMode]);
  const years = useMemo(
    () => [...new Set(months.map((item) => item.slice(0, 4)))].sort().reverse(),
    [months]
  );
  const [year, setYear] = useState(years[0] ?? String(new Date().getFullYear()));
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [year, years]);
  const selectMode = (next: AnalysisMode) => {
    setMode(next);
    onModeChange(next);
  };
  return (
    <main className="asset-track-analysis">
      <div className="asset-track-analysis-nav">
        {ANALYSIS_MODES.map((item) => (
          <button
            key={item}
            className={mode === item ? "is-active" : ""}
            onClick={() => selectMode(item)}
          >
            {{ home: "Home", annual: t("年度", "Annual"), monthly: t("月度", "Monthly") }[item]}
          </button>
        ))}
        {mode === "annual" && (
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            {years.map((item) => <option key={item}>{item}</option>)}
          </select>
        )}
        {mode === "monthly" && (
          <select value={month} onChange={(event) => onMonthChange(event.target.value)}>
            {[...months].sort().reverse().map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        )}
      </div>
      {mode === "home" && (
        <HomeAnalysis api={api} dataVersion={dataVersion} />
      )}
      {mode === "annual" && (
        <AnnualAnalysis api={api} year={year} dataVersion={dataVersion} />
      )}
      {mode === "monthly" && month && (
        <MonthlyAnalysis
          api={api}
          month={month}
          dataVersion={dataVersion}
          reconciliationTolerance={reconciliationTolerance}
        />
      )}
      {mode === "monthly" && !month && <Empty text={t("尚无可分析月份。", "No months are available for analysis.")} />}
    </main>
  );
}

function HomeAnalysis({
  api,
  dataVersion
}: {
  api: AssetTrackService;
  dataVersion: number;
}) {
  const [state, setState] = useState<
    LoadState<{ current: CurrentAsset; month: MonthWorkspace | null }>
  >({ kind: "loading" });
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void api.currentAsset()
      .then(async (current) => ({
        current,
        month: current.month ? await api.month(current.month) : null
      }))
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((error) => active && setState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error)
      }));
    return () => { active = false; };
  }, [api, dataVersion]);
  if (state.kind === "loading") return <Empty text={t("正在加载资产首页…", "Loading asset overview…")} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const { current, month } = state.data;
  const metrics = month?.overview.metrics;
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div><h2>{t("资产首页", "Asset overview")}</h2><span>{t("最近月份：", "Latest month: ")}{current.month ?? "—"}</span></div>
      </div>
      <Cards items={[
        { label: t("现金", "Cash"), value: money(current.cash) },
        { label: t("理财本金", "Investment principal"), value: money(current.principal) },
        { label: t("资金投入资产", "Cost assets"), value: money(current.cost_assets) },
        { label: t("市场净资产", "Market net assets"), value: money(current.market_net_assets) }
      ]} />
      <p className="asset-track-analysis-note">
        {t(
          "资金投入资产用于稳定对账；市场净资产使用理财市值与理财账户现金反映当前财富。",
          "Cost assets keep reconciliation stable; market net assets use investment market value and account cash to reflect current wealth."
        )}
      </p>
      {metrics && (
        <Cards items={[
          { label: t("最近月收入", "Latest monthly income"), value: money(metrics.total_income), tone: "inflow" },
          { label: t("最近月净支出", "Latest monthly net expense"), value: money(metrics.total_expense), tone: "outflow" },
          {
            label: t("最近月储蓄", "Latest monthly savings"),
            value: money(metrics.surplus),
            tone: metrics.surplus >= 0 ? "inflow" : "outflow"
          },
          {
            label: t("最近月储蓄率", "Latest monthly savings rate"),
            value: metrics.savings_rate === null
              ? t("不可计算", "Unavailable")
              : percent(metrics.savings_rate)
          },
          {
            label: t("资产环比", "Asset change"),
            value: metrics.asset_delta === null ? t("不可比较", "Unavailable") : money(metrics.asset_delta),
            tone: changeTone(metrics.asset_delta)
          }
        ]} />
      )}
      <ChartPanel title={t("固定资产摘要", "Fixed asset summary")}>
        {current.fixed_assets.length ? (
          <div className="asset-track-table-scroll">
            <table>
              <thead><tr><th>{t("名称", "Name")}</th><th>{t("类别", "Category")}</th><th>{t("状态", "Status")}</th><th>{t("购买价格", "Purchase price")}</th></tr></thead>
              <tbody>
                {current.fixed_assets.map((row) => (
                  <tr key={row.asset_key ?? row.id}>
                    <td>{row.asset_name}</td>
                    <td>{row.category}</td>
                    <td>{businessLabel(row.status)}</td>
                    <td>{money(row.purchase_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text={t("当前没有在用或闲置的固定资产。", "There are no fixed assets in use or idle.")} />}
      </ChartPanel>
    </>
  );
}

function AnnualAnalysis({
  api,
  year,
  dataVersion
}: {
  api: AssetTrackService;
  year: string;
  dataVersion: number;
}) {
  const [state, setState] = useState<LoadState<AnnualOverview>>({ kind: "loading" });
  const [recurringSort, setRecurringSort] = useState<
    "product" | "total" | "last_date"
  >("total");
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void api.annual(year)
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((error) => active && setState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error)
      }));
    return () => { active = false; };
  }, [api, dataVersion, year]);
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
            : percent(data.metrics.savings_rate)
        }
      ]} />
      <Cards items={[
        { label: t("年末现金", "Year-end cash"), value: money(latest?.cash) },
        { label: t("年末理财本金", "Year-end investment principal"), value: money(latest?.principal) },
        { label: t("年末借款", "Year-end debt"), value: money(latest?.debt) },
        { label: t("年末资金投入资产", "Year-end cost assets"), value: money(latest?.cost_assets) },
        { label: t("年末市场净资产", "Year-end market net assets"), value: money(latest?.market_net_assets) }
      ]} />
      <ChartPanel title={t("近 12 个月综合趋势", "Combined 12-month trend")} className="is-wide">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={data.rolling_rows}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="month" />
            <YAxis yAxisId="flow" tickFormatter={axis} />
            <YAxis yAxisId="asset" orientation="right" tickFormatter={axis} />
            <Tooltip formatter={(value: number | string) => money(value)} />
            <Legend />
            <Bar yAxisId="flow" dataKey="total_income" name={t("收入", "Income")} fill={INFLOW} />
            <Bar yAxisId="flow" dataKey="total_expense" name={t("支出", "Expense")} fill={OUTFLOW} />
            <Line yAxisId="asset" type="monotone" dataKey="cash" name={t("现金", "Cash")} stroke={GOLD} strokeWidth={2} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="principal" name={t("理财本金", "Investment principal")} stroke={BLUE} strokeWidth={2} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="market_net_assets" name={t("市场净资产", "Market net assets")} stroke={PURPLE} strokeWidth={3} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="cost_assets" name={t("资金投入资产", "Cost assets")} stroke={BLUE} strokeWidth={2} dot={false} />
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
            <table>
              <thead><tr>
                <th>{t("商品", "Item")}</th><th>{t("分类", "Category")}</th>
                <th>{t("出现月份", "Months")}</th><th>{t("次数", "Transactions")}</th>
                <th>{t("累计金额", "Total")}</th><th>{t("平均单次", "Average")}</th>
                <th>{t("最近金额", "Latest amount")}</th><th>{t("最后发生日期", "Last date")}</th>
              </tr></thead>
              <tbody>{recurring.map((row) => (
                <tr key={row.product || "__empty__"}>
                  <td>{row.product || t("未填写商品", "Item not specified")}</td>
                  <td>{row.category}</td><td>{row.months_count}</td>
                  <td>{row.transaction_count}</td><td>{money(row.total)}</td>
                  <td>{money(row.average_amount)}</td><td>{money(row.latest_amount)}</td>
                  <td>{row.last_date}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty text={t("最近 12 个有数据月份没有周期消费。", "No recurring expenses were found in the latest 12 data months.")} />}
      </ChartPanel>
      <ChartPanel title={t("近 12 月逐月储蓄率", "Monthly savings rate over 12 months")} className="is-wide">
        {monthlySavings.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlySavings}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
              <Tooltip formatter={(value: number | string) => percent(value)} />
              <ReferenceLine y={0} stroke="var(--text-muted)" />
              <Bar dataKey="savings_rate" name={t("单月储蓄率", "Monthly savings rate")}>
                {monthlySavings.map((row) => (
                  <Cell
                    key={row.month}
                    fill={savingsColor(row.savings_rate)}
                  />
                ))}
              </Bar>
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
              <Tooltip formatter={(value: number | string) => money(value)} />
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
              <Tooltip formatter={(value: number | string) => money(value)} />
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
            <Tooltip formatter={(value: number | string) => money(value)} />
            <Legend />
            <Bar yAxisId="flow" dataKey="total_income" name={t("收入", "Income")} fill={INFLOW} />
            <Bar yAxisId="flow" dataKey="total_expense" name={t("支出", "Expense")} fill={OUTFLOW} />
            <Line yAxisId="asset" type="monotone" dataKey="cash" name={t("现金", "Cash")} stroke={GOLD} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="principal" name={t("理财本金", "Investment principal")} stroke={BLUE} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="market_net_assets" name={t("市场净资产", "Market net assets")} stroke={PURPLE} strokeWidth={2.5} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="cost_assets" name={t("资金投入资产", "Cost assets")} stroke={BLUE} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartPanel>
    </>
  );
}

function MonthlyAnalysis({
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
        message: error instanceof Error ? error.message : String(error)
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
              <Tooltip formatter={(value: number | string) => money(value)} />
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
  return (
    <ChartPanel title={title}>
      {data.length ? (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={88}>
              {data.map((item, index) => (
                <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number | string) => money(value)} />
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
          <table>
            <thead>
              <tr><th scope="col">{t("商品", "Item")}</th><th scope="col">{t("金额", "Amount")}</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.product}-${index}`}>
                  <td>{row.product || t("未填写商品", "Item not specified")}</td>
                  <td>{money(row.amount)}</td>
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
          <table>
            <thead>
              <tr>
                <th scope="col">{t("分类", "Category")}</th>
                <th scope="col">{t("金额", "Amount")}</th>
                <th scope="col">{t("异常情况", "Anomaly")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td>{money(row.amount)}</td>
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
