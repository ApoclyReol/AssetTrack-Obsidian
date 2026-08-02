import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps
} from "recharts";
import { ANALYSIS_MODES, type AnalysisMode } from "../constants";
import type {
  AnnualOverview,
  CurrentAsset,
  HistoricalProductStat,
  MonthWorkspace,
  ProductHistoryIndexResult,
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
import { StaticTableHeader } from "./TablePrimitives";

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

function tooltipMoney(value: unknown): string {
  return money(value);
}

function tooltipPercent(value: unknown): string {
  return percent(value);
}

function SavingsBarShape(props: BarShapeProps) {
  const value = Array.isArray(props.value) ? Number(props.value[1]) : Number(props.value);
  return (
    <Rectangle
      {...props}
      fill={savingsColor(Number.isFinite(value) ? value : null)}
    />
  );
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
            {{ home: "Home", annual: t("年度", "Annual"), monthly: t("月度", "Monthly"), products: t("商品总览", "Items") }[item]}
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
      {mode === "products" && <ProductOverviewAnalysis api={api} dataVersion={dataVersion} />}
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
        message: displayError(error)
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
            <table className="asset-track-analysis-fixed-assets-table">
              <thead><tr><StaticTableHeader label={t("名称", "Name")} /><StaticTableHeader label={t("类别", "Category")} /><StaticTableHeader label={t("状态", "Status")} className="asset-track-status-column" /><StaticTableHeader label={t("购买价格", "Purchase price")} className="asset-track-amount-column" /></tr></thead>
              <tbody>
                {current.fixed_assets.map((row) => (
                  <tr key={row.asset_key ?? row.id}>
                    <td>{row.asset_name}</td>
                    <td>{row.category}</td>
                    <td className="asset-track-status-cell">{businessLabel(row.status)}</td>
                    <td className="asset-track-amount-cell">{money(row.purchase_price)}</td>
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

type ProductOverviewSortKey =
  | "product"
  | "transaction_type"
  | "category"
  | "counterparty_count"
  | "occurrences"
  | "months_count"
  | "total_amount"
  | "average_amount"
  | "last_date";

type ProductOverviewSort = {
  key: ProductOverviewSortKey;
  direction: "asc" | "desc";
};

function productCategoryStatusLabel(
  value: HistoricalProductStat["category_status"]
): string {
  return {
    正常: t("正常", "Normal"),
    停用: t("停用", "Inactive"),
    未分类: t("未分类", "Uncategorized"),
    混合: t("混合", "Mixed")
  }[value];
}

function productCategorySummary(group: HistoricalProductStat): string {
  return group.category_counts.map((category) =>
    `${category.category || t("未分类", "Uncategorized")} (${category.occurrences})`
  ).join("、") || t("无历史分类", "No historical category");
}

function productOverviewSortValue(
  group: HistoricalProductStat,
  key: ProductOverviewSortKey
): string | number {
  switch (key) {
    case "category": return productCategorySummary(group);
    case "product": return group.product || t("（空商品）", "(empty item)");
    case "transaction_type": return group.transaction_type;
    case "counterparty_count": return group.counterparty_count;
    case "occurrences": return group.occurrences;
    case "months_count": return group.months_count;
    case "total_amount": return group.total_amount;
    case "average_amount": return group.average_amount;
    case "last_date": return group.last_date;
  }
}

function ProductOverviewSortButton({
  field,
  label,
  sort,
  onSort
}: {
  field: ProductOverviewSortKey;
  label: string;
  sort: ProductOverviewSort;
  onSort: (next: ProductOverviewSort) => void;
}) {
  const active = sort.key === field;
  const mark = active ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
  return <button
    type="button"
    className="asset-track-sort"
    aria-label={t(`${label}排序`, `Sort by ${label}`)}
    aria-pressed={active}
    onClick={() => onSort({
      key: field,
      direction: active && sort.direction === "asc" ? "desc" : "asc"
    })}
  >{label}{mark}</button>;
}

function ProductOverviewAnalysis({
  api,
  dataVersion
}: {
  api: AssetTrackService;
  dataVersion: number;
}) {
  const [state, setState] = useState<LoadState<ProductHistoryIndexResult>>({ kind: "loading" });
  const [transactionType, setTransactionType] = useState<"" | "支出" | "收入">("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProductOverviewSort>({
    key: "total_amount",
    direction: "desc"
  });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void api.productOverview()
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((error) => active && setState({
        kind: "error",
        message: displayError(error)
      }));
    return () => { active = false; };
  }, [api, dataVersion]);

  const groups = state.kind === "ready" ? state.data.groups : [];
  const visibleGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(getLocale());
    return groups.filter((group) => {
      if (transactionType && group.transaction_type !== transactionType) return false;
      if (!normalizedSearch) return true;
      return [group.product, group.counterparty, ...group.variants]
        .join(" ")
        .toLocaleLowerCase(getLocale())
        .includes(normalizedSearch);
    });
  }, [groups, search, transactionType]);
  const sortedGroups = useMemo(() => [...visibleGroups].sort((left, right) => {
    const leftValue = productOverviewSortValue(left, sort.key);
    const rightValue = productOverviewSortValue(right, sort.key);
    const compared = typeof leftValue === "number" || typeof rightValue === "number"
      ? Number(leftValue) - Number(rightValue)
      : String(leftValue).localeCompare(String(rightValue), getLocale(), {
          numeric: true,
          sensitivity: "base"
        });
    return sort.direction === "asc" ? compared : -compared;
  }), [sort, visibleGroups]);

  if (state.kind === "loading") return <Empty text={t("正在加载商品总览…", "Loading item overview…")} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div>
          <h2>{t("商品总览", "Item overview")}</h2>
          <span>{t("集中查看历史商品的分类、流水和金额统计", "Review historical item categories, transactions, and amounts in one place")}</span>
        </div>
      </div>
      <div className="asset-track-analysis-toolbar">
        <label className="asset-track-analysis-filter">
          <span>{t("收支", "Type")}</span>
          <select value={transactionType} onChange={(event) => setTransactionType(event.target.value as "" | "支出" | "收入")}>
            <option value="">{t("全部", "All")}</option>
            <option value="支出">{businessLabel("支出")}</option>
            <option value="收入">{businessLabel("收入")}</option>
          </select>
        </label>
        <label className="asset-track-analysis-filter asset-track-analysis-search">
          <span>{t("商品搜索", "Item search")}</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <span className="asset-track-analysis-filter-status" role="status">
          {t(`显示 ${visibleGroups.length} / ${groups.length} 个商品`, `${visibleGroups.length} of ${groups.length} items`)}
        </span>
      </div>
      {sortedGroups.length === 0 ? <Empty text={groups.length ? t("没有符合当前筛选条件的商品。", "No items match the current filters.") : t("暂无历史商品。", "No historical items are available.")} /> : (
        <div className="asset-track-table-scroll asset-track-analysis-product-overview-scroll">
          <table className="asset-track-analysis-product-overview-table">
            <thead><tr>
              <th scope="col"><ProductOverviewSortButton field="product" label={t("商品", "Item")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-type-column"><ProductOverviewSortButton field="transaction_type" label={t("收支", "Type")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-centered-column"><ProductOverviewSortButton field="category" label={t("所属分类", "Category")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-count-column"><ProductOverviewSortButton field="counterparty_count" label={t("交易对方数", "Counterparties")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-count-column"><ProductOverviewSortButton field="occurrences" label={t("流水数", "Transactions")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-count-column"><ProductOverviewSortButton field="months_count" label={t("月份数", "Months")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-amount-column"><ProductOverviewSortButton field="total_amount" label={t("总金额", "Total amount")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-amount-column"><ProductOverviewSortButton field="average_amount" label={t("平均单次", "Average")} sort={sort} onSort={setSort} /></th>
              <th scope="col" className="asset-track-date-column"><ProductOverviewSortButton field="last_date" label={t("最近日期", "Latest date")} sort={sort} onSort={setSort} /></th>
            </tr></thead>
            <tbody>{sortedGroups.map((group) => {
              const category = productCategorySummary(group);
              return <tr key={`${group.transaction_type}\u0000${group.product_key}`}>
                <td title={group.variants.join("、")}>{group.product || t("（空商品）", "(empty item)")}</td>
                <td className="asset-track-type-cell">{businessLabel(group.transaction_type)}</td>
                <td className="asset-track-centered-cell"><div className="asset-track-history-status-stack"><span>{category}</span><small>{productCategoryStatusLabel(group.category_status)}</small></div></td>
                <td className="asset-track-count-cell">{group.counterparty_count}</td>
                <td className="asset-track-count-cell">{group.occurrences}</td>
                <td className="asset-track-count-cell">{group.months_count}</td>
                <td className="asset-track-amount-cell">{money(group.total_amount, group.transaction_type)}</td>
                <td className="asset-track-amount-cell">{money(group.average_amount, group.transaction_type)}</td>
                <td className="asset-track-date-cell">{group.last_date || "—"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
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
        message: displayError(error)
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
            <Tooltip formatter={tooltipMoney} />
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
