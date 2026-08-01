// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionTableHeader, StaticTableHeader } from "../../src/ui/TablePrimitives";

describe("table header primitives", () => {
  afterEach(cleanup);

  it("renders non-sortable headers as static labels", () => {
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
    expect(screen.queryByRole("button", { name: "状态" })).toBeNull();
    expect(header.textContent?.trim()).toBe("状态");
    expect(header.querySelector(".asset-track-sort-static")).toBeTruthy();
  });

  it("keeps the operation header visually empty but accessible", () => {
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
    expect(header.getAttribute("aria-label")).toBeTruthy();
    expect(header.textContent?.trim()).toBe("");
  });
});
