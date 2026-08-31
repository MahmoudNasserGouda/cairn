import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@osc/shared': r('./libs/shared/src/index.ts'),
      '@osc/github': r('./libs/github/src/index.ts'),
      '@osc/profile': r('./libs/profile/src/index.ts'),
      '@osc/matching': r('./libs/matching/src/index.ts'),
      '@osc/scoring': r('./libs/scoring/src/index.ts'),
      '@osc/repository-analysis': r('./libs/repository-analysis/src/index.ts'),
      '@osc/issue-analysis': r('./libs/issue-analysis/src/index.ts'),
      '@osc/portfolio': r('./libs/portfolio/src/index.ts'),
      '@osc/ai': r('./libs/ai/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['libs/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['libs/*/src/**/*.ts'],
      exclude: ['libs/*/src/**/*.test.ts', 'libs/*/src/index.ts'],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
});
