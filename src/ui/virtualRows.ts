export const VIRTUAL_ROW_HEIGHT = 50;
export const VIRTUAL_OVERSCAN = 8;
const SPACER_BLOCKS = [
  65_536,
  32_768,
  16_384,
  8_192,
  4_096,
  2_048,
  1_024,
  512,
  256,
  128,
  64,
  32,
  16,
  8,
  4,
  2,
  1
] as const;

export interface VirtualRowRange {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export function calculateVirtualRowRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = VIRTUAL_ROW_HEIGHT,
  overscan = VIRTUAL_OVERSCAN
): VirtualRowRange {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const visibleStart = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(total, visibleStart + visibleCount + overscan);
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (total - end) * rowHeight)
  };
}

export function virtualSpacerBlocks(rows: number): number[] {
  let remaining = Math.max(0, Math.trunc(rows));
  return SPACER_BLOCKS.flatMap((block) => {
    if (remaining < block) return [];
    remaining -= block;
    return [block];
  });
}
