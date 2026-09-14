// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CsvInspection
} from "../../src/types/csv";
import { CsvImportDialog } from "../../src/ui/CsvImportDialog";
import { setTestLanguage } from "../mocks/obsidian";

afterEach(() => setTestLanguage("zh-CN"));

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
    const dialog = screen.getAllByRole("dialog", { name: "导入账单" }).at(-1)!;
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

  it("localizes detected field labels in the English header review", () => {
    setTestLanguage("en-US");
    const view = render(
      <CsvImportDialog
        hostWindow={window}
        inspection={{
          ...inspection,
          header_status: "needs_confirmation",
          header_confirmed: false,
          header_candidates: [{
            row: 1,
            headers: inspection.headers,
            matched_fields: ["日期", "商品", "金额", "收支"],
            score: 450,
            confidence: "high"
          }],
          raw_row_count: 1,
          raw_rows: [{ row: 1, values: inspection.headers }]
        }}
        onCancel={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getAllByText(/Date, Item, Amount, Type/)).toHaveLength(2);
    expect(screen.getByText("Candidate: Date, Item, Amount, Type")).toBeTruthy();
    view.unmount();
  });

  it("allows an empty status by default for a new mapping", async () => {
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
    const dialog = screen.getAllByRole("dialog", { name: "导入账单" }).at(-1)!;
    await userEvent.click(within(dialog).getByRole("button", { name: "下一步：确认映射" }));
    expect(screen.getByRole("checkbox", { name: "（空状态）" }))
      .toHaveProperty("checked", true);
    expect(within(dialog).getByText(
      "分类是可选字段；如需导入分类，请先在系统配置中设置。文件中无法匹配的分类会重置为“未分类”。"
    )).toBeTruthy();
  });

  it("returns one page at a time from mapping and preview", async () => {
    const preview = {
      month: "2026-07",
      rows: [],
      issues: [],
      type_summary: { 支出: 1 },
      modes: ["append", "replace"] as const,
      import_stats: {
        source_rows: 1,
        accepted_rows: 1,
        defaulted: { date: 0 },
        defaulted_examples: { date: [] },
        filtered: { outside_month: 0, status_filtered: 0, ignored_type: 0, invalid_date: 0, invalid_amount: 0, unmapped_type: 0 },
        examples: {},
        filtered_rows: []
      }
    };
    const dialogView = render(
      <CsvImportDialog
        hostWindow={window}
        inspection={inspection}
        onCancel={vi.fn()}
        onPreview={vi.fn().mockResolvedValue(preview)}
        onApply={vi.fn()}
      />
    );
    const dialog = screen.getAllByRole("dialog", { name: "导入账单" }).at(-1)!;

    await userEvent.click(within(dialog).getByRole("button", { name: "下一步：确认映射" }));
    expect(within(dialog).getByText("第 2 步：确认字段和筛选")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "上一步：文件读取" }));
    expect(within(dialog).getByText("第 1 步：确认文件结构")).toBeTruthy();
    expect(within(dialog).queryByText("第 2 步：确认字段和筛选")).toBeNull();

    await userEvent.click(within(dialog).getByRole("button", { name: "下一步：确认映射" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(within(dialog).getByText("第 3 步：检查预览")).toBeTruthy());
    await userEvent.click(within(dialog).getByRole("button", { name: "上一步：确认映射" }));
    expect(within(dialog).getByText("第 2 步：确认字段和筛选")).toBeTruthy();
    dialogView.unmount();
  });

  it("shows every filtered source row in the preview", async () => {
    const preview = {
      month: "2026-07",
      rows: [],
      issues: [],
      type_summary: {},
      modes: ["append", "replace"] as const,
      import_stats: {
        source_rows: 3,
        accepted_rows: 1,
        defaulted: { date: 0 },
        defaulted_examples: { date: [] },
        filtered: { outside_month: 0, status_filtered: 0, ignored_type: 2, invalid_date: 0, invalid_amount: 0, unmapped_type: 0 },
        examples: { ignored_type: [{ row: 3, value: "其他" }] },
        filtered_rows: [
          { row: 2, reason: "ignored_type" as const, values: { 日期: "2026-07-01", 商品: "不导入", 金额: "10", 类型: "其他" } },
          { row: 3, reason: "ignored_type" as const, values: { 日期: "2026-07-02", 商品: "另一条", 金额: "20", 类型: "其他" } }
        ]
      }
    };
    render(
      <CsvImportDialog
        hostWindow={window}
        inspection={inspection}
        onCancel={vi.fn()}
        onPreview={vi.fn().mockResolvedValue(preview)}
        onApply={vi.fn()}
      />
    );

    const dialog = screen.getAllByRole("dialog").at(-1)!;
    await userEvent.click(within(dialog).getByRole("button", { name: "下一步：确认映射" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(within(dialog).getByText("查看全部被过滤条目（2 行）")).toBeTruthy());
    expect(within(dialog).getByText("不导入")).toBeTruthy();
    expect(within(dialog).getByText("另一条")).toBeTruthy();
  });

  it("explains an empty preview and leaves the user a retry path", async () => {
    const preview = {
      month: "2026-07",
      rows: [],
      issues: [],
      type_summary: {},
      modes: ["append", "replace"] as const,
      import_stats: {
        source_rows: 1,
        accepted_rows: 0,
        defaulted: { date: 0 },
        defaulted_examples: { date: [] },
        filtered: { outside_month: 0, status_filtered: 0, ignored_type: 1, invalid_date: 0, invalid_amount: 0, unmapped_type: 0 },
        examples: { ignored_type: [{ row: 2, value: "其他" }] },
        filtered_rows: [
          { row: 2, reason: "ignored_type" as const, values: { 日期: "2026-07-01", 商品: "不导入", 金额: "10", 类型: "其他" } }
        ]
      }
    };
    render(
      <CsvImportDialog
        hostWindow={window}
        inspection={inspection}
        onCancel={vi.fn()}
        onPreview={vi.fn().mockResolvedValue(preview)}
        onApply={vi.fn()}
      />
    );
    const dialog = screen.getAllByRole("dialog", { name: "导入账单" }).at(-1)!;
    await userEvent.click(within(dialog).getByRole("button", { name: "下一步：确认映射" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(within(dialog).getByText("没有流水可以加入草稿")).toBeTruthy());
    expect(within(dialog).getByText("当前草稿未改变。请检查字段映射、收支结果和状态选择，再重新生成预览。"))
      .toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "上一步：确认映射" })).toBeTruthy();
  });

  it("offers header row selection when the first row is not a reasonable header", async () => {
    const onHeaderRowChange = vi.fn().mockResolvedValue({
      ...inspection,
      header_status: "normal",
      header_confirmed: true,
      header_row: 4,
      data_start_row: 5,
      raw_row_count: 5,
      raw_rows: [
        { row: 1, values: ["账单导出"] },
        { row: 2, values: ["说明"] },
        { row: 3, values: ["标题"] },
        { row: 4, values: ["日期", "商品", "金额", "类型"] },
        { row: 5, values: ["2026-07-01", "午餐", "20", "支出"] }
      ],
      header_candidates: [{
        row: 4,
        headers: ["日期", "商品", "金额", "类型"],
        matched_fields: ["日期", "商品", "金额", "收支"],
        score: 450,
        confidence: "high"
      }],
      suggested_mapping: {
        date_column: "日期",
        product_column: "商品",
        amount_column: "金额",
        type_column: "类型"
      }
    });
    const uncertainInspection: CsvInspection = {
      ...inspection,
      header_status: "needs_confirmation",
      header_row: 4,
      raw_row_count: 5,
      raw_rows: [
        { row: 1, values: ["账单导出"] },
        { row: 2, values: ["说明"] },
        { row: 3, values: ["标题"] },
        { row: 4, values: ["日期", "商品", "金额", "类型"] },
        { row: 5, values: ["2026-07-01", "午餐", "20", "支出"] }
      ],
      header_candidates: [{
        row: 4,
        headers: ["日期", "商品", "金额", "类型"],
        matched_fields: ["日期", "商品", "金额", "收支"],
        score: 450,
        confidence: "high"
      }]
    };
    render(
      <CsvImportDialog
        hostWindow={window}
        inspection={uncertainInspection}
        onCancel={vi.fn()}
        onHeaderRowChange={onHeaderRowChange}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText("需要确认表头位置")).toBeTruthy();
    expect(screen.getByText("账单导出")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认此行" }));
    await waitFor(() => expect(onHeaderRowChange).toHaveBeenCalledWith({ header_row: 4 }));
    expect(screen.getByText("表头已确认")).toBeTruthy();
  });

  it("allows choosing a worksheet before confirming its header", async () => {
    const onHeaderRowChange = vi.fn().mockResolvedValue({
      ...inspection,
      worksheet_name: "账单明细",
      worksheet_candidates: [
        {
          name: "说明",
          row_count: 2,
          header_candidates: []
        },
        {
          name: "账单明细",
          row_count: 3,
          header_candidates: [{
            row: 2,
            headers: ["日期", "商品", "金额", "类型"],
            matched_fields: ["日期", "商品", "金额", "收支"],
            score: 450,
            confidence: "high"
          }]
        }
      ],
      header_status: "needs_confirmation",
      header_row: 2,
      raw_row_count: 3,
      raw_rows: [
        { row: 1, values: ["账单说明"] },
        { row: 2, values: ["日期", "商品", "金额", "类型"] },
        { row: 3, values: ["2026-07-01", "午餐", "20", "支出"] }
      ]
    });
    const workbookInspection: CsvInspection = {
      ...inspection,
      filename: "账单.xlsx",
      worksheet_name: "说明",
      worksheet_candidates: [
        {
          name: "说明",
          row_count: 2,
          header_candidates: []
        },
        {
          name: "账单明细",
          row_count: 3,
          header_candidates: [{
            row: 2,
            headers: ["日期", "商品", "金额", "类型"],
            matched_fields: ["日期", "商品", "金额", "收支"],
            score: 450,
            confidence: "high"
          }]
        }
      ],
      headers: ["说明"],
      header_status: "needs_confirmation",
      header_row: 1,
      raw_row_count: 2,
      raw_rows: [
        { row: 1, values: ["导出说明"] },
        { row: 2, values: ["请打开账单明细"] }
      ]
    };
    render(
      <CsvImportDialog
        hostWindow={window}
        inspection={workbookInspection}
        onCancel={vi.fn()}
        onHeaderRowChange={onHeaderRowChange}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText("选择工作表")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: /账单明细/ }));
    await waitFor(() => expect(onHeaderRowChange).toHaveBeenCalledWith({
      worksheet_name: "账单明细"
    }));
    expect(screen.getByText("需要确认表头位置")).toBeTruthy();
    expect(screen.getByText("当前工作表")).toBeTruthy();
  });
});
