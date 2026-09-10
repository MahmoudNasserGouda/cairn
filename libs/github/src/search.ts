import { toSkillTag, CACHE_TTL_MS, type SkillTag } from '@cairn/shared';
import type { GithubClient } from './client';

interface SearchRepoApiShape {
  full_name: string;
  description: string | null;
  topics?: string[];
  language: string | null;
  stargazers_count: number;
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
}

export interface SearchRepositoriesOptions {
  /** Max results to return (GitHub caps a page at 100). */
  readonly perPage?: number;
}

/**
 * Full-text repository search (`GET /search/repositories`), newest-star-first.
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
  const path =
    `/search/repositories?q=${encodeURIComponent(q)}` +
    `&sort=stars&order=desc&per_page=${perPage}`;

  const res = await client.get<SearchResponse>(path, {
    ttlMs: CACHE_TTL_MS.repoSearch,
  });

  return (res.items ?? []).map((item) => {
    const [owner = '', repo = ''] = item.full_name.split('/');
    return {
      fullName: item.full_name,
      owner,
      repo,
      description: item.description ?? '',
      stars: item.stargazers_count,
      primaryLanguage: item.language ? toSkillTag(item.language) : null,
      topics: (item.topics ?? []).map(toSkillTag),
    };
  });
}
