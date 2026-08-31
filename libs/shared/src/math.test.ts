import { clamp01, clamp, normalize, roundTo } from './math';

describe('clamp01', () => {
  it('clamps below 0 and above 1', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });
  it('maps NaN to 0', () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('normalize', () => {
  it('maps a value onto [0, 1]', () => {
    expect(normalize(5, 0, 10)).toBe(0.5);
    expect(normalize(-5, 0, 10)).toBe(0);
    expect(normalize(50, 0, 10)).toBe(1);
  });
  it('returns 0 when the range is degenerate', () => {
    expect(normalize(5, 3, 3)).toBe(0);
  });
});

describe('clamp / roundTo', () => {
  it('clamps to an arbitrary range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('rounds without floating point noise', () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });
});
