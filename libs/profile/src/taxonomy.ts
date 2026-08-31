import { toSkillTag, type SkillTag } from '@cairn/shared';

/**
 * Versioned skills taxonomy. Shared by the CV parser, GitHub analysis, and the
 * matching engine so tags are comparable (ADR-0011). Bump VERSION on any change.
 */
export const TAXONOMY_VERSION = 1;

/** canonical tag -> aliases that should map to it */
export const SKILL_ALIASES: Readonly<Record<SkillTag, readonly string[]>> = {
  javascript: ['js', 'ecmascript', 'node.js', 'nodejs'],
  typescript: ['ts'],
  python: ['py', 'python3'],
  'c#': ['csharp', 'c-sharp', 'dotnet', '.net'],
  'c++': ['cpp', 'cplusplus'],
  go: ['golang'],
  rust: ['rustlang'],
  angular: ['angularjs', 'angular2'],
  react: ['reactjs', 'react.js'],
  vue: ['vuejs', 'vue.js'],
  node: ['node.js', 'nodejs'],
  kubernetes: ['k8s'],
  postgresql: ['postgres', 'psql'],
  'github-actions': ['gh-actions', 'actions'],
};

const ALIAS_LOOKUP: Map<string, SkillTag> = (() => {
  const m = new Map<string, SkillTag>();
  for (const [canon, aliases] of Object.entries(SKILL_ALIASES)) {
    m.set(canon, canon);
    for (const a of aliases) m.set(toSkillTag(a), canon);
  }
  return m;
})();

/** Known skill tags the parser will recognise in free text. */
export const KNOWN_SKILLS: readonly SkillTag[] = [
  'javascript',
  'typescript',
  'python',
  'java',
  'c#',
  'c++',
  'go',
  'rust',
  'ruby',
  'php',
  'kotlin',
  'swift',
  'scala',
  'angular',
  'react',
  'vue',
  'svelte',
  'node',
  'express',
  'nestjs',
  'django',
  'flask',
  'spring',
  'rails',
  'dotnet',
  'html',
  'css',
  'sass',
  'tailwind',
  'graphql',
  'rest',
  'grpc',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'sqlite',
  'docker',
  'kubernetes',
  'terraform',
  'aws',
  'gcp',
  'azure',
  'github-actions',
  'git',
  'linux',
  'bash',
  'webpack',
  'vite',
  'jest',
  'vitest',
  'cypress',
  'playwright',
  'accessibility',
  'i18n',
  'wasm',
];

export function canonicalizeSkill(raw: string): SkillTag {
  const tag = toSkillTag(raw);
  return ALIAS_LOOKUP.get(tag) ?? tag;
}

/** Extract known skills from a block of text (case-insensitive, word-ish boundaries). */
export function extractSkills(text: string): SkillTag[] {
  const hay = ` ${text.toLowerCase().replace(/[|,/()]/g, ' ')} `;
  const found = new Set<SkillTag>();
  const candidates = [
    ...KNOWN_SKILLS,
    ...Object.keys(SKILL_ALIASES).flatMap((k) => SKILL_ALIASES[k] ?? []),
  ];
  for (const cand of candidates) {
    const needle = cand.toLowerCase();
    const boundary = new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(needle)}([^a-z0-9+#.]|$)`);
    if (boundary.test(hay)) found.add(canonicalizeSkill(cand));
  }
  return [...found].sort();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
