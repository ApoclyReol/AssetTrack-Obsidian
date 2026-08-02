import { type ReactNode } from "react";
import { Rectangle, type BarShapeProps } from "recharts";
import { INFLOW_COLOR, OUTFLOW_COLOR, savingsColor } from "./analysisModel";
import { getLocale } from "../i18n";
import { money } from "../domain/moneyFormat";

export const INFLOW = INFLOW_COLOR;
export const OUTFLOW = OUTFLOW_COLOR;
export const GOLD = "var(--asset-track-cash)";
export const BLUE = "var(--asset-track-investment)";
export const PURPLE = "var(--asset-track-total-assets)";
export const PIE_COLORS = [
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

export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

export function percent(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : "—";
}
export function tooltipMoney(value: unknown): string {
  return money(value);
}

export function tooltipPercent(value: unknown): string {
  return percent(value);
}

export function SavingsBarShape(props: BarShapeProps) {
  const value = Array.isArray(props.value) ? Number(props.value[1]) : Number(props.value);
  return (
    <Rectangle
      {...props}
      fill={savingsColor(Number.isFinite(value) ? value : null)}
    />
  );
}

export function signed(value: unknown, formatter: (input: unknown) => string): string {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${parsed > 0 ? "+" : ""}${formatter(parsed)}`;
}

export function axis(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  if (Math.abs(parsed) >= 10_000 && getLocale() === "zh-CN") return `${(parsed / 10_000).toFixed(1)}万`;
  return String(Math.round(parsed));
}

export function Cards({
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

export function ChartPanel({
  title,
  children,
  className = ""
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`asset-track-analysis-panel ${className}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="asset-track-analysis-empty">{text}</div>;
}

interface ComparisonTickProps {
  x?: number;
  y?: number;
  payload?: { value?: string };
  rows: Array<{ category: string; delta: number }>;
}

export function ComparisonCategoryTick({
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

export function ComparisonBarLabel({
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
