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
