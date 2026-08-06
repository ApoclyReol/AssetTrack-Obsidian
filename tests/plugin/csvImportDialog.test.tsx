// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  CsvInspection
} from "../../src/types/csv";
import { CsvImportDialog } from "../../src/ui/CsvImportDialog";
import { setTestLanguage } from "../mocks/obsidian";

const inspection: CsvInspection = {
  month: "2026-07",
  filename: "账单.csv",
  headers: ["日期", "商品", "金额", "类型"],
  header_signature: "signature",
  row_count: 1,
  sample_rows: [],
  distinct_values: { 类型: ["支出"] },
  empty_values: { 日期: false, 商品: false, 金额: false, 类型: false },
  suggested_mapping: {
    date_column: "日期",
    product_column: "商品",
    amount_column: "金额",
    type_column: "类型"
  }
};

describe("CSV import dialog accessibility", () => {
  it("labels the dialog, focuses it and closes with Escape", async () => {
    const onCancel = vi.fn();
    render(
      <CsvImportDialog
        hostWindow={window}
        inspection={inspection}
        onCancel={onCancel}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const dialog = screen.getByRole("dialog", { name: "导入账单" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "关闭" })
    );
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("closes from the backdrop and restores prior focus", () => {
    const triggerView = render(<button type="button">导入账单</button>);
    const trigger = screen.getByRole("button", { name: "导入账单" });
    trigger.focus();
    const onCancel = vi.fn();
    const view = render(
      <CsvImportDialog
        hostWindow={window}
        inspection={inspection}
        onCancel={onCancel}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const backdrop = view.container.querySelector(".asset-track-modal-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as Element);
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    triggerView.unmount();
  });

  it("renders English when the app language is English", () => {
    setTestLanguage("en-US");
    const view = render(
      <CsvImportDialog
        hostWindow={window}
        inspection={inspection}
        onCancel={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByRole("dialog", { name: "Import statement" }))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    view.unmount();
    setTestLanguage("zh-CN");
  });

  it("allows an empty status by default for a new mapping", () => {
    const statusInspection: CsvInspection = {
      ...inspection,
      headers: ["日期", "商品", "金额", "类型", "状态"],
      distinct_values: { 类型: ["支出"], 状态: ["成功"] },
      empty_values: {
        日期: false,
        商品: false,
        金额: false,
        类型: false,
        状态: true
      },
      suggested_mapping: {
        ...inspection.suggested_mapping,
        status_column: "状态"
      }
    };
    render(
      <CsvImportDialog
        hostWindow={window}
        inspection={statusInspection}
        onCancel={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByRole("checkbox", { name: "（空状态）" }))
      .toHaveProperty("checked", true);
  });
});
