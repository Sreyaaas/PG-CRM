import { useSyncExternalStore } from 'react'
import { retryQueue } from './transport'
import type { QueueItem } from './retryQueue'

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

export function useQueueItems(): readonly QueueItem[] {
  return useSyncExternalStore(retryQueue.subscribe, retryQueue.getSnapshot, retryQueue.getSnapshot)
}
