import { GithubClient } from './client';
import { listOpenIssues, toIssueInput } from './issues';
import { MemoryStore } from '@cairn/shared';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    },
  });
}

const ISSUES = [
  {
    number: 10,
    title: 'Real issue',
    body: 'details',
    labels: [{ name: 'good first issue' }, 'bug'],
    comments: 2,
    reactions: { total_count: 5 },
    html_url: 'https://github.com/o/r/issues/10',
  },
  {
    number: 11,
    title: 'A pull request',
    body: null,
    labels: [],
    comments: 0,
    html_url: 'https://github.com/o/r/pull/11',
    pull_request: { url: 'x' },
  },
];

function client(fetchImpl: typeof fetch) {
  return new GithubClient({ fetchImpl, cache: new MemoryStore() });
}

describe('listOpenIssues', () => {
  it('drops pull requests and normalises labels', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      expect(href).toContain('/repos/o/r/issues?state=open');
      return json(ISSUES);
    });
    const out = await listOpenIssues(client(fetchImpl), {
      owner: 'o',
      repo: 'r',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      number: 10,
      title: 'Real issue',
      body: 'details',
      labels: ['good first issue', 'bug'],
      commentCount: 2,
      reactions: 5,
      htmlUrl: 'https://github.com/o/r/issues/10',
    });
  });

  it('passes a label filter through, encoded', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      expect(href).toContain('labels=good%20first%20issue');
      return json([]);
    });
    await listOpenIssues(
      client(fetchImpl),
      {
        owner: 'o',
        repo: 'r',
      },
      { label: 'good first issue' },
    );
  });
});

describe('toIssueInput', () => {
  it('zeroes the fields the list payload lacks', () => {
    expect(
      toIssueInput({
        number: 1,
        title: 't',
        body: 'b',
        labels: ['easy'],
        commentCount: 3,
        reactions: 1,
        htmlUrl: 'u',
      }),
    ).toEqual({
      title: 't',
      body: 'b',
      labels: ['easy'],
      commentCount: 3,
      linkedPrCount: 0,
      participantCount: 0,
      reactions: 1,
    });
  });
});

describe('listOpenIssues pagination past pull requests', () => {
  /** A page of `count` entries, the first `prs` of which are pull requests. */
  function page(start: number, count: number, prs: number): unknown[] {
    return Array.from({ length: count }, (_, i) => ({
      number: start + i,
      title: `item ${start + i}`,
      body: null,
      labels: [],
      comments: 0,
      html_url: 'u',
      ...(i < prs ? { pull_request: { url: 'p' } } : {}),
    }));
  }

  function clientReturning(pages: unknown[][]): {
    client: GithubClient;
    paths: string[];
  } {
    const paths: string[] = [];
    let call = 0;
    const client = {
      async get(path: string) {
        paths.push(path);
        return pages[call++] ?? [];
      },
    } as unknown as GithubClient;
    return { client, paths };
  }

  it('keeps paging when a page is almost entirely pull requests', async () => {
    // Regression: one page of 30 filtered down to a handful — or none — and the UI
    // reported "no open issues" for repositories that plainly had some.
    const { client, paths } = clientReturning([
      page(1, 100, 98), // 2 real issues
      page(101, 100, 95), // 5 real issues
      page(201, 100, 90), // 10 real issues
    ]);
    const issues = await listOpenIssues(
      client,
      { owner: 'a', repo: 'b' },
      {
        perPage: 10,
      },
    );

    expect(issues).toHaveLength(10);
    expect(paths).toHaveLength(3);
    expect(paths[0]).toContain('page=1');
    expect(paths[2]).toContain('page=3');
  });

  it('stops at a short page instead of burning quota on another', async () => {
    const { client, paths } = clientReturning([page(1, 12, 11)]);
    const issues = await listOpenIssues(
      client,
      { owner: 'a', repo: 'b' },
      {
        perPage: 30,
      },
    );

    expect(issues).toHaveLength(1);
    expect(paths).toHaveLength(1);
  });

  it('stops as soon as it has enough issues', async () => {
    const { client, paths } = clientReturning([page(1, 100, 0)]);
    const issues = await listOpenIssues(
      client,
      { owner: 'a', repo: 'b' },
      {
        perPage: 5,
      },
    );

    expect(issues).toHaveLength(5);
    expect(paths).toHaveLength(1);
  });

  it('honours maxPages so a PR-only repo cannot loop', async () => {
    const { client, paths } = clientReturning([
      page(1, 100, 100),
      page(101, 100, 100),
      page(201, 100, 100),
      page(301, 100, 100),
    ]);
    const issues = await listOpenIssues(
      client,
      { owner: 'a', repo: 'b' },
      {
        perPage: 30,
        maxPages: 2,
      },
    );

    expect(issues).toEqual([]);
    expect(paths).toHaveLength(2);
  });
});
