/**
 * Background service worker (ADR-0014). Mediates GitHub API calls so the content
 * script never holds a token, and owns the local cache. MV3, module worker.
 */
import { GithubClient } from '@cairn/github';
import type { KeyValueStore } from '@cairn/shared';

declare const chrome: {
  storage: {
    local: {
      get(keys: string[] | string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
  runtime: {
    onMessage: {
      addListener(
        cb: (
          msg: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
};

const chromeStore: KeyValueStore = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await chrome.storage.local.get(key))[key] as T | undefined;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async delete(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
  async keys(): Promise<string[]> {
    return Object.keys(await chrome.storage.local.get([]));
  },
  async clear(): Promise<void> {
    /* MV3: intentionally not exposed to content scripts */
  },
};

const client = new GithubClient({ cache: chromeStore });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const request = msg as { type?: string; path?: string };
  if (request.type === 'gh:get' && typeof request.path === 'string') {
    client
      .get(request.path)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e: unknown) =>
        sendResponse({ ok: false, error: e instanceof Error ? e.message : 'failed' }),
      );
    return true; // async response
  }
  return false;
});
