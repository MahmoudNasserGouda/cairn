import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'coverage/**',
      'node_modules/**',
      'apps/web/.angular/**',
      'apps/extension/dist/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts', 'eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      // typescript-eslint handles undefined-symbol detection; no-undef misfires on TS.
      'no-undef': 'off',
      'import/no-cycle': ['error', { maxDepth: 1 }],
      'import/no-useless-path-segments': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Async methods that only satisfy an async interface contract are fine.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'console',
          property: 'log',
          message: 'Use the shared logger; console.log can leak secrets (SECURITY.md).',
        },
      ],
    },
  },

  // libs/* must never depend on apps/* and stay framework-agnostic (ADR-0005).
  {
    files: ['libs/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@osc/web', '@osc/web/*', '@osc/extension', '@osc/extension/*'],
              message: 'libs/* must not import apps/* (ADR-0005 dependency rule).',
            },
            {
              group: ['**/apps/*', '../../apps/*', '../../../apps/*'],
              message: 'libs/* must not import apps/* (ADR-0005 dependency rule).',
            },
            {
              group: ['@angular/*', 'rxjs', 'rxjs/*'],
              message:
                'libs/* are framework-agnostic (ADR-0005). Keep Angular/RxJS in apps/web.',
            },
          ],
        },
      ],
    },
  },

  // Plain Node scripts — not part of the typed project.
  {
    files: ['scripts/**/*.mjs', 'apps/extension/build.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  // Tests may use dev-only patterns.
  {
    files: ['libs/**/*.test.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
