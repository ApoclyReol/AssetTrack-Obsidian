// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionTableHeader, StaticTableHeader } from "../../src/ui/TablePrimitives";

describe("table header primitives", () => {
  afterEach(cleanup);

  it("renders non-sortable headers with the uniform button treatment", () => {
    render(
      <table>
        <thead>
          <tr>
            <StaticTableHeader label="状态" />
          </tr>
        </thead>
      </table>
    );

    const header = screen.getByRole("columnheader");
    const button = screen.getByRole("button", { name: "状态" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(header.textContent?.trim()).toBe("状态");
    expect(header.querySelector(".asset-track-sort-static")).toBeTruthy();
  });

  it("uses the uniform button treatment for the operation header", () => {
    render(
      <table>
        <thead>
          <tr>
            <ActionTableHeader />
          </tr>
        </thead>
      </table>
    );

    const header = screen.getByRole("columnheader");
    const button = screen.getByRole("button", { name: "操作" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(header.textContent?.trim()).toBe("操作");
    expect(header.classList.contains("asset-track-actions-heading")).toBe(true);
  });
});
