import { Injectable, computed, inject, signal } from '@angular/core';
import { createProvider, type ProviderId } from '@cairn/ai';
import { IndexedDbStore, SecretStore } from '../indexeddb-store';

/**
 * Where the key is kept between page loads (ADR-0010).
 *
 * - `persistent` — the isolated `secrets` object store, so the key survives a reload.
 * - `session` — memory only, for the life of this tab. Nothing is written anywhere.
 */
export type KeyStorageMode = 'persistent' | 'session';

interface AiPreferences {
  readonly provider: ProviderId;
  readonly model: string;
  readonly storage: KeyStorageMode;
}

const PREFS_KEY = 'ai:settings:v1';
const SECRET_KEY = 'ai:key:v1';

export const AI_PROVIDERS: readonly {
  readonly id: ProviderId;
  readonly label: string;
  /** Where the user goes to mint a key. Rendered as text, never fetched. */
  readonly keysUrl: string;
  /**
   * Whether the provider's API answers a request made from a web page.
   *
   * Verified by probing each endpoint from the running app on 2026-09-12: OpenRouter
   * (401) and Gemini (400) both answered a junk-key request, so their CORS headers are
   * there; `api.openai.com` sent no `Access-Control-Allow-Origin` at all and the browser
   * blocked it before it left. ADR-0009 called this and settled the response — document
   * it and prefer OpenRouter. A Rujoom proxy would fix it and is exactly what
   * ADR-0002 forbids.
   */
  readonly browserCallable: boolean;
}[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keysUrl: 'https://openrouter.ai/keys',
    browserCallable: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    keysUrl: 'https://aistudio.google.com/app/apikey',
    browserCallable: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keysUrl: 'https://platform.openai.com/api-keys',
    browserCallable: false,
  },
];

/** The one provider we know answers a browser, used until the user picks otherwise. */
const DEFAULT_PROVIDER: ProviderId = 'openrouter';

function defaultModelFor(id: ProviderId): string {
  return createProvider(id).defaultModel;
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'openai' || value === 'gemini' || value === 'openrouter';
}

/**
 * The user's BYOK settings and the key itself (ADR-0009, ADR-0010).
 *
 * The key is a user secret on the user's device. It goes to the provider the user
 * picked and nowhere else — there is no Rujoom endpoint in the path — and it is never
 * logged, never put in a URL, and never written to LocalStorage. `hasKey()` is the only
 * thing features are meant to read; `peekKey()` exists for `AiService` alone.
 */
@Injectable({ providedIn: 'root' })
export class AiSettingsService {
  private readonly store = inject(IndexedDbStore);
  private readonly secrets = inject(SecretStore);

  private readonly _provider = signal<ProviderId>(DEFAULT_PROVIDER);
  private readonly _model = signal(defaultModelFor(DEFAULT_PROVIDER));
  private readonly _storage = signal<KeyStorageMode>('persistent');
  private readonly _key = signal<string | null>(null);
  private readonly _ready = signal(false);

  readonly provider = this._provider.asReadonly();
  readonly model = this._model.asReadonly();
  readonly storage = this._storage.asReadonly();
  /** False until the stored settings have been read back, so the UI can wait. */
  readonly ready = this._ready.asReadonly();
  readonly hasKey = computed(() => this._key() !== null);

  constructor() {
    void this.restore();
  }

  /** The key, for the one caller that must send it. Never render or log this. */
  peekKey(): string | null {
    return this._key();
  }

  async setProvider(id: ProviderId): Promise<void> {
    if (id === this._provider()) return;
    // A model name only means something to the provider it belongs to, so a provider
    // switch resets it unless the user had typed something of their own.
    const wasDefault = this._model() === defaultModelFor(this._provider());
    this._provider.set(id);
    if (wasDefault) this._model.set(defaultModelFor(id));
    await this.persistPreferences();
  }

  async setModel(model: string): Promise<void> {
    const trimmed = model.trim();
    this._model.set(trimmed.length > 0 ? trimmed : defaultModelFor(this._provider()));
    await this.persistPreferences();
  }

  async setStorageMode(mode: KeyStorageMode): Promise<void> {
    if (mode === this._storage()) return;
    this._storage.set(mode);
    const key = this._key();
    if (mode === 'session') {
      // Downgrading must take the copy on disk with it, immediately.
      await this.secrets.delete(SECRET_KEY);
    } else if (key !== null) {
      await this.secrets.set(SECRET_KEY, key);
    }
    await this.persistPreferences();
  }

  async setKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      await this.clearKey();
      return;
    }
    this._key.set(trimmed);
    if (this._storage() === 'persistent') await this.secrets.set(SECRET_KEY, trimmed);
  }

  async clearKey(): Promise<void> {
    this._key.set(null);
    await this.secrets.delete(SECRET_KEY);
  }

  /**
   * The "clear all AI data" control ADR-0010 requires: the key, the stored settings,
   * and anything cached from a provider response. Nothing outside the AI feature is
   * touched — that is what the isolated `secrets` store buys.
   */
  async clearAll(): Promise<void> {
    this._key.set(null);
    this._provider.set(DEFAULT_PROVIDER);
    this._model.set(defaultModelFor(DEFAULT_PROVIDER));
    this._storage.set('persistent');
    await this.secrets.clear();
    await this.store.delete(PREFS_KEY);
  }

  private async persistPreferences(): Promise<void> {
    const prefs: AiPreferences = {
      provider: this._provider(),
      model: this._model(),
      storage: this._storage(),
    };
    await this.store.set(PREFS_KEY, prefs);
  }

  private async restore(): Promise<void> {
    try {
      const prefs = await this.store.get<Partial<AiPreferences>>(PREFS_KEY);
      if (prefs) {
        if (isProviderId(prefs.provider)) this._provider.set(prefs.provider);
        if (typeof prefs.model === 'string' && prefs.model.length > 0) {
          this._model.set(prefs.model);
        }
        if (prefs.storage === 'session') this._storage.set('session');
      }
      if (this._storage() === 'persistent') {
        const key = await this.secrets.get<string>(SECRET_KEY);
        if (typeof key === 'string' && key.length > 0) this._key.set(key);
      }
    } catch {
      // Unreadable settings are not worth an error banner — the user re-enters a key
      // and the feature works again. Never surface storage internals here.
    } finally {
      this._ready.set(true);
    }
  }
}
