export function roundHalfEven(value: number, digits = 2): number {
  if (!Number.isFinite(value)) throw new Error("金额必须是有限数字");
  const factor = 10 ** digits;
  const scaled = value * factor;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  let rounded: number;
  if (Math.abs(fraction - 0.5) <= epsilon) {
    rounded = lower % 2 === 0 ? lower : lower + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return Object.is(rounded / factor, -0) ? 0 : rounded / factor;
}

export function finiteNumber(
  value: unknown,
  options: { nonNegative?: boolean; label?: string } = {}
): number {
  const normalized =
    value === null || value === undefined || value === "" ? 0 : Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`${options.label ?? "金额"}必须是有限数字`);
  }
  if (options.nonNegative && normalized < 0) {
    throw new Error(`${options.label ?? "金额"}不能为负数`);
  }
  return roundHalfEven(normalized, 2);
}

export function sum(values: Iterable<number>): number {
  let result = 0;
  for (const value of values) result += Number(value) || 0;
  return roundHalfEven(result, 2);
}
