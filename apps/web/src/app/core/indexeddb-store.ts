import { Injectable } from '@angular/core';
import { type KeyValueStore, SCHEMA_VERSION } from '@cairn/shared';

/**
 * IndexedDB-backed KeyValueStore (ADR-0003). One object store, string keys,
 * structured-clone values. Schema version bump triggers onupgradeneeded.
 */
const DB_NAME = 'cairn';
const STORE = 'kv';

@Injectable({ providedIn: 'root' })
export class IndexedDbStore implements KeyValueStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
    return this.dbPromise;
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
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
