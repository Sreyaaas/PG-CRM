import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, Download, RefreshCw, X } from 'lucide-react'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { useAuth } from '@/features/auth/AuthContext'
import { useInstallPrompt } from '@/features/settings/installPrompt'
import { restoreCache, startCachePersist } from './cachePersist'
import { useOnlineStatus, useQueueItems } from './hooks'
import type { QueueItem } from './retryQueue'
import { retryQueue } from './transport'
import { UpdatePromptContainer } from './UpdatePromptContainer'

const FLUSH_INTERVAL_MS = 5_000
const INSTALL_DISMISSED_KEY = 'pgcrm_install_dismissed'

/** Wires the signed-in user to the retry queue and the persisted query cache. Renders nothing. */
export function OfflineSync() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.me.id ?? null
  const orgId = session?.orgId ?? null

  useEffect(() => {
    if (!userId || !orgId) {
      retryQueue.setContext(null)
      return
    }
    retryQueue.setContext({ userId, orgId })
    let cancelled = false
    let stopPersist: (() => void) | null = null

    void (async () => {
      await restoreCache(queryClient, userId)
      if (cancelled) return
      stopPersist = startCachePersist(queryClient, userId)
      await retryQueue.load()
      if (!cancelled) void retryQueue.flush()
    })()

    const flush = () => void retryQueue.flush()
    // The connection just came back: retry now instead of waiting out the backoff.
    const flushNow = () => void retryQueue.flush({ force: true })
    const unsubscribeSynced = retryQueue.onSynced(() => {
      void queryClient.invalidateQueries()
    })
    window.addEventListener('online', flushNow)
    const interval = window.setInterval(flush, FLUSH_INTERVAL_MS)

    return () => {
      cancelled = true
      stopPersist?.()
      unsubscribeSynced()
      window.removeEventListener('online', flushNow)
      window.clearInterval(interval)
    }
  }, [userId, orgId, queryClient])

  return null
}

function itemStatusText(item: QueueItem): string {
  if (item.status === 'failed') return item.error ?? 'The server rejected this entry'
  if (item.status === 'needs_photo_upload') return 'Needs photo upload'
  return 'Waiting to sync'
}

function PendingSheet({ open, onClose, items }: { open: boolean; onClose: () => void; items: readonly QueueItem[] }) {
  const online = useOnlineStatus()
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pending sync"
      description="Saved on this phone. They send automatically when you are back online and are never recorded twice."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={!online || items.length === 0}
            onClick={() => void retryQueue.flush({ force: true })}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry now
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="text-[14px] text-muted">Everything is synced.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold text-ink">{item.label}</div>
                <div className="text-[13px] text-muted">
                  {typeof item.body.amount_paise === 'number' && (
                    <>
                      <Money paise={item.body.amount_paise} />
                      {' · '}
                    </>
                  )}
                  <span className={item.status === 'failed' ? 'text-danger-ink' : undefined}>
                    {itemStatusText(item)}
                  </span>
                </div>
              </div>
              <Button type="button" size="sm" variant="danger" onClick={() => void retryQueue.cancel(item.id)}>
                Discard
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

/** "You're offline" banner plus the "Pending sync (n)" button. Sits at the very top of every screen. */
export function OfflineStrip() {
  const online = useOnlineStatus()
  const items = useQueueItems()
  const [open, setOpen] = useState(false)
  const count = items.length

  if (online && count === 0 && !open) return null

  return (
    <>
      <div
        data-testid="offline-strip"
        className="safe-x flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-warning-soft py-2 text-[13.5px] text-warning-ink print:hidden"
      >
        {!online && (
          <p role="status" className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
            <CloudOff className="size-4 shrink-0" aria-hidden="true" />
            <span>
              You&apos;re offline
              <span className="font-normal"> · showing the last saved data</span>
            </span>
          </p>
        )}
        {count > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-chip border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink tabular-nums"
          >
            Pending sync ({count})
          </button>
        )}
      </div>
      <PendingSheet open={open} onClose={() => setOpen(false)} items={items} />
    </>
  )
}

/** Custom install prompt for signed-in staff. Dismissing it is remembered on this device. */
export function InstallBanner() {
  const { session } = useAuth()
  const { canInstall, isStandalone, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })

  if (!session || !canInstall || isStandalone || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
    } catch {
      // Private mode: it only stays hidden for this visit.
    }
  }

  return (
    <div className="safe-x border-b border-line bg-surface-2 py-2 print:hidden">
      <Notice tone="info" role="region" aria-label="Install app" className="items-center">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[13.5px]">Install NivasOS on your home screen for one-tap access.</span>
          <Button
            type="button"
            size="sm"
            variant="brand"
            onClick={() => {
              void promptInstall()
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            Install
          </Button>
          <button
            type="button"
            aria-label="Dismiss install prompt"
            onClick={dismiss}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </Notice>
    </div>
  )
}

export function OfflineLayer() {
  return (
    <>
      <OfflineSync />
      <OfflineStrip />
      <InstallBanner />
      <UpdatePromptContainer />
    </>
  )
}
