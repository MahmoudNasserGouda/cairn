import { describe, expect, it } from 'vitest';
import { FEATURES } from './config';

/**
 * The AI freeze (ADR-0033) is one constant, which makes it one line away from being
 * undone by accident. This test is the tripwire: flipping it should require a
 * deliberate edit here and a matching change to the guide, not a stray commit.
 */
describe('feature flags', () => {
  it('ships with AI off', () => {
    expect(FEATURES.ai).toBe(false);
  });
});
