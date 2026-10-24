// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReconciliationHint } from "../../src/ui/ReconciliationHint";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const show = () => { fireEvent.mouseEnter(document.querySelector(".asset-track-reconciliation-hint")!); act(() => { vi.advanceTimersByTime(200); }); };

describe("reconciliation hint", () => {
  it("explains a positive difference and keeps the detail closed by default", () => {
    render(<ReconciliationHint discrepancy={250} tolerance={100} />);

    expect(screen.queryByRole("tooltip")).toBeNull();
    show();
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
    show();
    expect(screen.getByText("差额为正：少收入")).toBeTruthy();
    expect(screen.getByText("检查收入、退款、红包或转账回款是否漏记。"))
      .toBeTruthy();
  });

  it("explains negative, balanced, and unavailable results", () => {
    const view = render(<ReconciliationHint discrepancy={-250} tolerance={100} />);
    show();
    expect(screen.getByText("差额为负：少支出")).toBeTruthy();

    view.unmount();
    render(<ReconciliationHint discrepancy={50} tolerance={100} />);
    show();
    expect(screen.getByText("当前显示平账")).toBeTruthy();

    cleanup();
    render(<ReconciliationHint discrepancy={null} tolerance={100} />);
    show();
    expect(screen.getByText("暂无对账基准")).toBeTruthy();
  });
});
