import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@cairn/shared': r('./libs/shared/src/index.ts'),
      '@cairn/auth': r('./libs/auth/src/index.ts'),
      '@cairn/github': r('./libs/github/src/index.ts'),
      '@cairn/profile': r('./libs/profile/src/index.ts'),
      '@cairn/cv-extract': r('./libs/cv-extract/src/index.ts'),
      '@cairn/matching': r('./libs/matching/src/index.ts'),
      '@cairn/scoring': r('./libs/scoring/src/index.ts'),
      '@cairn/repository-analysis': r('./libs/repository-analysis/src/index.ts'),
      '@cairn/issue-analysis': r('./libs/issue-analysis/src/index.ts'),
      '@cairn/portfolio': r('./libs/portfolio/src/index.ts'),
      '@cairn/targets': r('./libs/targets/src/index.ts'),
      '@cairn/ai': r('./libs/ai/src/index.ts'),
    },
  },
  test: {
    globals: true,
    /**
     * Two projects, because the wiring layer needs a DOM and the engines do not.
     *
     * Only `libs/**` used to be collected, so every Angular service, the OAuth
     * Worker, and the whole browser layer sat outside the runner — a green `npm test`
     * said nothing about the code users actually touch, and a session-clobbering auth
     * bug shipped under it.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'libs',
          environment: 'node',
          include: ['libs/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['apps/**/*.test.ts', 'api/**/*.test.ts'],
          setupFiles: ['./scripts/test-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['libs/*/src/**/*.ts', 'apps/web/src/app/**/*.ts', 'api/**/src/**/*.ts'],
      exclude: [
        'libs/*/src/**/*.test.ts',
        'libs/*/src/index.ts',
        'apps/**/*.test.ts',
        'api/**/*.test.ts',
        // Cannot run under jsdom: the extraction worker needs a real Worker global,
        // and `worker-url` exists to satisfy Trusted Types + the bundler's
        // `new Worker(new URL(...))` literal, neither of which jsdom implements.
        // Both are exercised by hand and by the CV import tests' worker stub.
        'apps/web/src/app/core/cv/cv-extract.worker.ts',
        'apps/web/src/app/core/cv/worker-url.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
});
