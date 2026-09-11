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
  /** How many *issues* the caller wants back, after pull requests are removed. */
  readonly perPage?: number;
  /** Extra pages to try when a page comes back mostly pull requests. */
  readonly maxPages?: number;
}

/** GitHub's own ceiling for `per_page`. */
const API_PAGE_MAX = 100;
const DEFAULT_MAX_PAGES = 3;

function toListItem(item: IssueApiShape): IssueListItem {
  return {
    number: item.number,
    title: item.title,
    body: item.body ?? '',
    labels: item.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
    commentCount: item.comments,
    reactions: item.reactions?.total_count ?? 0,
    htmlUrl: item.html_url,
  };
}

/**
 * Open issues for a repo (`GET /repos/:owner/:repo/issues`).
 *
 * The endpoint counts pull requests as issues and there is no parameter to exclude
 * them, so a PR-heavy repository can return a full page with barely an issue on it.
 * Filtering one page was leaving the UI to report "no open issues" for repositories
 * that plainly had some — so we keep pulling pages until we have `perPage` real
 * issues, GitHub runs out, or `maxPages` is reached.
 */
export async function listOpenIssues(
  client: GithubClient,
  id: RepoIdentity,
  opts: ListOpenIssuesOptions = {},
): Promise<IssueListItem[]> {
  const wanted = Math.min(Math.max(opts.perPage ?? 30, 1), API_PAGE_MAX);
  const maxPages = Math.max(opts.maxPages ?? DEFAULT_MAX_PAGES, 1);
  const labelQuery = opts.label ? `&labels=${encodeURIComponent(opts.label)}` : '';

  const issues: IssueListItem[] = [];
  for (let page = 1; page <= maxPages && issues.length < wanted; page++) {
    const path =
      `/repos/${id.owner}/${id.repo}/issues` +
      `?state=open&per_page=${API_PAGE_MAX}&page=${page}&sort=updated${labelQuery}`;

    const raw = await client.get<IssueApiShape[]>(path, {
      ttlMs: CACHE_TTL_MS.issues,
    });

    for (const item of raw) {
      if (item.pull_request === undefined) issues.push(toListItem(item));
    }
    // A short page is the last page; asking for another only burns quota.
    if (raw.length < API_PAGE_MAX) break;
  }

  return issues.slice(0, wanted);
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
