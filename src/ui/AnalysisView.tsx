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
  AnnualRow,
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

const INFLOW = INFLOW_COLOR;
const OUTFLOW = OUTFLOW_COLOR;
const GOLD = "#E0A106";
const BLUE = "#2F80ED";
const PURPLE = "#8E63CE";
const PIE_COLORS = [
  "#635BFF", "#2CA58D", "#D94F45", "#E0A106", "#2F80ED",
  "#8E63CE", "#E76F51", "#43AA8B", "#577590", "#F4A261"
];

type LoadState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

function money(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: "CNY",
        maximumFractionDigits: 1
      }).format(parsed)
    : "—";
}

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
  if (Math.abs(parsed) >= 10_000) return `${(parsed / 10_000).toFixed(1)}万`;
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
  prefix: "上月" | "本月";
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
  dataVersion
}: {
  api: AssetTrackService;
  months: string[];
  month: string;
  onMonthChange: (month: string) => void;
  initialMode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  dataVersion: number;
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
            {{ home: "Home", annual: "年度", monthly: "月度" }[item]}
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
        <MonthlyAnalysis api={api} month={month} dataVersion={dataVersion} />
      )}
      {mode === "monthly" && !month && <Empty text="尚无可分析月份。" />}
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
  if (state.kind === "loading") return <Empty text="正在加载资产首页…" />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const { current, month } = state.data;
  const metrics = month?.overview.metrics;
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div><h2>资产首页</h2><span>最近月份：{current.month ?? "—"}</span></div>
      </div>
      <Cards items={[
        { label: "现金", value: money(current.cash) },
        { label: "理财本金", value: money(current.principal) },
        { label: "借款", value: money(current.debt) },
        { label: "总资产", value: money(current.total_assets) }
      ]} />
      {metrics && (
        <Cards items={[
          { label: "最近月收入", value: money(metrics.total_income), tone: "inflow" },
          { label: "最近月净支出", value: money(metrics.total_expense), tone: "outflow" },
          {
            label: "最近月储蓄",
            value: money(metrics.surplus),
            tone: metrics.surplus >= 0 ? "inflow" : "outflow"
          },
          {
            label: "最近月储蓄率",
            value: metrics.savings_rate === null
              ? "不可计算"
              : percent(metrics.savings_rate)
          },
          {
            label: "资产环比",
            value: metrics.asset_delta === null ? "不可比较" : money(metrics.asset_delta),
            tone: changeTone(metrics.asset_delta)
          }
        ]} />
      )}
      <ChartPanel title="固定资产摘要">
        {current.fixed_assets.length ? (
          <div className="asset-track-table-scroll">
            <table>
              <thead><tr><th>名称</th><th>类别</th><th>状态</th><th>购买价格</th></tr></thead>
              <tbody>
                {current.fixed_assets.map((row) => (
                  <tr key={row.asset_key ?? row.id}>
                    <td>{row.asset_name}</td>
                    <td>{row.category}</td>
                    <td>{row.status}</td>
                    <td>{money(row.purchase_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="当前没有在用或闲置的固定资产。" />}
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
  if (state.kind === "loading") return <Empty text={`正在加载 ${year} 年度分析…`} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const data = state.data;
  if (!data.rows.length) return <Empty text={`${year} 暂无数据。`} />;
  const latest = data.latest;
  const monthlySavings = data.rolling_rows.filter(
    (row) => row.savings_rate !== null
  );
  const history = sampleAnnualRows(data.all_trend_rows);
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div><h2>{year} 年度总览</h2><span>自然年汇总与近 12 月滚动观察</span></div>
      </div>
      <Cards items={[
        { label: "年度收入", value: money(data.metrics.total_income), tone: "inflow" },
        { label: "年度净支出", value: money(data.metrics.total_expense), tone: "outflow" },
        {
          label: "年度储蓄",
          value: money(data.metrics.savings),
          tone: data.metrics.savings >= 0 ? "inflow" : "outflow"
        },
        {
          label: "年度储蓄率",
          value: data.metrics.savings_rate === null
            ? "不可计算"
            : percent(data.metrics.savings_rate)
        }
      ]} />
      <Cards items={[
        { label: "年末现金", value: money(latest?.cash) },
        { label: "年末理财本金", value: money(latest?.principal) },
        { label: "年末借款", value: money(latest?.debt) },
        { label: "年末总资产", value: money(latest?.total_assets) }
      ]} />
      <ChartPanel title="近 12 个月综合趋势" className="is-wide">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={data.rolling_rows}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="month" />
            <YAxis yAxisId="flow" tickFormatter={axis} />
            <YAxis yAxisId="asset" orientation="right" tickFormatter={axis} />
            <Tooltip formatter={(value: number | string) => money(value)} />
            <Legend />
            <Bar yAxisId="flow" dataKey="total_income" name="收入" fill={INFLOW} />
            <Bar yAxisId="flow" dataKey="total_expense" name="支出" fill={OUTFLOW} />
            <Line yAxisId="asset" type="monotone" dataKey="cash" name="现金" stroke={GOLD} strokeWidth={2} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="principal" name="理财本金" stroke={BLUE} strokeWidth={2} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="total_assets" name="总资产" stroke={PURPLE} strokeWidth={3} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartPanel>
      <ChartPanel title="近 12 月逐月储蓄率" className="is-wide">
        {monthlySavings.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlySavings}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
              <Tooltip formatter={(value: number | string) => percent(value)} />
              <ReferenceLine y={0} stroke="#8A8A8A" />
              <Bar dataKey="savings_rate" name="单月储蓄率">
                {monthlySavings.map((row) => (
                  <Cell
                    key={row.month}
                    fill={savingsColor(row.savings_rate)}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        ) : <Empty text="近 12 月没有收入大于零的月份。" />}
      </ChartPanel>
      <div className="asset-track-analysis-grid">
        <ChartPanel title="年度分类成本">
          <ResponsiveContainer width="100%" height={Math.max(280, data.cost_audit.categories.length * 32)}>
            <ComposedChart layout="vertical" data={[...data.cost_audit.categories].reverse()}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis type="number" tickFormatter={axis} />
              <YAxis type="category" dataKey="category" width={80} />
              <Tooltip formatter={(value: number | string) => money(value)} />
              <Bar dataKey="total" name="年度金额" fill={PURPLE} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="消费频率">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data.cost_audit.patterns}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="pattern" />
              <YAxis tickFormatter={axis} />
              <Tooltip formatter={(value: number | string) => money(value)} />
              <Bar dataKey="total" name="年度金额" fill={GOLD} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
      <Cards items={[
        { label: "必要支出", value: money(data.cost_audit.necessary_total) },
        { label: "可控支出", value: money(data.cost_audit.controlled_total) },
        { label: "可控占比", value: percent(data.cost_audit.controlled_percent) },
        {
          label: "总资产支撑月",
          value: data.cost_audit.asset_support_months === null
            ? "不可计算"
            : `${data.cost_audit.asset_support_months.toFixed(1)} 个月`
        }
      ]} />
      <ChartPanel title="全历史趋势" className="is-wide">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={history}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="month" />
            <YAxis yAxisId="flow" tickFormatter={axis} />
            <YAxis yAxisId="asset" orientation="right" tickFormatter={axis} />
            <Tooltip formatter={(value: number | string) => money(value)} />
            <Legend />
            <Bar yAxisId="flow" dataKey="total_income" name="收入" fill={INFLOW} />
            <Bar yAxisId="flow" dataKey="total_expense" name="支出" fill={OUTFLOW} />
            <Line yAxisId="asset" type="monotone" dataKey="cash" name="现金" stroke={GOLD} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="principal" name="理财本金" stroke={BLUE} dot={false} />
            <Line yAxisId="asset" type="monotone" dataKey="total_assets" name="总资产" stroke={PURPLE} strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartPanel>
    </>
  );
}

function MonthlyAnalysis({
  api,
  month,
  dataVersion
}: {
  api: AssetTrackService;
  month: string;
  dataVersion: number;
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
  if (state.kind === "loading") return <Empty text={`正在加载 ${month} 月度分析…`} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const overview = state.data.overview;
  if (!overview.available || !overview.metrics) return <Empty text={`${month} 暂无可分析数据。`} />;
  const structure = overview.structure;
  const necessity = structure
    ? [
        { name: "必要", value: structure.necessary },
        { name: "可控", value: structure.controlled }
      ].filter((item) => item.value > 0)
    : [];
  const pattern = structure
    ? [
        { name: "周期", value: structure.periodic },
        { name: "日常", value: structure.daily },
        { name: "偶尔", value: structure.occasional }
      ].filter((item) => item.value > 0)
    : [];
  const categories = overview.category_summary ?? [];
  const comparison = overview.category_comparison;
  const comparisonRows = comparison?.rows ?? [];
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div><h2>{month} 月度分析</h2><span>固定资产不参与资产、对账和消费计算</span></div>
      </div>
      <Cards items={[
        { label: "收入", value: money(overview.metrics.total_income), tone: "inflow" },
        { label: "净支出", value: money(overview.metrics.total_expense), tone: "outflow" },
        {
          label: "储蓄",
          value: money(overview.metrics.surplus),
          tone: overview.metrics.surplus >= 0 ? "inflow" : "outflow"
        },
        { label: "总资产", value: money(overview.metrics.total_assets) },
        {
          label: "资产环比",
          value: overview.metrics.asset_delta === null
            ? "不可比较"
            : money(overview.metrics.asset_delta),
          tone: changeTone(overview.metrics.asset_delta)
        },
        {
          label: "对账差额",
          value: overview.reconciliation?.available
            ? money(overview.reconciliation.discrepancy)
            : "不可比较",
          tone: overview.reconciliation?.available
            ? changeTone(overview.reconciliation.discrepancy)
            : undefined,
          suffix: overview.reconciliation?.available
            ? reconciliationStatus(overview.reconciliation.discrepancy)
            : undefined
        }
      ]} />
      <div className="asset-track-analysis-grid">
        <ChartPanel title="现金账户">
          <div className="asset-track-analysis-list">
            {(overview.cash_accounts ?? []).map((row) => (
              <div key={row.account}><span>{row.account}</span><strong>{money(row.balance)}</strong></div>
            ))}
            <div><span>现金合计</span><strong>{money(overview.cash_total)}</strong></div>
          </div>
        </ChartPanel>
        <ChartPanel title="理财状态">
          <div className="asset-track-analysis-list">
            <div><span>本金</span><strong>{money(overview.investment?.principal)}</strong></div>
            <div><span>市值</span><strong>{money(overview.investment?.market_value)}</strong></div>
            <div><span>流动现金</span><strong>{money(overview.investment?.cash_balance)}</strong></div>
            <div><span>收益率</span><strong>{percent(overview.investment?.roi_percent)}</strong></div>
            <div>
              <span>对比上月</span>
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
                  : "不可比较"}
              </strong>
            </div>
          </div>
        </ChartPanel>
      </div>
      <div className="asset-track-analysis-grid is-three">
        <PiePanel title="必要 / 可控" data={necessity} />
        <PiePanel title="周期 / 日常 / 偶尔" data={pattern} />
        <PiePanel
          title="具体分类"
          data={categories.map((row) => ({ name: row.category, value: row.amount }))}
        />
      </div>
      <ChartPanel title={`分类与上月对比${comparison?.previous_month ? `（${comparison.previous_month}）` : ""}`}>
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
                name="上月"
                fill="#A8A8B3"
                label={
                  <ComparisonBarLabel
                    prefix="上月"
                    color="var(--text-muted)"
                  />
                }
              />
              <Bar
                dataKey="current"
                name="本月"
                fill={PURPLE}
                label={
                  <ComparisonBarLabel
                    prefix="本月"
                    color="var(--text-normal)"
                  />
                }
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <Empty text="严格上一个自然月没有可比较数据。" />}
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
      ) : <Empty text="暂无数据。" />}
    </ChartPanel>
  );
}

function BigTicketPanel({
  rows
}: {
  rows: Array<{ product: string; category: string; amount: number }>;
}) {
  return (
    <ChartPanel title="大额支出" className="asset-track-big-ticket-panel">
      {rows.length ? (
        <div className="asset-track-table-scroll">
          <table>
            <thead>
              <tr><th scope="col">商品</th><th scope="col">金额</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.product}-${index}`}>
                  <td>{row.product || "未填写商品"}</td>
                  <td>{money(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty text="暂无记录。" />}
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
    <ChartPanel title="异常与变化" className="asset-track-anomaly-panel">
      {rows.length ? (
        <div className="asset-track-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">分类</th>
                <th scope="col">金额</th>
                <th scope="col">异常情况</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td>{money(row.amount)}</td>
                  <td>{row.situation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty text="暂无达到阈值的异常变化。" />}
    </ChartPanel>
  );
}
