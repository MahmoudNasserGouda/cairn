/**
 * Stateless OAuth Worker for GitHub, LinkedIn, and Google (ADR-0016, ADR-0024,
 * ADR-0025).
 *
 * Two jobs, both because none of these providers offer a usable public-client PKCE
 * flow from a static origin:
 *
 * 1. `POST /<provider>/token` — turn an authorization `code` into an access token.
 *    Needs the client secret, so it cannot run in the browser. Holds
 *    `<PROVIDER>_CLIENT_ID` (var) and `<PROVIDER>_CLIENT_SECRET` (secret).
 * 2. `POST /<provider>/identity` — relay the `userinfo` call for a provider whose
 *    endpoint sends no CORS headers (LinkedIn). Needs only the access token the
 *    browser already has — no client secret.
 *
 * Stores nothing, logs nothing about request bodies, sets no cookies. If it is down,
 * sign-in fails and the rest of the app still works.
 */

export interface Env {
  readonly ALLOWED_ORIGIN: string;
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly LINKEDIN_CLIENT_ID?: string;
  readonly LINKEDIN_CLIENT_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
}

type ProviderId = 'github' | 'linkedin' | 'google';

interface ProviderConfig {
  readonly tokenUrl: string;
  /** GitHub takes a JSON body; the OIDC providers require form-encoded. */
  readonly encoding: 'json' | 'form';
  readonly clientIdKey: keyof Env;
  readonly clientSecretKey: keyof Env;
  /** Only set for providers whose `userinfo` call is relayed (ADR-0025). */
  readonly userInfoUrl?: string;
}

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  github: {
    tokenUrl: 'https://github.com/login/oauth/access_token',
    encoding: 'json',
    clientIdKey: 'GITHUB_CLIENT_ID',
    clientSecretKey: 'GITHUB_CLIENT_SECRET',
  },
  linkedin: {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    encoding: 'form',
    clientIdKey: 'LINKEDIN_CLIENT_ID',
    clientSecretKey: 'LINKEDIN_CLIENT_SECRET',
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
  },
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    encoding: 'form',
    clientIdKey: 'GOOGLE_CLIENT_ID',
    clientSecretKey: 'GOOGLE_CLIENT_SECRET',
  },
};

interface ExchangeRequest {
  readonly code?: unknown;
  readonly redirect_uri?: unknown;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface IdentityRequest {
  readonly token?: unknown;
}

interface Route {
  readonly provider: ProviderId;
  readonly action: 'token' | 'identity';
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...corsHeaders(env),
    },
  });
}

function parseRoute(pathname: string): Route | null {
  const match = /^\/([a-z]+)\/(token|identity)$/.exec(pathname);
  const id = match?.[1];
  const action = match?.[2];
  if (
    (id === 'github' || id === 'linkedin' || id === 'google') &&
    (action === 'token' || action === 'identity')
  ) {
    return { provider: id, action };
  }
  return null;
}

async function handleToken(
  request: Request,
  env: Env,
  providerId: ProviderId,
): Promise<Response> {
  const provider = PROVIDERS[providerId];
  const clientId = env[provider.clientIdKey];
  const clientSecret = env[provider.clientSecretKey];
  if (
    typeof clientId !== 'string' ||
    clientId.length === 0 ||
    typeof clientSecret !== 'string' ||
    clientSecret.length === 0
  ) {
    return jsonResponse({ error: 'provider_not_configured' }, 501, env);
  }

  let payload: ExchangeRequest;
  try {
    payload = (await request.json()) as ExchangeRequest;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, env);
  }
  if (typeof payload.code !== 'string' || payload.code.length === 0) {
    return jsonResponse({ error: 'missing_code' }, 400, env);
  }
  const redirectUri =
    typeof payload.redirect_uri === 'string' ? payload.redirect_uri : '';

  const fields: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: payload.code,
  };
  if (redirectUri.length > 0) fields['redirect_uri'] = redirectUri;

  const init: RequestInit =
    provider.encoding === 'json'
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(fields),
        }
      : {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body: new URLSearchParams(fields).toString(),
        };

  let upstream: Response;
  try {
    upstream = await fetch(provider.tokenUrl, init);
  } catch {
    return jsonResponse({ error: 'provider_unreachable' }, 502, env);
  }

  let token: TokenResponse;
  try {
    token = (await upstream.json()) as TokenResponse;
  } catch {
    return jsonResponse({ error: 'provider_bad_response' }, 502, env);
  }

  if (token.error !== undefined || token.access_token === undefined) {
    return jsonResponse(
      {
        error: token.error ?? 'exchange_failed',
        error_description: token.error_description,
      },
      400,
      env,
    );
  }

  return jsonResponse(
    {
      access_token: token.access_token,
      token_type: token.token_type ?? 'bearer',
      scope: token.scope ?? '',
    },
    200,
    env,
  );
}

async function handleIdentity(
  request: Request,
  env: Env,
  providerId: ProviderId,
): Promise<Response> {
  const provider = PROVIDERS[providerId];
  if (provider.userInfoUrl === undefined) {
    return jsonResponse({ error: 'not_relayed' }, 404, env);
  }

  let payload: IdentityRequest;
  try {
    payload = (await request.json()) as IdentityRequest;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, env);
  }
  if (typeof payload.token !== 'string' || payload.token.length === 0) {
    return jsonResponse({ error: 'missing_token' }, 400, env);
  }

  let upstream: Response;
  try {
    upstream = await fetch(provider.userInfoUrl, {
      headers: { authorization: `Bearer ${payload.token}`, accept: 'application/json' },
    });
  } catch {
    return jsonResponse({ error: 'provider_unreachable' }, 502, env);
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return jsonResponse({ error: 'provider_bad_response' }, 502, env);
  }
  if (!upstream.ok) {
    return jsonResponse({ error: 'identity_fetch_failed' }, upstream.status, env);
  }
  // Passed through verbatim; the client (libs/auth) maps the OIDC userinfo shape.
  return jsonResponse(body, 200, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, env);
    }
    if (origin !== null && origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: 'origin_not_allowed' }, 403, env);
    }

    const route = parseRoute(new URL(request.url).pathname);
    if (route === null) {
      return jsonResponse({ error: 'unknown_route' }, 404, env);
    }

    return route.action === 'token'
      ? handleToken(request, env, route.provider)
      : handleIdentity(request, env, route.provider);
  },
};
