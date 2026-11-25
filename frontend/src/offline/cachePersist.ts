import { dehydrate, hydrate, type DehydratedState, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { getOfflineStore, type OfflineStore } from './store'

const CACHE_KEY = 'query-cache'
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const WRITE_DELAY_MS = 1_000

interface PersistedCache {
  userId: string
  savedAt: number
  state: DehydratedState
}

// Bumped by clearOfflineData so a debounced write that was already scheduled cannot bring old data back.
let epoch = 0

/**
 * Staff data only. Anything fetched without signing in (the public join page) and anything that carries
 * KYC details or signed KYC photo URLs (resident detail, check-in detail) is never written to disk.
 */
export function isPersistableQuery(queryKey: QueryKey): boolean {
  const head = String(queryKey[0] ?? '')
  if (head.startsWith('public') || head === 'health' || head === 'resident') return false
  if (head === 'onboarding-requests' && queryKey.includes('detail')) return false
  return true
}

export async function restoreCache(
  queryClient: QueryClient,
  userId: string,
  store: OfflineStore = getOfflineStore(),
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const saved = await store.get<PersistedCache>('meta', CACHE_KEY)
    if (!saved) return false
    if (saved.userId !== userId || now - saved.savedAt > MAX_AGE_MS) {
      await store.delete('meta', CACHE_KEY)
      return false
    }
    hydrate(queryClient, saved.state)
    return true
  } catch {
    return false
  }
}

/** Saves successful staff queries to IndexedDB (debounced) until the returned stop function is called. */
export function startCachePersist(
  queryClient: QueryClient,
  userId: string,
  store: OfflineStore = getOfflineStore(),
  delayMs: number = WRITE_DELAY_MS,
): () => void {
  const startedEpoch = epoch
  let timer: ReturnType<typeof setTimeout> | null = null

  const write = async () => {
    timer = null
    if (startedEpoch !== epoch) return
    try {
      const state = dehydrate(queryClient, {
        shouldDehydrateQuery: (q) => q.state.status === 'success' && isPersistableQuery(q.queryKey),
      })
      if (state.queries.length === 0) return
      const record: PersistedCache = { userId, savedAt: Date.now(), state }
      await store.put('meta', CACHE_KEY, JSON.parse(JSON.stringify(record)) as PersistedCache)
    } catch {
      // Storage full or blocked: the app keeps working from memory.
    }
  }

  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    timer ??= setTimeout(() => void write(), delayMs)
  })

  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  }
}

/** Logout: wipes the persisted cache and the retry queue's storage. */
export async function clearOfflineData(store: OfflineStore = getOfflineStore()): Promise<void> {
  epoch += 1
  await store.clearAll()
}
