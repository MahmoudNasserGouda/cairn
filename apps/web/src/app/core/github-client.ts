import { Injectable, inject } from '@angular/core';
import { GithubClient } from '@cairn/github';
import { AuthService } from './auth/auth.service';
import { IndexedDbStore } from './indexeddb-store';

/**
 * One shared `GithubClient` for the whole app. Bound to the signed-in GitHub token
 * when there is one (higher rate limit, same `gh:` IndexedDB cache), otherwise an
 * unauthenticated client. The instance is rebuilt only when the token changes.
 */
@Injectable({ providedIn: 'root' })
export class GithubClientService {
  private readonly auth = inject(AuthService);
  private readonly store = inject(IndexedDbStore);
  private cached: { token: string | null; client: GithubClient } | null = null;

  get(): GithubClient {
    const token = this.auth.githubToken;
    if (!this.cached || this.cached.token !== token) {
      this.cached = {
        token,
        client: new GithubClient(
          token ? { token, cache: this.store } : { cache: this.store },
        ),
      };
    }
    return this.cached.client;
  }
}
