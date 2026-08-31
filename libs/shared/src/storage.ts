/**
 * Storage abstraction (ADR-0003). Call sites never touch IndexedDB / LocalStorage
 * directly. `apps/web` provides an IndexedDB-backed implementation; `apps/extension`
 * wraps `chrome.storage.local`; tests use `MemoryStore`.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}

/** Schema/migration hook so persisted data can evolve safely. */
export interface StoreMeta {
  readonly schemaVersion: number;
}

export const SCHEMA_VERSION = 1;

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.map.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}
