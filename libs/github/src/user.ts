import { CACHE_TTL_MS } from '@cairn/shared';
import type { GithubClient } from './client';

/** The authenticated user, from `GET /user`. */
export interface GithubUser {
  readonly login: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly avatarUrl: string | null;
}

/** One repo the viewer owns or collaborates on, from `GET /user/repos`. */
export interface GithubRepoSummary {
  readonly fullName: string;
  readonly primaryLanguage: string | null;
  readonly topics: readonly string[];
  readonly fork: boolean;
  readonly stargazers: number;
  readonly pushedAt: string;
}

/** A repo summary plus its language byte breakdown. */
export interface GithubRepoWithLanguages extends GithubRepoSummary {
  readonly languages: Readonly<Record<string, number>>;
}

/** Everything we read from GitHub to build a profile (ADR-0005). */
export interface GithubActivity {
  readonly user: GithubUser;
  readonly repos: readonly GithubRepoWithLanguages[];
  /** Merged pull requests the user authored, across all of GitHub. */
  readonly mergedPrCount: number;
}

interface UserApiShape {
  login: string;
  name: string | null;
  created_at: string;
  avatar_url: string | null;
}

interface RepoApiShape {
  full_name: string;
  language: string | null;
  topics?: string[];
  fork: boolean;
  stargazers_count: number;
  pushed_at: string;
}

/** How many of the most recently pushed repos we fetch languages for. */
export const LANGUAGE_FETCH_LIMIT = 15;

export async function fetchViewer(client: GithubClient): Promise<GithubUser> {
  const u = await client.get<UserApiShape>('/user', { ttlMs: CACHE_TTL_MS.viewer });
  return {
    login: u.login,
    name: u.name,
    createdAt: u.created_at,
    avatarUrl: u.avatar_url,
  };
}

/**
 * The viewer's repos, most recently pushed first. One page of 100 is plenty for a
 * skills profile; a user with more than that has more than enough signal already.
 */
export async function fetchViewerRepos(
  client: GithubClient,
): Promise<GithubRepoSummary[]> {
  const repos = await client.get<RepoApiShape[]>(
    '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
    { ttlMs: CACHE_TTL_MS.viewerRepos },
  );
  return repos
    .filter((r) => !r.fork)
    .map((r) => ({
      fullName: r.full_name,
      primaryLanguage: r.language,
      topics: r.topics ?? [],
      fork: r.fork,
      stargazers: r.stargazers_count,
      pushedAt: r.pushed_at,
    }));
}

export async function fetchRepoLanguages(
  client: GithubClient,
  fullName: string,
): Promise<Record<string, number>> {
  return client.get<Record<string, number>>(`/repos/${fullName}/languages`, {
    ttlMs: CACHE_TTL_MS.languages,
  });
}

/** Count of merged PRs the user authored. Best-effort — the search API is rate-limited. */
export async function fetchMergedPrCount(
  client: GithubClient,
  login: string,
): Promise<number> {
  return client
    .get<{ total_count: number }>(
      `/search/issues?q=type:pr+author:${login}+is:merged&per_page=1`,
      { ttlMs: CACHE_TTL_MS.mergedPrCount },
    )
    .then((r) => r.total_count)
    .catch(() => 0);
}

/**
 * Assemble everything @cairn/profile needs from a token-scoped client. Kept here so
 * the profile module stays pure and free of API concerns (mirrors collectHealthSignals).
 */
export async function collectGithubActivity(
  client: GithubClient,
): Promise<GithubActivity> {
  const user = await fetchViewer(client);
  const [repos, mergedPrCount] = await Promise.all([
    fetchViewerRepos(client),
    fetchMergedPrCount(client, user.login),
  ]);

  const top = repos.slice(0, LANGUAGE_FETCH_LIMIT);
  const languages = await Promise.all(
    top.map((r) => fetchRepoLanguages(client, r.fullName).catch(() => ({}))),
  );
  const withLanguages: GithubRepoWithLanguages[] = top.map((r, i) => ({
    ...r,
    languages: languages[i] ?? {},
  }));

  return { user, repos: withLanguages, mergedPrCount };
}
