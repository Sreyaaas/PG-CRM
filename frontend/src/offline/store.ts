/**
 * Tiny IndexedDB key-value wrapper (no extra library). Two object stores:
 *  - `queue`: pending writes (FE-51 retry queue), keyed by item id
 *  - `meta`: the persisted TanStack Query cache and its owner
 * A memory implementation backs unit tests (jsdom has no IndexedDB).
 */
export type StoreName = 'queue' | 'meta'

export interface OfflineStore {
  getAll<T>(store: StoreName): Promise<T[]>
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  clearAll(): Promise<void>
}

const DB_NAME = 'pgcrm-offline'
const DB_VERSION = 1

export function createIdbStore(): OfflineStore {
  let dbPromise: Promise<IDBDatabase> | null = null

  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('queue')
        req.result.createObjectStore('meta')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error ?? new Error('Could not open IndexedDB'))
      }
    })
    return dbPromise
  }

  // Resolves with the request result once the whole transaction has committed.
  const run = async <T>(
    store: StoreName,
    mode: IDBTransactionMode,
    fn: (os: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode)
      const req = fn(tx.objectStore(store))
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  }

  return {
    getAll: <T>(store: StoreName) => run<T[]>(store, 'readonly', (os) => os.getAll()),
    get: <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (os) => os.get(key)),
    put: async (store, key, value) => {
      await run(store, 'readwrite', (os) => os.put(value, key))
    },
    delete: async (store, key) => {
      await run(store, 'readwrite', (os) => os.delete(key))
    },
    clearAll: async () => {
      await run('queue', 'readwrite', (os) => os.clear())
      await run('meta', 'readwrite', (os) => os.clear())
    },
  }
}

export function createMemoryStore(): OfflineStore {
  const data: Record<StoreName, Map<string, unknown>> = { queue: new Map(), meta: new Map() }
  return {
    getAll: async <T>(store: StoreName) => [...data[store].values()] as T[],
    get: async <T>(store: StoreName, key: string) => data[store].get(key) as T | undefined,
    put: async (store, key, value) => {
      data[store].set(key, value)
    },
    delete: async (store, key) => {
      data[store].delete(key)
    },
    clearAll: async () => {
      data.queue.clear()
      data.meta.clear()
    },
  }
}

let defaultStore: OfflineStore | null = null

/** IndexedDB when the browser has it, otherwise memory (tests, very old WebViews). */
export function getOfflineStore(): OfflineStore {
  defaultStore ??= typeof indexedDB !== 'undefined' ? createIdbStore() : createMemoryStore()
  return defaultStore
}

export function setOfflineStoreForTest(store: OfflineStore | null): void {
  defaultStore = store
}
