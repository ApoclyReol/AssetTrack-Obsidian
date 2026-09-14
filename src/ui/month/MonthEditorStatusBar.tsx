import { useState } from "react";
import type {
  MonthSection
} from "../../types/month";
import { t } from "../../i18n";
import {
  issueIsBlocking,
  type OperationState
} from "../editorPrimitives";
import type { CsvImportFeedback } from "./useCsvImportSession";
import type { MonthWorkflowSummary } from "../monthWorkflow";

interface MonthEditorStatusBarProps {
  state: OperationState;
  workflow: MonthWorkflowSummary;
  issues: Array<Record<string, unknown>>;
  feedback: CsvImportFeedback | null;
  lastSavedAt?: string;
  activeSection?: MonthSection;
  onNextStep: () => Promise<void>;
  onRetryImport: () => void;
  onSaveImport: () => Promise<boolean>;
  onDismissImport: () => void;
  onViewTransactions?: () => void;
}

type StatusTone = "pending" | "error" | "warning" | "success";

function issueSummary(
  issues: Array<Record<string, unknown>>,
  blockingCount: number
): string | null {
  if (issues.length === 0) return null;
  return blockingCount > 0
    ? t(
      `待整理：还有 ${issues.length} 项待处理，其中 ${blockingCount} 项会阻止保存。请根据行号旁的标记检查。`,
      `Needs organizing: ${issues.length} items remain; ${blockingCount} block saving. Check the markers beside the row numbers.`
    )
    : t(
      `待整理：还有 ${issues.length} 项提醒，不会阻止保存。请根据行号旁的标记按需检查。`,
      `Needs organizing: ${issues.length} warnings remain. They do not block saving; review the row markers as needed.`
    );
}

function draftStatus(
  state: OperationState,
  issueCount: number,
  blockingCount: number,
  feedback: CsvImportFeedback | null
): { label: string; tone: StatusTone } {
  if (state.kind === "pending") {
    return { label: t("处理中", "In progress"), tone: "pending" };
  }
  if (state.kind === "error" || feedback?.kind === "error" || blockingCount > 0) {
    return { label: t("草稿有错误", "Draft has errors"), tone: "error" };
  }
  if (feedback?.kind === "warning" || issueCount > 0) {
    return { label: t("草稿有提醒", "Draft has reminders"), tone: "warning" };
  }
  return { label: t("草稿正常", "Draft is clear"), tone: "success" };
}

function importMessage(feedback: CsvImportFeedback): string {
  return feedback.message;
}

export function MonthEditorStatusBar({
  state,
  workflow,
  issues,
  feedback,
  lastSavedAt,
  activeSection,
  onNextStep,
  onRetryImport,
  onSaveImport,
  onDismissImport,
  onViewTransactions
}: MonthEditorStatusBarProps) {
  const [saving, setSaving] = useState(false);
  const blockingCount = issues.filter(issueIsBlocking).length;
  const status = draftStatus(state, issues.length, blockingCount, feedback);
  const issuesMessage = issueSummary(issues, blockingCount);
  const hasFeedback = feedback !== null;
  const isSuccessFeedback = feedback?.kind === "success";
  const headline = feedback
    ? importMessage(feedback)
    : state.kind === "pending" || state.kind === "error"
      ? state.message
      : issuesMessage ?? (state.kind === "success"
        ? state.message
        : t(`${workflow.label}：${workflow.description}`, `${workflow.label}: ${workflow.description}`));
  const showNextStep = !hasFeedback
    && state.kind === "idle"
    && workflow.nextAction.length > 0;
  const showViewTransactions = state.kind === "success"
    && activeSection !== "transactions"
    && onViewTransactions !== undefined;

  const saveImport = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSaveImport();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={`asset-track-month-status is-${status.tone}`}
      aria-label={t("本月状态", "Monthly status")}
      role={status.tone === "error" ? "alert" : "status"}
      aria-live={status.tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className={`asset-track-month-status-state is-${status.tone}`}>
        {status.label}
      </span>
      <div className="asset-track-month-status-content">
        <strong>{headline}</strong>
        {feedback?.kind !== "success" && state.kind !== "pending" && state.kind !== "error"
          && !issuesMessage && workflow.dirtySectionLabels.length > 0 && (
            <small>
              {t(
                `未保存范围：${workflow.dirtySectionLabels.join("、")}。检查无误后保存。`,
                `Unsaved areas: ${workflow.dirtySectionLabels.join(", ")}. Save after checking.`
              )}
            </small>
          )}
        {lastSavedAt && !feedback && state.kind !== "pending" && (
          <small>{t(`最近保存：${lastSavedAt}`, `Last saved: ${lastSavedAt}`)}</small>
        )}
      </div>
      <div className="asset-track-month-status-actions">
        {isSuccessFeedback && (
          <button
            type="button"
            className="mod-cta"
            disabled={saving}
            onClick={() => void saveImport()}
          >
            {saving ? t("正在保存…", "Saving…") : t("检查并保存流水", "Check and save transactions")}
          </button>
        )}
        {feedback && !isSuccessFeedback && feedback.canRetry !== false && (
          <button type="button" onClick={onRetryImport}>
            {t("重新选择文件", "Choose another file")}
          </button>
        )}
        {showNextStep && (
          <button type="button" onClick={() => void onNextStep()}>
            {workflow.nextAction}
          </button>
        )}
        {showViewTransactions && (
          <button type="button" onClick={onViewTransactions}>
            {t("查看变更流水", "View changed transactions")}
          </button>
        )}
        {feedback && (
          <button type="button" disabled={saving} onClick={onDismissImport}>
            {t("知道了", "Dismiss")}
          </button>
        )}
      </div>
    </section>
  );
}
