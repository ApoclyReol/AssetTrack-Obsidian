import { describe, expect, it } from "vitest";
import {
  createDateReadWindow,
  createMonthReadWindow,
  recentMonthReadWindow,
  sampleMonths
} from "../../src/domain/readWindows";

describe("read windows", () => {
  it("builds inclusive monthly and date windows", () => {
    expect(createMonthReadWindow("analysis", "2025-04", "2026-03")).toEqual({
      kind: "analysis",
      from_month: "2025-04",
      to_month: "2026-03",
      from_date: "2025-04-01",
      to_date: "2026-03-31",
      month_count: 12
    });
    expect(createDateReadWindow("analysis", "2025-04-03", "2026-03-28")).toEqual({
      kind: "analysis",
      from_month: "2025-04",
      to_month: "2026-03",
      from_date: "2025-04-03",
      to_date: "2026-03-28",
      month_count: 12
    });
    expect(recentMonthReadWindow("system-check", "2026-03", 60)).toMatchObject({
      from_month: "2021-04",
      to_month: "2026-03",
      month_count: 60
    });
  });

  it("samples annual trend months while preserving the endpoints", () => {
    const months = Array.from({ length: 120 }, (_, index) =>
      `${2017 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`
    );
    const sampled = sampleMonths(months);
    expect(sampled).toHaveLength(18);
    expect(sampled[0]).toBe("2017-01");
    expect(sampled.at(-1)).toBe("2026-12");
    expect(new Set(sampled).size).toBe(sampled.length);
  });
});
