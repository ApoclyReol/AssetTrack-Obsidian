import { describe, expect, it } from "vitest";
import { roundHalfEven } from "../../src/domain/money";

describe("Python-compatible amount rounding", () => {
  it("uses half-even at exact ties", () => {
    expect(roundHalfEven(2.5, 0)).toBe(2);
    expect(roundHalfEven(3.5, 0)).toBe(4);
    expect(roundHalfEven(20.126, 2)).toBe(20.13);
  });
});
