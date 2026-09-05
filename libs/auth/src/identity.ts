import { AuthError, type Identity, type OAuthProvider } from './provider';

interface GithubUserBody {
  readonly login: string;
  readonly name: string | null;
  readonly avatar_url: string;
  readonly html_url: string;
  readonly email: string | null;
}

interface OidcUserinfoBody {
  readonly sub: string;
  readonly name?: string;
  readonly preferred_username?: string;
  readonly email?: string;
  readonly picture?: string;
  readonly profile?: string;
}

export interface FetchIdentityOptions {
  readonly provider: OAuthProvider;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Fetch the signed-in user's identity from the provider. Deliberately uncached — the
 * identity is held in memory for the session and re-fetched on the next sign-in
 * (ADR-0020).
 */
export async function fetchIdentity(opts: FetchIdentityOptions): Promise<Identity> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let res: Response;
  try {
    if (opts.provider.identityViaWorker === true) {
      // userInfoUrl has no CORS headers for this provider — relay through
      // cairn-auth instead. Only the access token crosses; no client secret needed.
      if (opts.provider.identityExchangeUrl === undefined) {
        throw new AuthError(`${opts.provider.label} sign-in is misconfigured`);
      }
      res = await doFetch(opts.provider.identityExchangeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token: opts.token }),
      });
    } else {
      const headers: Record<string, string> = {
        accept:
          opts.provider.kind === 'github'
            ? 'application/vnd.github+json'
            : 'application/json',
        authorization: `Bearer ${opts.token}`,
      };
      if (opts.provider.kind === 'github') {
        headers['x-github-api-version'] = '2022-11-28';
      }
      res = await doFetch(opts.provider.userInfoUrl, { headers });
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError(`could not reach ${opts.provider.label}`);
  }
  if (!res.ok) {
    throw new AuthError(
      `could not load your ${opts.provider.label} profile (${res.status})`,
    );
  }

  if (opts.provider.kind === 'github') {
    const u = (await res.json()) as GithubUserBody;
    return {
      provider: 'github',
      subject: u.login,
      displayName: u.name ?? u.login,
      email: u.email ?? null,
      avatarUrl: u.avatar_url,
      profileUrl: u.html_url,
    };
  }

  const u = (await res.json()) as OidcUserinfoBody;
  return {
    provider: opts.provider.id,
    subject: u.sub,
    displayName: u.name ?? u.preferred_username ?? u.email ?? u.sub,
    email: u.email ?? null,
    avatarUrl: u.picture ?? null,
    profileUrl: u.profile ?? null,
  };
}
