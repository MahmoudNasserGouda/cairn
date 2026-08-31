/** Clamp a number into the inclusive [0, 1] range. NaN becomes 0. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Clamp into an arbitrary inclusive range. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/** Linear interpolation of `value` from [inMin, inMax] onto [0, 1], clamped. */
export function normalize(value: number, inMin: number, inMax: number): number {
  if (inMax === inMin) return 0;
  return clamp01((value - inMin) / (inMax - inMin));
}

/** Round to a fixed number of decimal places without floating-point noise. */
export function roundTo(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
