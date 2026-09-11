import { toSkillTag, type SkillTag } from './types';

/**
 * Versioned skills taxonomy — the single vocabulary every side of a comparison
 * must speak (ADR-0007, ADR-0011). Bump VERSION on any change.
 *
 * It lives in `libs/shared` rather than `libs/profile` on purpose. The developer
 * side (`githubToProfile`, the CV parser) and the repository side (`@cairn/github`
 * languages + topics) both feed the matching engine, so both must canonicalise
 * through *this* table. When only one side did, a repo topic `nodejs` could never
 * match a developer's `node` skill and every score was quietly wrong.
 */
export const TAXONOMY_VERSION = 3;

/**
 * canonical tag -> aliases that should map to it.
 *
 * Every alias must be claimed by exactly one canonical tag: `ALIAS_LOOKUP` is a Map,
 * so a duplicate would be silently resolved by declaration order. `taxonomy.test.ts`
 * asserts there are none.
 */
export const SKILL_ALIASES: Readonly<Record<SkillTag, readonly string[]>> = {
  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  python: ['py', 'python3'],
  'c#': ['csharp', 'c-sharp', 'dotnet', '.net'],
  'c++': ['cpp', 'cplusplus'],
  go: ['golang'],
  rust: ['rustlang'],
  angular: ['angularjs', 'angular2'],
  react: ['reactjs', 'react.js'],
  vue: ['vuejs', 'vue.js'],
  // The runtime, not the language: `nodejs` / `node.js` belong here, not on
  // `javascript`. Both tags claimed them before, and the Map handed them to
  // whichever was declared last.
  node: ['node.js', 'nodejs'],
  kubernetes: ['k8s'],
  postgresql: ['postgres', 'psql'],
  // No bare `actions` alias — it is an ordinary English word and matched any CV
  // sentence containing it.
  'github-actions': ['gh-actions'],
};

/**
 * Known skill tags. Every entry must be canonical (i.e. not an alias of something
 * else) or it can never be produced — `dotnet` used to sit here while also being an
 * alias of `c#`, so nothing ever carried it.
 */
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

/**
 * The subset of `KNOWN_SKILLS` that names a *programming language* rather than a
 * framework, tool or topic.
 *
 * Discovery needs the distinction because GitHub's search API treats the two
 * differently: `language:` only accepts a linguist language, while `angular` or
 * `docker` are reachable only as `topic:`. Sending a framework as `language:`
 * returns nothing at all, silently.
 */
export const LANGUAGE_SKILLS: readonly SkillTag[] = [
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
  'html',
  'css',
  'bash',
];

const ALIAS_LOOKUP: Map<string, SkillTag> = (() => {
  const m = new Map<string, SkillTag>();
  for (const [canon, aliases] of Object.entries(SKILL_ALIASES)) {
    m.set(canon, canon);
    for (const a of aliases) m.set(toSkillTag(a), canon);
  }
  return m;
})();

const KNOWN_SKILL_SET: ReadonlySet<SkillTag> = new Set(KNOWN_SKILLS);
const LANGUAGE_SKILL_SET: ReadonlySet<SkillTag> = new Set(LANGUAGE_SKILLS);

export function canonicalizeSkill(raw: string): SkillTag {
  const tag = toSkillTag(raw);
  return ALIAS_LOOKUP.get(tag) ?? tag;
}

/**
 * True when a tag names a technology this taxonomy actually knows.
 *
 * The repository side needs this because GitHub topics are free text: a repo can
 * carry `hacktoberfest`, `awesome`, `library` or `oss`, none of which is a skill.
 * Counting them as required technologies deflated every match score and put
 * "hacktoberfest" in the user's list of things to go and learn.
 */
export function isKnownSkill(tag: string): boolean {
  return KNOWN_SKILL_SET.has(canonicalizeSkill(tag));
}

/**
 * Canonicalise a batch of raw strings, drop anything outside the taxonomy, and
 * de-duplicate. Order is preserved so the first mention of a technology wins.
 */
export function toKnownSkills(raw: readonly string[]): SkillTag[] {
  const out: SkillTag[] = [];
  const seen = new Set<SkillTag>();
  for (const value of raw) {
    const tag = canonicalizeSkill(value);
    if (!KNOWN_SKILL_SET.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** True when a tag names a programming language (see `LANGUAGE_SKILLS`). */
export function isLanguageSkill(tag: string): boolean {
  return LANGUAGE_SKILL_SET.has(canonicalizeSkill(tag));
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
