import type { MonthSection, MonthWorkspace } from "../types/month";
import { t } from "../i18n";

export type MonthWorkflowStatus =
  | "not-started"
  | "imported"
  | "to-organize"
  | "to-supplement-assets"
  | "to-reconcile"
  | "completed";

export interface MonthWorkflowSummary {
  status: MonthWorkflowStatus;
  label: string;
  description: string;
  nextAction: string;
  nextSection?: MonthSection;
  issueCount: number;
  blockingIssueCount: number;
  dirtySectionLabels: string[];
}

function sectionLabel(section: MonthSection): string {
  switch (section) {
    case "assets": return t("资产账户", "Asset accounts");
    case "transactions": return t("流水", "Transactions");
    case "debts": return t("借款", "Debts");
    case "fixed_assets": return t("固定资产", "Fixed assets");
  }
}

function issueIsBlocking(issue: Record<string, unknown>): boolean {
  return issue.blocking === true || issue.severity === "错误";
}

function statusCopy(status: MonthWorkflowStatus): Pick<MonthWorkflowSummary, "label" | "description" | "nextAction"> {
  switch (status) {
    case "not-started":
      return {
        label: t("尚未开始", "Not started"),
        description: t("先创建本月流水，通常从导入账单开始。", "Start this month by adding transactions, usually by importing a statement."),
        nextAction: t("导入账单", "Import statement")
      };
    case "imported":
      return {
        label: t("已导入，待整理", "Imported, ready to organize"),
        description: t("流水已经进入当前月草稿，下一步是检查类型、分类和异常。", "Transactions are in the current-month draft. Check types, categories, and issues next."),
        nextAction: t("整理流水", "Organize transactions")
      };
    case "to-organize":
      return {
        label: t("待整理", "Needs organizing"),
        description: t("有流水需要检查或修正；处理完成后再保存当前草稿。", "Some transactions need review or correction before saving the draft."),
        nextAction: t("处理流水问题", "Review transaction issues")
      };
    case "to-supplement-assets":
      return {
        label: t("待补资产", "Needs asset details"),
        description: t("流水已整理，但还缺少可用于本月验证的资产或上月快照信息。", "Transactions are organized, but asset details or a prior-month snapshot are needed for verification."),
        nextAction: t("补充资产账户", "Complete asset accounts")
      };
    case "to-reconcile":
      return {
        label: t("待对账", "Needs reconciliation"),
        description: t("当前流水和资产信息已足够计算，但对账差额仍超过容差。", "The data is sufficient to calculate reconciliation, but the difference is still above tolerance."),
        nextAction: t("检查对账流水", "Review reconciliation")
      };
    case "completed":
      return {
        label: t("已完成", "Completed"),
        description: t("当前月份已保存，流水、资产和对账结果没有待处理问题。", "This month is saved and has no outstanding transaction, asset, or reconciliation issue."),
        nextAction: t("查看月度分析", "View monthly analysis")
      };
  }
}

export function monthWorkflowSummary(
  draft: MonthWorkspace,
  issues: Array<Record<string, unknown>> = [],
  dirtySections: MonthSection[] = [],
  reconciliationTolerance = 100
): MonthWorkflowSummary {
  const blockingIssueCount = issues.filter(issueIsBlocking).length;
  const hasIssues = issues.length > 0;
  const reconciliation = draft.overview.reconciliation;
  const discrepancy = reconciliation?.available
    ? reconciliation.discrepancy
    : null;
  let status: MonthWorkflowStatus;
  if (draft.transactions.length === 0) {
    status = "not-started";
  } else if (hasIssues || dirtySections.includes("transactions")) {
    status = "to-organize";
  } else if (!reconciliation?.available || reconciliation.theoretical.previous_cash === null) {
    status = "to-supplement-assets";
  } else if (discrepancy !== null && Math.abs(discrepancy) > reconciliationTolerance) {
    status = "to-reconcile";
  } else if (draft.status === "draft" || dirtySections.length > 0) {
    status = "imported";
  } else {
    status = "completed";
  }
  const copy = statusCopy(status);
  return {
    status,
    ...copy,
    nextSection: status === "to-supplement-assets"
      ? "assets"
      : status === "completed"
        ? undefined
        : "transactions",
    issueCount: issues.length,
    blockingIssueCount,
    dirtySectionLabels: dirtySections.map(sectionLabel)
  };
}
