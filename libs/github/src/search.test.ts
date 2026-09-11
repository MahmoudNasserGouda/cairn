import { GithubClient } from './client';
import { searchRepositories } from './search';
import { MemoryStore } from '@cairn/shared';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '30',
      'x-ratelimit-remaining': '29',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
    },
  });
}

const RESPONSE = {
  items: [
    {
      full_name: 'sveltejs/svelte',
      description: 'web language',
      topics: ['Web', 'compiler'],
      language: 'JavaScript',
      stargazers_count: 79000,
    },
    {
      full_name: 'acme/thing',
      description: null,
      language: null,
      stargazers_count: 3,
    },
  ],
};

function client(fetchImpl: typeof fetch) {
  return new GithubClient({ fetchImpl, cache: new MemoryStore() });
}

describe('searchRepositories', () => {
  it('short-circuits an empty query without a call', async () => {
    const fetchImpl = vi.fn(async () => json(RESPONSE));
    const out = await searchRepositories(client(fetchImpl), '  ');
    expect(out).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('encodes the query and maps results', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      expect(href).toContain('/search/repositories?q=state%20machine');
      expect(href).toContain('sort=stars');
      expect(href).toContain('per_page=10');
      return json(RESPONSE);
    });
    const out = await searchRepositories(client(fetchImpl), 'state machine');
    expect(out[0]).toEqual({
      fullName: 'sveltejs/svelte',
      owner: 'sveltejs',
      repo: 'svelte',
      description: 'web language',
      stars: 79000,
      primaryLanguage: 'javascript',
      // `web` and `compiler` are real GitHub topics but not technologies in the
      // taxonomy, so they are filtered out — see the `toKnownSkills` note in
      // `fetchRepoOverview`.
      topics: [],
    });
    expect(out[1]).toMatchObject({ description: '', primaryLanguage: null, topics: [] });
  });

  it('keeps topics that are real technologies and canonicalises them', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        items: [
          {
            full_name: 'a/b',
            description: null,
            language: 'TypeScript',
            stargazers_count: 1,
            topics: ['nodejs', 'hacktoberfest', 'React'],
          },
        ],
      }),
    );
    const out = await searchRepositories(client(fetchImpl), 'x');
    expect(out[0]?.topics).toEqual(['node', 'react']);
    expect(out[0]?.primaryLanguage).toBe('typescript');
  });

  it('clamps perPage into [1, 100]', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      expect(href).toContain('per_page=100');
      return json(RESPONSE);
    });
    await searchRepositories(client(fetchImpl), 'x', {
      perPage: 999,
    });
  });
});
