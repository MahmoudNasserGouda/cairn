import type { SkillTag } from '@cairn/shared';

/**
 * Architecture model (Phase 3 "Architecture Explorer"). Populated deterministically
 * from the file tree + manifests; an optional BYOK AI pass (@cairn/ai) can enrich the
 * summaries but is never required (ADR-0009).
 */
export interface FolderNode {
  readonly path: string;
  readonly purpose: string;
  readonly children: readonly FolderNode[];
}

export interface ArchitectureModel {
  readonly summary: string;
  readonly layers: readonly string[];
  readonly components: readonly { name: string; path: string; role: string }[];
  readonly dependencies: readonly SkillTag[];
  readonly tree: FolderNode;
  /** Recommended file reading order for a newcomer. */
  readonly readingOrder: readonly string[];
}

const KNOWN_DIRS: Record<string, string> = {
  src: 'Primary application/library source',
  lib: 'Library source',
  libs: 'Shared internal libraries',
  packages: 'Monorepo workspace packages',
  apps: 'Deployable applications',
  test: 'Test suites',
  tests: 'Test suites',
  __tests__: 'Test suites',
  docs: 'Documentation',
  examples: 'Usage examples',
  scripts: 'Build / maintenance scripts',
  '.github': 'CI/CD workflows and repo config',
  public: 'Static assets served as-is',
  dist: 'Build output (generated)',
  node_modules: 'Dependencies (generated)',
};

export function describeDir(name: string): string {
  return KNOWN_DIRS[name] ?? 'Project directory';
}

/**
 * Generate a newcomer reading order from a flat list of repo-relative file paths.
 * Deterministic: entry points and docs first, tests and generated output last.
 */
export function readingOrder(paths: readonly string[]): string[] {
  const rank = (p: string): number => {
    const lower = p.toLowerCase();
    if (/readme|contributing|architecture|docs\//.test(lower)) return 0;
    if (/(^|\/)(index|main|app|bootstrap|server)\.[jt]sx?$/.test(lower)) return 1;
    if (/package\.json$|tsconfig|\.config\./.test(lower)) return 2;
    if (/\.(test|spec)\.[jt]sx?$/.test(lower)) return 8;
    if (/dist\/|build\/|\.min\./.test(lower)) return 9;
    return 5;
  };
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
