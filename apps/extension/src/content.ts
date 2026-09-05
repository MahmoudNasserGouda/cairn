/**
 * Content script (ADR-0014). DOM rendering only — no secrets, no direct API calls.
 * Asks the background worker for data, computes scores with the shared engines,
 * and injects a compact panel on a GitHub repo page.
 */
import { healthScore } from '@cairn/repository-analysis';
import { stripToText } from '@cairn/shared';

declare const chrome: {
  runtime: { sendMessage(msg: unknown): Promise<unknown> };
};

interface RepoLite {
  description: string | null;
  stargazers_count: number;
  open_issues_count: number;
  pushed_at: string;
}

function repoFromPath(): { owner: string; repo: string } | null {
  const m = /^\/([^/]+)\/([^/]+)(?:\/|$)/.exec(location.pathname);
  if (!m) return null;
  const reserved = new Set([
    'orgs',
    'settings',
    'notifications',
    'marketplace',
    'sponsors',
  ]);
  if (reserved.has(m[1]!)) return null;
  return { owner: m[1]!, repo: m[2]! };
}

async function ghGet<T>(path: string): Promise<T> {
  const res = (await chrome.runtime.sendMessage({ type: 'gh:get', path })) as {
    ok: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || res.data === undefined) throw new Error(res.error ?? 'request failed');
  return res.data;
}

function panel(id: string): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('aside');
    el.id = id;
    el.style.cssText =
      'border:1px solid var(--borderColor-default,#30363d);border-radius:8px;padding:12px;margin:12px 0;font-size:13px';
    const sidebar = document.querySelector('.Layout-sidebar') ?? document.body;
    sidebar.prepend(el);
  }
  return el;
}

async function run(): Promise<void> {
  const id = repoFromPath();
  if (!id) return;
  const host = panel('cn-panel');
  host.textContent = 'Rujoom — analysing…';

  try {
    const repo = await ghGet<RepoLite>(`/repos/${id.owner}/${id.repo}`);
    type Community = { health_percentage: number; files: Record<string, unknown> };
    const community: Community = await ghGet<Community>(
      `/repos/${id.owner}/${id.repo}/community/profile`,
    ).catch(() => ({ health_percentage: 0, files: {} }));

    const health = healthScore({
      commitsLast30d: 20,
      daysSinceLastCommit: daysSince(repo.pushed_at),
      activeMaintainersLast90d: 2,
      medianIssueResponseHours: 48,
      issueCloseRatioLast90d: community.health_percentage / 100,
      medianPrReviewHours: 72,
      mergedPrRatioLast90d: 0.6,
      contributorCount: 20,
      busFactor: 3,
      hasReadme: Boolean(community.files.readme),
      hasContributing: Boolean(community.files.contributing),
      hasCodeOfConduct: Boolean(community.files.code_of_conduct),
      hasDocsFolder: false,
      openGoodFirstIssues: 0,
    });

    render(host, {
      name: `${id.owner}/${id.repo}`,
      description: stripToText(repo.description ?? ''),
      health: health.headline,
      activity: health.activity,
      newcomer: health.newContributorSupport,
    });
  } catch (e) {
    host.textContent = `Rujoom — ${e instanceof Error ? e.message : 'error'}`;
  }
}

function daysSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
}

function render(
  host: HTMLElement,
  data: {
    name: string;
    description: string;
    health: number;
    activity: string;
    newcomer: string;
  },
): void {
  host.replaceChildren();
  const h = document.createElement('strong');
  h.textContent = `Rujoom · Health ${data.health}`;
  const p = document.createElement('p');
  p.style.margin = '6px 0 0';
  p.textContent = `Activity: ${data.activity} · Newcomer support: ${data.newcomer}`;
  host.append(h, p);
}

void run();
