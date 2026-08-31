import { describe, expect, it } from "vitest";
import { normalizeDate } from "../../src/domain/dates";

describe("date normalization", () => {
  it.each([
    ["2026-08-31 09:23:16", "2026-08-31"],
    ["2026/8/31", "2026-08-31"],
    ["2026.08.31T09:23:16", "2026-08-31"],
    ["2026年8月31日 09:23", "2026-08-31"],
    ["20260831", "2026-08-31"],
    ["8/31/2026 9:23", "2026-08-31"],
    ["31/8/2026 9:23", "2026-08-31"],
    ["8/31/26 9:23", "2026-08-31"],
    ["31/8/26 9:23", "2026-08-31"]
  ])("normalizes %s", (value, expected) => {
    expect(normalizeDate(value)).toBe(expected);
  });

  it("keeps ambiguous month/day values deterministic instead of changing them to fit the target month", () => {
    expect(normalizeDate("02/03/2026", "2026-03")).toBe("2026-02-03");
    expect(normalizeDate("12/01/2026", "2026-01")).toBe("2026-12-01");
  });

  it("supports Excel serial date values", () => {
    expect(normalizeDate("45292")).toBe("2024-01-01");
    expect(normalizeDate(46266.75)).toBe("2026-09-01");
  });

  it.each(["2026-02-29", "31/02/2026", "8/31/2026x", "not-a-date"])(
    "rejects invalid date %s",
    (value) => {
      expect(() => normalizeDate(value)).toThrowError("date.invalid_format");
    }
  );
});
