import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  /**
   * The Angular compiler, in the test pipeline — for **both** projects.
   *
   * Without it, Vitest runs Angular in pure JIT, which learns a component's inputs
   * from decorator metadata. **Signal inputs (`input()`, `model()`) then do not bind
   * at all**, by template attribute or by `componentRef.setInput` — no error, no
   * warning: the input keeps its default and the component renders as if the caller
   * had passed nothing. That was invisible until ADR-0032's `cn-*` library, because
   * no component in this app had ever taken an input from a parent template.
   *
   * It sits at the root rather than on the `app` project, even though only that
   * project has Angular in it, because **both projects transform `libs/*`** — the app
   * imports them. One plugin here and one esbuild there meant the same `zip.ts` was
   * instrumented two different ways, and the merged coverage report could not align
   * the two: 68% function coverage against 97% of its own statements. The numbers
   * were an artefact of the mismatch, not a gap in the tests. One transform, one
   * report.
   *
   * Dev-only; it never reaches the bundle
   * ([ADR-0021](docs/adr/0021-supply-chain-and-dependency-security.md)).
   */
  plugins: [angular({ tsconfig: r('./tsconfig.vitest.json') })],
  resolve: {
    alias: {
      '@cairn/shared': r('./libs/shared/src/index.ts'),
      '@cairn/auth': r('./libs/auth/src/index.ts'),
      '@cairn/github': r('./libs/github/src/index.ts'),
      '@cairn/gitlab': r('./libs/gitlab/src/index.ts'),
      '@cairn/stackexchange': r('./libs/stackexchange/src/index.ts'),
      '@cairn/devto': r('./libs/devto/src/index.ts'),
      // Before the bare specifier, or the prefix match would swallow it.
      '@cairn/profile/testing': r('./libs/profile/src/__fixtures__/build.ts'),
      '@cairn/profile': r('./libs/profile/src/index.ts'),
      // Before the bare specifier, or the prefix match would swallow it.
      '@cairn/zip/testing': r('./libs/zip/src/__fixtures__/build.ts'),
      '@cairn/zip': r('./libs/zip/src/index.ts'),
      // Before the bare specifier, or the prefix match would swallow it.
      '@cairn/cv-extract/testing': r('./libs/cv-extract/src/__fixtures__/build.ts'),
      '@cairn/cv-extract': r('./libs/cv-extract/src/index.ts'),
      '@cairn/doc-layout': r('./libs/doc-layout/src/index.ts'),
      '@cairn/cv-parse': r('./libs/cv-parse/src/index.ts'),
      // Before the bare specifier, or the prefix match would swallow it.
      '@cairn/linkedin-archive/testing': r(
        './libs/linkedin-archive/src/__fixtures__/build.ts',
      ),
      '@cairn/linkedin-archive': r('./libs/linkedin-archive/src/index.ts'),
      '@cairn/matching': r('./libs/matching/src/index.ts'),
      '@cairn/discovery': r('./libs/discovery/src/index.ts'),
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
          setupFiles: ['./apps/web/src/test-setup.ts'],
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
        // Cannot run under jsdom: a worker entry point needs a real Worker global,
        // and each `worker-url` exists to hold the bundler's
        // `new Worker(new URL(...))` literal, which jsdom does not implement.
        // All are exercised by hand and by the import tests' worker stub; the
        // Trusted Types policy they share is covered in `worker-policy.test.ts`.
        'apps/web/src/app/core/cv/cv-extract.worker.ts',
        'apps/web/src/app/core/cv/worker-url.ts',
        'apps/web/src/app/core/linkedin/linkedin-import.worker.ts',
        'apps/web/src/app/core/linkedin/worker-url.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
        /**
         * The pure, fixture-driven libraries hold a higher bar, as
         * `docs/testing.md` says they do. They take data in and return data out —
         * there is no browser, no clock and no network to excuse a gap — and they
         * are where a silent regression would be least visible, because nothing
         * about a two-column CV or a mis-read archive looks wrong until someone
         * reads their own profile.
         *
         * A glob that matches nothing passes silently, so this one is worth
         * checking by raising it and watching it fail if you ever edit the paths.
         */
        'libs/{zip,doc-layout,cv-parse,linkedin-archive}/src/**/*.ts': {
          statements: 85,
          branches: 85,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
});
