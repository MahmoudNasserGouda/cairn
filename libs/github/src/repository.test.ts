import { MemoryStore } from '@cairn/shared';
import { GithubClient } from './client';
import { collectHealthSignals, fetchRepoOverview } from './repository';

const RESET = String(Math.floor(Date.now() / 1000) + 60);

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '59',
      'x-ratelimit-reset': RESET,
    },
  });
}

const ID = { owner: 'pyqtgraph', repo: 'pyqtgraph' };

/** Routes each health-signal path to a body; `stats` decides the 202 behaviour. */
function healthFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  return async (url: string | URL | Request) => {
    const href = url instanceof Request ? url.url : String(url);
    for (const [fragment, make] of Object.entries(overrides)) {
      if (href.includes(fragment)) return make();
    }
    if (href.includes('/stats/commit_activity')) {
      return json([{ total: 5, week: Math.floor(Date.now() / 1000) - 86400 }]);
    }
    if (href.includes('/contributors')) {
      return json([
        { login: 'a', contributions: 10 },
        { login: 'b', contributions: 5 },
      ]);
    }
    if (href.includes('/community/profile')) {
      return json({ health_percentage: 80, files: { readme: {}, contributing: {} } });
    }
    if (href.includes('/search/issues')) return json({ total_count: 7 });
    if (href.includes('/languages')) return json({ Python: 100 });
    return json({
      full_name: 'pyqtgraph/pyqtgraph',
      description: 'd',
      topics: ['python'],
      language: 'Python',
      pushed_at: new Date().toISOString(),
      open_issues_count: 3,
    });
  };
}

function client(fetchImpl: typeof fetch): GithubClient {
  return new GithubClient({ fetchImpl, cache: new MemoryStore() });
}

describe('collectHealthSignals', () => {
  it('reads the ordinary case', async () => {
    const signals = await collectHealthSignals(client(healthFetch()), ID);
    expect(signals.commitsLast30d).toBe(5);
    expect(signals.contributorCount).toBe(2);
    expect(signals.openGoodFirstIssues).toBe(7);
    expect(signals.hasContributing).toBe(true);
  });

  it('survives the 202 placeholder GitHub returns while computing statistics', async () => {
    // Regression: GitHub answers `/stats/commit_activity` with 202 and a `{}` body
    // the first time anyone asks about a repository. The request *succeeds*, so the
    // per-call `.catch()` never fired, and `{}.slice(-4)` threw
    // "commitActivity.slice is not a function" — which surfaced as a repository that
    // simply would not open. Discovery makes this the common path, because it
    // recommends repositories nobody has looked at before.
    const signals = await collectHealthSignals(
      client(
        healthFetch({
          '/stats/commit_activity': () => json({}, 202),
          '/contributors': () => json({}, 202),
        }),
      ),
      ID,
    );
    expect(signals.commitsLast30d).toBe(0);
    expect(signals.contributorCount).toBe(0);
    expect(signals.busFactor).toBe(0);
    // The rest of the signals still come through.
    expect(signals.openGoodFirstIssues).toBe(7);
    expect(signals.hasReadme).toBe(true);
  });

  it('still degrades when a statistics request outright fails', async () => {
    const signals = await collectHealthSignals(
      client(healthFetch({ '/stats/commit_activity': () => json({}, 500) })),
      ID,
    );
    expect(signals.commitsLast30d).toBe(0);
    expect(signals.daysSinceLastCommit).toBe(365);
  });
});

describe('the 202 placeholder is never cached', () => {
  it('re-requests statistics instead of serving the placeholder for the whole TTL', async () => {
    // Caching `{}` under the 6-hour commit-activity TTL would pin a repository at
    // "no activity" for hours after GitHub finished computing the real series.
    let calls = 0;
    let ready = false;
    const fetchImpl = async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href.includes('/stats/commit_activity')) {
        calls++;
        return ready
          ? json([{ total: 9, week: Math.floor(Date.now() / 1000) }])
          : json({}, 202);
      }
      return json([]);
    };

    const gh = client(fetchImpl);
    const path = '/repos/a/b/stats/commit_activity';
    await gh.get(path, { ttlMs: 6 * 60 * 60 * 1000 });
    ready = true;
    const second = await gh.get(path, { ttlMs: 6 * 60 * 60 * 1000 });

    expect(calls).toBe(2);
    expect(second).toEqual([{ total: 9, week: expect.any(Number) }]);
  });
});

describe('fetchRepoOverview', () => {
  it('keeps taxonomy topics and drops the rest', async () => {
    const overview = await fetchRepoOverview(client(healthFetch()), ID);
    expect(overview.fullName).toBe('pyqtgraph/pyqtgraph');
    expect(overview.technologies).toContain('python');
  });
});
