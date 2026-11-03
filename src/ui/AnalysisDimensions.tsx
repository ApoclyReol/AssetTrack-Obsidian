import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { TransactionAnalysisDrilldown } from "../types/analysis";
import { t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { ChartPanel, Empty, percent, PIE_COLORS, tooltipMoney } from "./AnalysisPrimitives";

export function CategoryDimensionPanel({
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
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <ChartPanel title={title} className="asset-track-category-dimension">
      {data.length ? (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={coloredData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={76} />
            <Tooltip formatter={tooltipMoney} />
          </PieChart>
        </ResponsiveContainer>
      ) : <Empty text={t("暂无数据。", "No data.")} />}
      {data.length > 0 && <div className="asset-track-category-buttons">
        {coloredData.map((item) => <button type="button" className="asset-track-category-button" key={item.name}
          disabled={!onOpenTransactions}
          aria-label={t(`查看「${item.name}」的流水`, `View transactions in “${item.name}”`)}
          onClick={() => onOpenTransactions?.({ dimension: "category", key: item.name, label: item.name, months: item.months })}>
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill={item.fill} /></svg>
          <span className="asset-track-category-button-name">{item.name}</span>
          <strong>{money(item.value)}</strong>
          <span className="asset-track-category-button-share">{total === 0 ? "—" : percent(item.value / total * 100)}</span>
        </button>)}
      </div>}
    </ChartPanel>
  );
}

export function DimensionPanel({
  title,
  rows,
  note,
  onOpenTransactions
}: {
  title: string;
  rows: Array<{
    name: string;
    amount: number;
    count?: number;
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
        <strong>{money(row.amount)}{row.count == null ? null : <small>（{row.count}）</small>}
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

