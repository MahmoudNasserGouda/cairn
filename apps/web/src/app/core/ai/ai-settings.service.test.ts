import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MemoryStore } from '@cairn/shared';
import { IndexedDbStore, SecretStore } from '../indexeddb-store';
import { AI_PROVIDERS, AiSettingsService } from './ai-settings.service';

const PREFS_KEY = 'ai:settings:v1';
const SECRET_KEY = 'ai:key:v1';

/** Let the service's async restore / persist settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function make(seed?: { prefs?: unknown; key?: string }) {
  const kv = new MemoryStore();
  const secrets = new MemoryStore();
  const setup = Promise.all([
    seed?.prefs ? kv.set(PREFS_KEY, seed.prefs) : Promise.resolve(),
    seed?.key ? secrets.set(SECRET_KEY, seed.key) : Promise.resolve(),
  ]);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IndexedDbStore, useValue: kv },
      { provide: SecretStore, useValue: secrets },
    ],
  });
  return { kv, secrets, setup };
}

beforeEach(() => {
  TestBed.resetTestingModule();
  localStorage.clear();
});

describe('key storage', () => {
  it('keeps the key in the isolated secrets store, never in kv or LocalStorage', async () => {
    const { kv, secrets } = make();
    const svc = TestBed.inject(AiSettingsService);
    await flush();

    await svc.setKey('sk-test-secret-value');

    expect(await secrets.get(SECRET_KEY)).toBe('sk-test-secret-value');
    expect(await kv.keys()).not.toContain(SECRET_KEY);
    expect(JSON.stringify(localStorage)).not.toContain('sk-test-secret-value');
    expect(svc.hasKey()).toBe(true);
  });

  it('writes nothing at all in session-only mode', async () => {
    const { secrets } = make();
    const svc = TestBed.inject(AiSettingsService);
    await flush();

    await svc.setStorageMode('session');
    await svc.setKey('sk-session-only');

    expect(await secrets.keys()).toEqual([]);
    // Still usable for this tab — it just does not outlive it.
    expect(svc.hasKey()).toBe(true);
    expect(svc.peekKey()).toBe('sk-session-only');
  });

  it('takes the persisted copy with it when the user downgrades to session-only', async () => {
    const { secrets } = make();
    const svc = TestBed.inject(AiSettingsService);
    await flush();

    await svc.setKey('sk-was-persisted');
    expect(await secrets.get(SECRET_KEY)).toBe('sk-was-persisted');

    await svc.setStorageMode('session');
    expect(await secrets.get(SECRET_KEY)).toBeUndefined();
    expect(svc.hasKey()).toBe(true);
  });

  it('an empty key clears rather than storing blank', async () => {
    const { secrets } = make();
    const svc = TestBed.inject(AiSettingsService);
    await flush();

    await svc.setKey('sk-something');
    await svc.setKey('   ');

    expect(svc.hasKey()).toBe(false);
    expect(await secrets.get(SECRET_KEY)).toBeUndefined();
  });
});

describe('restore', () => {
  it('brings back a persisted key and preferences', async () => {
    const { setup } = make({
      prefs: { provider: 'gemini', model: 'gemini-1.5-pro', storage: 'persistent' },
      key: 'sk-restored',
    });
    await setup;

    const svc = TestBed.inject(AiSettingsService);
    await flush();

    expect(svc.provider()).toBe('gemini');
    expect(svc.model()).toBe('gemini-1.5-pro');
    expect(svc.peekKey()).toBe('sk-restored');
  });

  it('does not load a stored key when the mode says session-only', async () => {
    const { setup } = make({
      prefs: { provider: 'openai', model: 'gpt-4o-mini', storage: 'session' },
      key: 'sk-should-not-load',
    });
    await setup;

    const svc = TestBed.inject(AiSettingsService);
    await flush();

    expect(svc.hasKey()).toBe(false);
  });

  it('ignores a provider id it does not recognise', async () => {
    const { setup } = make({ prefs: { provider: 'anthropic-made-up', model: '' } });
    await setup;

    const svc = TestBed.inject(AiSettingsService);
    await flush();

    expect(svc.provider()).toBe('openrouter');
  });
});

describe('provider and model', () => {
  it('defaults to a provider the browser can actually call (ADR-0009)', async () => {
    make();
    const svc = TestBed.inject(AiSettingsService);
    await flush();

    // api.openai.com sends no CORS headers, so it cannot be the out-of-the-box choice.
    expect(svc.provider()).toBe('openrouter');
    expect(AI_PROVIDERS.find((p) => p.id === svc.provider())?.browserCallable).toBe(true);
  });

  it('moves the model to the new provider default, unless the user chose one', async () => {
    make();
    const svc = TestBed.inject(AiSettingsService);
    await flush();

    await svc.setProvider('gemini');
    expect(svc.model()).toBe('gemini-1.5-flash');

    await svc.setModel('my-own-model');
    await svc.setProvider('openai');
    expect(svc.model()).toBe('my-own-model');
  });

  it('falls back to the provider default when the model is blanked', async () => {
    make();
    const svc = TestBed.inject(AiSettingsService);
    await flush();

    await svc.setModel('  ');
    expect(svc.model()).toBe('openrouter/auto');
  });
});

describe('clear all AI data', () => {
  it('empties the key and preferences and nothing else', async () => {
    const { kv, secrets } = make();
    await kv.set('profile:cv:v1', { skills: ['typescript'] });

    const svc = TestBed.inject(AiSettingsService);
    await flush();
    await svc.setKey('sk-to-be-cleared');
    await svc.setProvider('gemini');

    await svc.clearAll();

    expect(svc.hasKey()).toBe(false);
    expect(svc.provider()).toBe('openrouter');
    expect(await secrets.keys()).toEqual([]);
    expect(await kv.get(PREFS_KEY)).toBeUndefined();
    // The profile is not AI data.
    expect(await kv.get('profile:cv:v1')).toEqual({ skills: ['typescript'] });
  });
});
