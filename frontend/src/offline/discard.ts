import { clearOfflineData } from './cachePersist'
import { retryQueue } from './transport'

/** Logout: drops the persisted query cache and every queued write. */
export async function discardOfflineData(): Promise<void> {
  await clearOfflineData()
  await retryQueue.clear()
}
