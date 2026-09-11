import {
  canonicalizeSkill,
  toKnownSkills,
  CACHE_TTL_MS,
  type SkillTag,
} from '@cairn/shared';
import type { GithubClient } from './client';

interface SearchRepoApiShape {
  full_name: string;
  description: string | null;
  topics?: string[];
  language: string | null;
  stargazers_count: number;
  forks_count?: number;
  open_issues_count?: number;
  pushed_at?: string | null;
  archived?: boolean;
  fork?: boolean;
  html_url?: string;
}

interface SearchResponse {
  items?: SearchRepoApiShape[];
}

export interface RepoSearchResult {
  readonly fullName: string;
  readonly owner: string;
  readonly repo: string;
  readonly description: string;
  readonly stars: number;
  readonly primaryLanguage: SkillTag | null;
  readonly topics: readonly SkillTag[];
  /**
   * Every topic, canonicalised but unfiltered — mirrors `RepoOverview.allTopics`.
   * Discovery reads it for newcomer markers (`good-first-issue`, `hacktoberfest`)
   * that are deliberately absent from `topics`, which carries technologies only.
   */
  readonly allTopics: readonly SkillTag[];
  readonly forks: number;
  /** GitHub counts pull requests here too — a work-available proxy, not an issue count. */
  readonly openIssues: number;
  /** ISO-8601 last push, or null when GitHub omitted it. */
  readonly pushedAt: string | null;
  readonly archived: boolean;
  readonly isFork: boolean;
  readonly htmlUrl: string;
}

export interface SearchRepositoriesOptions {
  /** Max results to return (GitHub caps a page at 100). */
  readonly perPage?: number;
  /**
   * Result ordering. `stars` (the default) is right for "find me the well-known
   * one"; `best-match` is right for discovery, where sorting by stars would return
   * the same handful of megaprojects for every developer who writes the language.
   */
  readonly sort?: 'stars' | 'best-match' | 'updated';
}

/**
 * Full-text repository search (`GET /search/repositories`); most-starred first
 * unless `opts.sort` says otherwise.
 *
 * Note: the Search API has a much stricter rate limit than the core API
 * (10 req/min unauthenticated, 30 authenticated). The client cache and a
 * signed-in token both mitigate; an empty query short-circuits without a call.
 */
export async function searchRepositories(
  client: GithubClient,
  query: string,
  opts: SearchRepositoriesOptions = {},
): Promise<RepoSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const perPage = Math.min(Math.max(opts.perPage ?? 10, 1), 100);
  const sort = opts.sort ?? 'stars';
  // GitHub reads "best match" as the *absence* of a sort parameter.
  const ordering = sort === 'best-match' ? '' : `&sort=${sort}&order=desc`;
  const path =
    `/search/repositories?q=${encodeURIComponent(q)}` + `${ordering}&per_page=${perPage}`;

  const res = await client.get<SearchResponse>(path, {
    ttlMs: CACHE_TTL_MS.repoSearch,
  });

  return (res.items ?? []).map((item) => {
    const [owner = '', repo = ''] = item.full_name.split('/');
    const rawTopics = item.topics ?? [];
    return {
      fullName: item.full_name,
      owner,
      repo,
      description: item.description ?? '',
      stars: item.stargazers_count,
      primaryLanguage: item.language ? canonicalizeSkill(item.language) : null,
      // Same taxonomy filter as `fetchRepoOverview` — free-text topics only.
      topics: toKnownSkills(rawTopics),
      allTopics: [...new Set(rawTopics.map(canonicalizeSkill))],
      forks: item.forks_count ?? 0,
      openIssues: item.open_issues_count ?? 0,
      pushedAt: item.pushed_at ?? null,
      archived: item.archived ?? false,
      isFork: item.fork ?? false,
      htmlUrl: item.html_url ?? `https://github.com/${item.full_name}`,
    };
  });
}
