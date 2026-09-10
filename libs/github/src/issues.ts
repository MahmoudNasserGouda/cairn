import { CACHE_TTL_MS } from '@cairn/shared';
import type { IssueInput } from '@cairn/issue-analysis';
import type { GithubClient } from './client';
import type { RepoIdentity } from './repository';

interface IssueApiShape {
  number: number;
  title: string;
  body: string | null;
  labels: (string | { name?: string })[];
  comments: number;
  reactions?: { total_count?: number };
  html_url: string;
  /** Present only when the "issue" is really a pull request. */
  pull_request?: unknown;
}

export interface IssueListItem {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly commentCount: number;
  readonly reactions: number;
  readonly htmlUrl: string;
}

export interface ListOpenIssuesOptions {
  /** Restrict to issues carrying this label, e.g. "good first issue". */
  readonly label?: string;
  readonly perPage?: number;
}

/**
 * Open issues for a repo (`GET /repos/:owner/:repo/issues`). The endpoint also
 * returns pull requests; those carry a `pull_request` key and are dropped here.
 */
export async function listOpenIssues(
  client: GithubClient,
  id: RepoIdentity,
  opts: ListOpenIssuesOptions = {},
): Promise<IssueListItem[]> {
  const perPage = Math.min(Math.max(opts.perPage ?? 30, 1), 100);
  const labelQuery = opts.label ? `&labels=${encodeURIComponent(opts.label)}` : '';
  const path =
    `/repos/${id.owner}/${id.repo}/issues` +
    `?state=open&per_page=${perPage}&sort=updated${labelQuery}`;

  const raw = await client.get<IssueApiShape[]>(path, {
    ttlMs: CACHE_TTL_MS.issues,
  });

  return raw
    .filter((item) => item.pull_request === undefined)
    .map((item) => ({
      number: item.number,
      title: item.title,
      body: item.body ?? '',
      labels: item.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
      commentCount: item.comments,
      reactions: item.reactions?.total_count ?? 0,
      htmlUrl: item.html_url,
    }));
}

/**
 * Adapt a list item into the shape `@cairn/issue-analysis` scores. The list
 * payload carries no participant or linked-PR data, so those are 0 — `analyzeIssue`
 * simply leans harder on the text and labels.
 */
export function toIssueInput(item: IssueListItem): IssueInput {
  return {
    title: item.title,
    body: item.body,
    labels: item.labels,
    commentCount: item.commentCount,
    linkedPrCount: 0,
    participantCount: 0,
    reactions: item.reactions,
  };
}
