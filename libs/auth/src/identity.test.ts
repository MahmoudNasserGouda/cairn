import { fetchIdentity } from './identity';
import { AuthError, type OAuthProvider } from './provider';

const GITHUB: OAuthProvider = {
  id: 'github',
  label: 'GitHub',
  role: 'data',
  kind: 'github',
  clientId: 'Iv1.real',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenExchangeUrl: 'https://auth.example.test/github/token',
  userInfoUrl: 'https://api.github.com/user',
  redirectUri: 'https://app.example.test/',
  scopes: ['read:user'],
};

const GOOGLE: OAuthProvider = {
  ...GITHUB,
  id: 'google',
  label: 'Google',
  role: 'identity',
  kind: 'oidc',
  userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  scopes: ['openid', 'profile', 'email'],
};

const LINKEDIN: OAuthProvider = {
  ...GITHUB,
  id: 'linkedin',
  label: 'LinkedIn',
  role: 'identity',
  kind: 'oidc',
  userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
  identityViaWorker: true,
  identityExchangeUrl: 'https://auth.example.test/linkedin/identity',
  scopes: ['openid', 'profile', 'email'],
};

function json(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchIdentity', () => {
  it('maps a GitHub user and sends the GitHub headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        html_url: 'https://github.com/octocat',
        email: null,
      }),
    );
    const identity = await fetchIdentity({ provider: GITHUB, token: 'gho_x', fetchImpl });
    expect(identity).toEqual({
      provider: 'github',
      subject: 'octocat',
      displayName: 'The Octocat',
      email: null,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      profileUrl: 'https://github.com/octocat',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    expect((init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer gho_x',
    );
    expect((init.headers as Record<string, string>)['x-github-api-version']).toBe(
      '2022-11-28',
    );
  });

  it('maps a direct OIDC userinfo payload, falling back for the display name', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ sub: 'abc123', email: 'a@b.com' }));
    const identity = await fetchIdentity({
      provider: GOOGLE,
      token: 'go_x',
      fetchImpl,
    });
    expect(identity).toEqual({
      provider: 'google',
      subject: 'abc123',
      displayName: 'a@b.com',
      email: 'a@b.com',
      avatarUrl: null,
      profileUrl: null,
    });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
  });

  it('relays through cairn-auth when identityViaWorker is set (LinkedIn: no CORS)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ sub: 'li456', name: 'Lin Person' }));
    const identity = await fetchIdentity({
      provider: LINKEDIN,
      token: 'li_x',
      fetchImpl,
    });
    expect(identity).toEqual({
      provider: 'linkedin',
      subject: 'li456',
      displayName: 'Lin Person',
      email: null,
      avatarUrl: null,
      profileUrl: null,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://auth.example.test/linkedin/identity');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'li_x' });
  });

  it('throws AuthError on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, { status: 401 }));
    await expect(
      fetchIdentity({ provider: GITHUB, token: 'bad', fetchImpl }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
