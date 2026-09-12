import { Injectable } from '@angular/core';
import { type KeyValueStore, SCHEMA_VERSION } from '@cairn/shared';

/**
 * IndexedDB-backed KeyValueStore (ADR-0003). String keys, structured-clone values.
 *
 * Two object stores, one connection:
 *
 * - `kv` — ordinary app state: the profile, the scoring target, UI preferences.
 * - `secrets` — the BYOK AI key, and nothing else. ADR-0010 asks for an *isolated*
 *   store, and isolation is what makes "clear all AI data" surgical: it can empty
 *   the key without touching the profile, and a profile reset cannot leave a key
 *   behind. Nothing iterates `secrets` for display and nothing logs it.
 *
 * Both are created in one `onupgradeneeded`, so the version bump that introduced
 * `secrets` leaves existing `kv` data alone.
 */
const DB_NAME = 'cairn';
const KV_STORE = 'kv';
const SECRETS_STORE = 'secrets';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      for (const name of [KV_STORE, SECRETS_STORE]) {
        if (!req.result.objectStoreNames.contains(name))
          req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
  return dbPromise;
}

/** Test seam: drop the cached connection so a fresh fake IndexedDB is picked up. */
export function resetIndexedDbConnection(): void {
  dbPromise = null;
}

abstract class IndexedDbBackedStore implements KeyValueStore {
  protected abstract readonly storeName: string;

  private async tx<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const request = fn(
        db.transaction(this.storeName, mode).objectStore(this.storeName),
      );
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB tx failed'));
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
    return value ?? undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.tx<IDBValidKey>('readwrite', (s) => s.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key));
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = (await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(
      String,
    );
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  async clear(): Promise<void> {
    await this.tx('readwrite', (s) => s.clear());
  }
}

@Injectable({ providedIn: 'root' })
export class IndexedDbStore extends IndexedDbBackedStore {
  protected readonly storeName = KV_STORE;
}

/**
 * The isolated store BYOK keys live in (ADR-0010). Separate injectable rather than a
 * key prefix on `IndexedDbStore`, so a call site cannot reach a secret by accident and
 * `clear()` here means "the AI key, and only the AI key".
 */
@Injectable({ providedIn: 'root' })
export class SecretStore extends IndexedDbBackedStore {
  protected readonly storeName = SECRETS_STORE;
}
