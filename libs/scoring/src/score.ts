import { clamp01, roundTo } from '@osc/shared';
import { WEIGHTS_VERSION, type WeightMap } from './weights';

export interface ScorePart {
  readonly key: string;
  /** Raw sub-score in [0, 1]. */
  readonly value: number;
  /** Weight actually applied (after normalisation). */
  readonly weight: number;
  /** value * weight — how many points this part contributed to the total. */
  readonly contribution: number;
  /** Optional human-readable note for the "why this score" UI. */
  readonly note?: string;
}

export interface ScoreBreakdown {
  /** Total score in [0, 1]. */
  readonly total: number;
  /** Total as a 0-100 percentage, rounded. */
  readonly percent: number;
  readonly weightsVersion: number;
  readonly parts: readonly ScorePart[];
}

export interface SubScoreInput {
  readonly value: number;
  readonly note?: string;
}

/**
 * Deterministic weighted aggregation (ADR-0007). Pure: no IO, no clock, no random.
 * Unknown weights default to 0; weights are normalised so the total stays in [0, 1]
 * even if the map does not sum to exactly 1.
 */
export function weightedScore(
  inputs: Readonly<Record<string, number | SubScoreInput>>,
  weights: WeightMap,
): ScoreBreakdown {
  const keys = Object.keys(weights);
  const weightSum = keys.reduce((s, k) => s + (weights[k] ?? 0), 0);
  const divisor = weightSum > 0 ? weightSum : 1;

  const parts: ScorePart[] = keys.map((key) => {
    const rawInput = inputs[key];
    const raw = typeof rawInput === 'number' ? rawInput : (rawInput?.value ?? 0);
    const note = typeof rawInput === 'number' ? undefined : rawInput?.note;
    const value = clamp01(raw);
    const weight = (weights[key] ?? 0) / divisor;
    const part: ScorePart = {
      key,
      value: roundTo(value, 4),
      weight: roundTo(weight, 4),
      contribution: roundTo(value * weight, 4),
      ...(note ? { note } : {}),
    };
    return part;
  });

  const total = clamp01(parts.reduce((s, p) => s + p.contribution, 0));
  return {
    total: roundTo(total, 4),
    percent: Math.round(total * 100),
    weightsVersion: WEIGHTS_VERSION,
    parts,
  };
}

/** Render a breakdown as the plain-text table used in the ADRs and CLI output. */
export function explain(breakdown: ScoreBreakdown, title = 'Score'): string {
  const rows = breakdown.parts.map(
    (p) =>
      `  ${p.key.padEnd(18)} ${(p.value * 100).toFixed(0).padStart(3)}%  (w ${(p.weight * 100).toFixed(0)}%)`,
  );
  return [`${title}: ${breakdown.percent}%`, ...rows].join('\n');
}
