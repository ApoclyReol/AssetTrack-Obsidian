// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReconciliationHint } from "../../src/ui/ReconciliationHint";

afterEach(cleanup);

describe("reconciliation hint", () => {
  it("explains a positive difference and keeps the detail closed by default", () => {
    render(<ReconciliationHint discrepancy={250} tolerance={100} />);

    const details = document.querySelector(".asset-track-reconciliation-hint") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("?"));

    expect(details.open).toBe(true);
    expect(screen.getByText("差额为正：少收入")).toBeTruthy();
    expect(screen.getByText("检查收入、退款、红包或转账回款是否漏记。"))
      .toBeTruthy();
  });

  it("explains negative, balanced, and unavailable results", () => {
    const view = render(<ReconciliationHint discrepancy={-250} tolerance={100} />);
    fireEvent.click(screen.getByText("?"));
    expect(screen.getByText("差额为负：少支出")).toBeTruthy();

    view.unmount();
    render(<ReconciliationHint discrepancy={50} tolerance={100} />);
    fireEvent.click(screen.getByText("?"));
    expect(screen.getByText("当前显示平账")).toBeTruthy();

    cleanup();
    render(<ReconciliationHint discrepancy={null} tolerance={100} />);
    fireEvent.click(screen.getByText("?"));
    expect(screen.getByText("暂无对账基准")).toBeTruthy();
  });
});
