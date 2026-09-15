/**
 * A minimal GitLab GraphQL client (ADR-0034).
 *
 * Deliberately not a second `GithubClient`. That one carries a response cache, ETag
 * revalidation, in-flight dedupe and a per-resource rate-limit floor, all shaped around
 * GitHub's REST fan-out and its `X-RateLimit-*` headers. GitLab's whole profile read is
 * **one POST per import**, so almost all of that would be inert, and an abstraction
 * built for one real caller and one hypothetical one usually fits neither. If a second
 * GitLab caller ever appears, generalising then will be informed by two real shapes
 * instead of one and a guess.
 *
 * Framework-free, `fetch`-injectable, and the token never appears in an error message.
 */

export const GITLAB_ORIGIN = 'https://gitlab.com';
const GRAPHQL_ENDPOINT = `${GITLAB_ORIGIN}/api/graphql`;

export class GitlabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitlabError';
  }
}

/** Distinct from a generic failure so the UI can say "later", not "broken". */
export class GitlabRateLimitError extends GitlabError {
  /** Unix seconds from `RateLimit-Reset`, when GitLab sent one. */
  readonly resetAt: number | null;
  constructor(message: string, resetAt: number | null) {
    super(message);
    this.name = 'GitlabRateLimitError';
    this.resetAt = resetAt;
  }
}

export interface GitlabClientOptions {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}

interface GraphQLEnvelope<T> {
  readonly data?: T;
  readonly errors?: readonly { readonly message?: string }[];
}

export class GitlabClient {
  private readonly token: string;
  private readonly doFetch: typeof fetch;

  constructor(options: GitlabClientOptions) {
    this.token = options.token;
    this.doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Run one GraphQL query and return its `data`.
   *
   * GraphQL answers `200` with an `errors` array, so checking `res.ok` alone reports
   * success and hands back `undefined` — which surfaces later as an empty profile
   * rather than as a failure, at a point far from the cause.
   */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      // Never re-throw the original: a fetch failure can carry the request in its
      // message, and the request carries the token.
      throw new GitlabError('could not reach GitLab');
    }

    if (res.status === 429) {
      const reset = Number(res.headers.get('ratelimit-reset'));
      throw new GitlabRateLimitError(
        'GitLab is rate limiting this connection; try again shortly',
        Number.isFinite(reset) && reset > 0 ? reset : null,
      );
    }
    if (!res.ok) {
      throw new GitlabError(`GitLab refused the request (${res.status})`);
    }

    let envelope: GraphQLEnvelope<T>;
    try {
      envelope = (await res.json()) as GraphQLEnvelope<T>;
    } catch {
      throw new GitlabError('GitLab returned a response that could not be read');
    }

    const problems = envelope.errors ?? [];
    if (problems.length > 0) {
      const first = problems[0]?.message ?? 'unknown error';
      throw new GitlabError(`GitLab rejected the query: ${first}`);
    }
    if (envelope.data === undefined || envelope.data === null) {
      throw new GitlabError('GitLab returned no data');
    }
    return envelope.data;
  }
}
