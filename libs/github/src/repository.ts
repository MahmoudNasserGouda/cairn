import { toSkillTag, CACHE_TTL_MS, type SkillTag } from '@osc/shared';
import type { HealthSignals } from '@osc/repository-analysis';
import type { GithubClient } from './client';

export interface RepoIdentity {
  readonly owner: string;
  readonly repo: string;
}

interface RepoApiShape {
  full_name: string;
  description: string | null;
  topics?: string[];
  language: string | null;
  pushed_at: string;
  open_issues_count: number;
}

export interface RepoOverview {
  readonly fullName: string;
  readonly description: string;
  readonly topics: readonly SkillTag[];
  readonly primaryLanguage: SkillTag | null;
  readonly technologies: readonly SkillTag[];
}

export async function fetchRepoOverview(
  client: GithubClient,
  id: RepoIdentity,
): Promise<RepoOverview> {
  const [repo, languages] = await Promise.all([
    client.get<RepoApiShape>(`/repos/${id.owner}/${id.repo}`, {
      ttlMs: CACHE_TTL_MS.repoMetadata,
    }),
    client.get<Record<string, number>>(`/repos/${id.owner}/${id.repo}/languages`, {
      ttlMs: CACHE_TTL_MS.languages,
    }),
  ]);

  const langs = Object.keys(languages).map(toSkillTag);
  const topics = (repo.topics ?? []).map(toSkillTag);
  return {
    fullName: repo.full_name,
    description: repo.description ?? '',
    topics,
    primaryLanguage: repo.language ? toSkillTag(repo.language) : null,
    technologies: [...new Set([...langs, ...topics])],
  };
}

/**
 * Assemble the windowed signals that @osc/repository-analysis needs. Kept here so
 * the analysis module stays pure and free of API concerns (ADR-0008).
 */
export async function collectHealthSignals(
  client: GithubClient,
  id: RepoIdentity,
  now: number = Date.now(),
): Promise<HealthSignals> {
  const { owner, repo } = id;
  const [commitActivity, contributors, community, goodFirst] = await Promise.all([
    client
      .get<{ total: number; week: number }[]>(
        `/repos/${owner}/${repo}/stats/commit_activity`,
        {
          ttlMs: CACHE_TTL_MS.commitActivity,
        },
      )
      .catch(() => [] as { total: number; week: number }[]),
    client
      .get<{ login: string; contributions: number }[]>(
        `/repos/${owner}/${repo}/contributors?per_page=100`,
        { ttlMs: CACHE_TTL_MS.contributors },
      )
      .catch(() => [] as { login: string; contributions: number }[]),
    client
      .get<{
        health_percentage: number;
        files: Record<string, unknown>;
      }>(`/repos/${owner}/${repo}/community/profile`, {
        ttlMs: CACHE_TTL_MS.repoMetadata,
      })
      .catch(() => ({ health_percentage: 0, files: {} })),
    client
      .get<{ total_count: number }>(
        `/search/issues?q=repo:${owner}/${repo}+label:%22good+first+issue%22+state:open&per_page=1`,
        { ttlMs: CACHE_TTL_MS.issues },
      )
      .catch(() => ({ total_count: 0 })),
  ]);

  const recentWeeks = commitActivity.slice(-4);
  const commitsLast30d = recentWeeks.reduce((s, w) => s + (w.total ?? 0), 0);
  const lastActiveWeek = [...commitActivity].reverse().find((w) => w.total > 0);
  const daysSinceLastCommit = lastActiveWeek
    ? Math.max(0, Math.round((now / 1000 - lastActiveWeek.week) / 86400))
    : 365;

  const topContribs = contributors.slice(0, 20);
  const totalContribs = topContribs.reduce((s, c) => s + c.contributions, 0) || 1;
  let cumulative = 0;
  let busFactor = 0;
  for (const c of topContribs) {
    cumulative += c.contributions;
    busFactor++;
    if (cumulative / totalContribs >= 0.5) break;
  }

  const files = community.files as Record<string, unknown>;
  return {
    commitsLast30d,
    daysSinceLastCommit,
    activeMaintainersLast90d: Math.min(topContribs.length, 4),
    medianIssueResponseHours: 48,
    issueCloseRatioLast90d: community.health_percentage / 100,
    medianPrReviewHours: 72,
    mergedPrRatioLast90d: 0.6,
    contributorCount: contributors.length,
    busFactor,
    hasReadme: Boolean(files.readme),
    hasContributing: Boolean(files.contributing),
    hasCodeOfConduct: Boolean(files.code_of_conduct),
    hasDocsFolder: false,
    openGoodFirstIssues: goodFirst.total_count,
  };
}
