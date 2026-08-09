import { type ReactNode } from "react";
import { scalarText } from "../domain/text";
import { businessLabel, displayError, getLocale, t } from "../i18n";
import { transactionBlockNumber } from "./analysisModel";
import type {
  Transaction
} from "../types/transactions";

export type OperationState =
  | { kind: "idle"; message?: string }
  | { kind: "pending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type SortState = { key: string; direction: "asc" | "desc" } | null;

export function issueIsBlocking(issue: Record<string, unknown>): boolean {
  return issue.blocking === true || issue.severity === "错误";
}

export const MAX_VISIBLE_ISSUES = 10;

const BLOCKING_ISSUE_FIELD_PRIORITY: Record<string, number> = {
  "日期": 10,
  "金额": 20,
  "收支": 30,
  "分类": 40,
  "商品": 50,
  "规则": 60
};

const WARNING_ISSUE_FIELD_PRIORITY: Record<string, number> = {
  "分类": 10,
  "商品": 20,
  "金额": 30,
  "日期": 40,
  "收支": 50,
  "规则": 60
};

export function orderedIssues(
  issues: Array<Record<string, unknown>>
): Array<{ issue: Record<string, unknown>; originalIndex: number }> {
  return issues
    .map((issue, originalIndex) => ({ issue, originalIndex }))
    .sort((left, right) => {
      const leftBlocking = issueIsBlocking(left.issue);
      const rightBlocking = issueIsBlocking(right.issue);
      if (leftBlocking !== rightBlocking) return leftBlocking ? -1 : 1;
      const priorities = leftBlocking
        ? BLOCKING_ISSUE_FIELD_PRIORITY
        : WARNING_ISSUE_FIELD_PRIORITY;
      const leftPriority = priorities[scalarText(left.issue.field)] ?? 100;
      const rightPriority = priorities[scalarText(right.issue.field)] ?? 100;
      return leftPriority - rightPriority || left.originalIndex - right.originalIndex;
    });
}

export function messageFor(error: unknown): string {
  return displayError(error);
}

export function number(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function transactionAmount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return "" as unknown as number;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : "" as unknown as number;
}

export function clone<T>(data: T): T {
  return structuredClone(data);
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left ?? 0) - Number(right ?? 0);
  }
  return scalarText(left).localeCompare(scalarText(right), getLocale(), {
    numeric: true,
    sensitivity: "base"
  });
}

export function sortRows<T>(
  rows: T[],
  sort: SortState,
  value: (row: T, key: string) => unknown
): Array<{ row: T; originalIndex: number }> {
  const indexed = rows.map((row, originalIndex) => ({ row, originalIndex }));
  if (!sort) return indexed;
  return indexed.sort((left, right) => {
    const compared = compareValues(
      value(left.row, sort.key),
      value(right.row, sort.key)
    );
    return sort.direction === "asc" ? compared : -compared;
  });
}

function toggleSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function SortButton({
  label,
  field,
  sort,
  onSort
}: {
  label: string;
  field: string;
  sort: SortState;
  onSort: (next: SortState) => void;
}) {
  const mark =
    sort?.key === field ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
  const active = sort?.key === field;
  return (
    <button
      type="button"
      className="asset-track-sort"
      aria-label={t(
        `${label}排序${active ? `，当前${sort.direction === "asc" ? "升序" : "降序"}` : ""}`,
        `Sort by ${label}${active ? `, currently ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}`
      )}
      aria-pressed={active}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      onClick={() => onSort(toggleSort(sort, field))}
    >
      {label}
      {mark}
    </button>
  );
}

export function IssueList({
  issues,
  rows
}: {
  issues: Array<Record<string, unknown>>;
  rows: Transaction[];
}) {
  const blocking = issues.filter(issueIsBlocking).length;
  const visibleIssues = orderedIssues(issues).slice(0, MAX_VISIBLE_ISSUES);
  const omittedCount = issues.length - visibleIssues.length;
  const omittedBlocking = blocking - visibleIssues.filter(({ issue }) => issueIsBlocking(issue)).length;
  const summary = blocking > 0
    ? omittedCount > 0
      ? t(
        `共 ${issues.length} 项问题，其中 ${blocking} 项会阻止保存；按优先级显示前 ${visibleIssues.length} 项：`,
        `${issues.length} issues found; ${blocking} block saving. Showing the first ${visibleIssues.length} by priority:`
      )
      : t(
        `以下问题中有 ${blocking} 项会阻止保存，已按优先级排序：`,
        `${blocking} of the following issues block saving, sorted by priority:`
      )
    : omittedCount > 0
      ? t(
        `共 ${issues.length} 项提醒，不会阻止保存；按优先级显示前 ${visibleIssues.length} 项：`,
        `${issues.length} warnings found; they do not block saving. Showing the first ${visibleIssues.length} by priority:`
      )
      : t(
        "以下提醒不会阻止保存，已按优先级排序：",
        "The following warnings do not block saving and are sorted by priority:"
      );
  return (
    <div className="asset-track-issues" role="alert">
      <strong>{summary}</strong>
      <ul>
        {visibleIssues.map(({ issue, originalIndex }) => {
          const globalIndex = Number(issue.row_index ?? 0);
          const type = scalarText(
            issue.type ?? rows[globalIndex]?.type ?? t("流水", "Transaction")
          );
          const blockRow = transactionBlockNumber(rows, globalIndex);
          const severity = issueIsBlocking(issue)
            ? t("错误", "Error")
            : t("警告", "Warning");
          const issueReason = scalarText(issue.issue ?? issue.reason) || "无效";
          const hasRuleConflict = Array.isArray(issue.rule_ids) && issue.rule_ids.length > 0;
          const visibleReason = hasRuleConflict
            ? t("规则存在冲突，未自动覆盖", "Rules conflict; no automatic override was applied.")
            : issueReason;
          return (
            <li key={originalIndex}>
              {t(
                `［${severity}］${businessLabel(type)}第 ${Math.max(1, blockRow)} 行／${scalarText(issue.field) || "规则"}／${visibleReason}`,
                `[${severity}] ${businessLabel(type)} row ${Math.max(1, blockRow)} / ${businessLabel(scalarText(issue.field) || "规则")} / ${displayError(visibleReason)}`
              )}
              {scalarText(issue.suggestion) && <small> · {displayError(scalarText(issue.suggestion))}</small>}
            </li>
          );
        })}
      </ul>
      {omittedCount > 0 && (
        <small className="asset-track-issues-omitted">
          {omittedBlocking > 0
            ? t(
              `其余 ${omittedCount} 项已省略，其中 ${omittedBlocking} 项会阻止保存。`,
              `${omittedCount} more issues are hidden, including ${omittedBlocking} that block saving.`
            )
            : t(
              `其余 ${omittedCount} 项已省略。`,
              `${omittedCount} more issues are hidden.`
            )}
        </small>
      )}
    </div>
  );
}

export function Section({
  title,
  children,
  sectionRef
}: {
  title?: string;
  children: ReactNode;
  sectionRef?: { current: HTMLElement | null };
}) {
  return (
    <section ref={sectionRef} className="asset-track-section">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={
          typeof value === "number" || typeof value === "string"
            ? value
            : 0
        }
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Status({ state }: { state: OperationState }) {
  if (state.kind === "idle" && !state.message) return null;
  return (
    <div
      className={`asset-track-status is-${state.kind}`}
      role={state.kind === "error" ? "alert" : "status"}
      aria-live={state.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {state.message}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="asset-track-empty" role="status">{text}</div>;
}
