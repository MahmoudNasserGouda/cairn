import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@cairn/shared': r('./libs/shared/src/index.ts'),
      '@cairn/github': r('./libs/github/src/index.ts'),
      '@cairn/profile': r('./libs/profile/src/index.ts'),
      '@cairn/matching': r('./libs/matching/src/index.ts'),
      '@cairn/scoring': r('./libs/scoring/src/index.ts'),
      '@cairn/repository-analysis': r('./libs/repository-analysis/src/index.ts'),
      '@cairn/issue-analysis': r('./libs/issue-analysis/src/index.ts'),
      '@cairn/portfolio': r('./libs/portfolio/src/index.ts'),
      '@cairn/ai': r('./libs/ai/src/index.ts'),
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
