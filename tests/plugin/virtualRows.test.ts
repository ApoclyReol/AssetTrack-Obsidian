import { describe, expect, it } from "vitest";
import {
  calculateVirtualRowRange,
  virtualSpacerBlocks
} from "../../src/ui/virtualRows";

describe("virtual row range", () => {
  it("renders the viewport with overscan", () => {
    expect(calculateVirtualRowRange(10_000, 5_000, 500, 50, 5)).toEqual({
      start: 95,
      end: 115,
      paddingTop: 4_750,
      paddingBottom: 494_250
    });
  });

  it("clamps the range at both ends", () => {
    expect(calculateVirtualRowRange(3, 0, 500, 50, 8)).toEqual({
      start: 0,
      end: 3,
      paddingTop: 0,
      paddingBottom: 0
    });
    expect(calculateVirtualRowRange(0, 0, 500)).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0
    });
  });

  it("represents large spacer heights with a bounded set of CSS blocks", () => {
    const blocks = virtualSpacerBlocks(50_123);
    expect(blocks.reduce((total, block) => total + block, 0)).toBe(50_123);
    expect(blocks.length).toBeLessThanOrEqual(17);
  });
});
