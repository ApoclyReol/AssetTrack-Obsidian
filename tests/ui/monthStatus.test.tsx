// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { OperationState } from "../../src/ui/editorPrimitives";
import { MonthEditorStatusBar } from "../../src/ui/month/MonthEditorStatusBar";
import type { MonthWorkflowSummary } from "../../src/ui/monthWorkflow";

afterEach(cleanup);

const workflow: MonthWorkflowSummary = {
  status: "to-organize",
  label: "待整理",
  description: "有流水需要检查或修正；处理完成后再保存当前草稿。",
  nextAction: "处理流水问题",
  nextSection: "transactions",
  issueCount: 2,
  blockingIssueCount: 1,
  dirtySectionLabels: ["流水"]
};

const idleState: OperationState = { kind: "idle" };

function renderStatus(overrides: Partial<ComponentProps<typeof MonthEditorStatusBar>> = {}) {
  return render(
    <MonthEditorStatusBar
      state={idleState}
      workflow={workflow}
      issues={[
        { row_index: 0, field: "金额", issue: "金额无效", severity: "错误", blocking: true },
        { row_index: 1, field: "分类", issue: "分类为空", severity: "警告", blocking: false }
      ]}
      feedback={null}
      onNextStep={vi.fn(async () => undefined)}
      onRetryImport={vi.fn()}
      onSaveImport={vi.fn(async () => true)}
      onDismissImport={vi.fn()}
      {...overrides}
    />
  );
}

describe("month status bar", () => {
  it("combines draft status and issue counts into one concise message", () => {
    renderStatus();

    expect(screen.getByText("草稿有错误")).toBeDefined();
    expect(screen.getByText(
      "待整理：还有 2 项待处理，其中 1 项会阻止保存。请根据行号旁的标记检查。"
    )).toBeDefined();
    expect(document.querySelector(".asset-track-import-feedback")).toBeNull();
    expect(document.querySelector(".asset-track-operation-status")).toBeNull();
  });

  it("keeps the temporary import action in the same status bar", async () => {
    const onSaveImport = vi.fn(async () => true);
    const onDismissImport = vi.fn();
    renderStatus({
      issues: [],
      feedback: {
        kind: "success",
        message: "已把 3 条接受流水加入本月草稿；请检查行号提示，然后保存流水。"
      },
      onSaveImport,
      onDismissImport
    });

    const status = document.querySelector(".asset-track-month-status");
    expect(status).toBeDefined();
    expect(document.querySelectorAll(".asset-track-month-status")).toHaveLength(1);
    expect(screen.getByText(/已把 3 条接受流水加入本月草稿/)).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "检查并保存流水" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onSaveImport).toHaveBeenCalledOnce();
    expect(onDismissImport).toHaveBeenCalledOnce();
  });

  it("does not suggest reimporting after a mapping-only failure", () => {
    renderStatus({
      issues: [],
      feedback: {
        kind: "warning",
        message: "流水已加入，但映射未保存。",
        canRetry: false
      }
    });

    expect(screen.getByText("流水已加入，但映射未保存。")).toBeDefined();
    expect(screen.queryByRole("button", { name: "重新选择文件" })).toBeNull();
    expect(screen.getByRole("button", { name: "知道了" })).toBeDefined();
  });
});
