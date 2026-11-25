import { ApiError } from '@/api/client'
import type { OfflineStore } from './store'

/** The only writes that may be queued offline (FE-51). They are the POSTs that accept `Idempotency-Key`. */
export type WriteKind = 'payment' | 'expense' | 'handover'

export interface PhotoUpload {
  blob: Blob
  contentType: string
  propertyId: string
  /** Set once the photo reached storage; the expense body then carries it as `proof_path`. */
  objectKey?: string
}

export type QueueStatus = 'pending' | 'needs_photo_upload' | 'failed'

export interface QueueItem {
  id: string
  kind: WriteKind
  /** Human text for the pending list, e.g. "Cash payment, Room 12". */
  label: string
  /** Generated once, on the first attempt. Every retry re-sends this exact key. */
  idempotencyKey: string
  body: Record<string, unknown>
  photo?: PhotoUpload
  userId: string
  orgId: string
  createdAt: number
  attempts: number
  nextAttemptAt: number
  status: QueueStatus
  error?: string
}

export interface QueueContext {
  userId: string
  orgId: string
}

export interface QueueTransport {
  post(kind: WriteKind, body: Record<string, unknown>, idempotencyKey: string, orgId: string): Promise<unknown>
  /** Uploads the photo and returns the storage `object_key`. */
  uploadPhoto(photo: PhotoUpload, orgId: string): Promise<string>
}

export interface SubmitSpec {
  kind: WriteKind
  label: string
  body: Record<string, unknown>
  photo?: Omit<PhotoUpload, 'objectKey'>
  /**
   * The key a form already sent with a failed attempt. Pass it when handing a write over to the queue after a
   * network error: the first request may have reached the server, and only the same key keeps the retry from
   * recording the money twice.
   */
  idempotencyKey?: string
}

export type SubmitResult = { status: 'sent'; data: unknown } | { status: 'queued'; item: QueueItem }

export interface RetryQueueDeps {
  store: () => OfflineStore
  transport: QueueTransport
  isOnline?: () => boolean
  now?: () => number
  newKey?: () => string
}

const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 60_000

export function backoffDelay(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1))
}

/** A request that never got an answer (offline, DNS, timeout). ApiError means the server answered. */
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof ApiError)
}

function isRetryableServerError(error: ApiError): boolean {
  return error.status >= 500 || error.status === 429 || error.status === 408
}

export class RetryQueue {
  private items: QueueItem[] = []
  private ctx: QueueContext | null = null
  private listeners = new Set<() => void>()
  private syncedListeners = new Set<() => void>()
  private flushing: Promise<number> | null = null
  private readonly deps: Required<RetryQueueDeps>

  constructor(deps: RetryQueueDeps) {
    this.deps = {
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
      now: () => Date.now(),
      newKey: () => crypto.randomUUID(),
      ...deps,
    }
  }

  /* ───────── state for React (useSyncExternalStore) ───────── */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): readonly QueueItem[] => this.items

  /** Called after at least one queued item reached the server (so screens can refetch). */
  onSynced(listener: () => void): () => void {
    this.syncedListeners.add(listener)
    return () => this.syncedListeners.delete(listener)
  }

  private emit(): void {
    this.items = [...this.items]
    for (const l of this.listeners) l()
  }

  /* ───────── lifecycle ───────── */

  setContext(ctx: QueueContext | null): void {
    this.ctx = ctx
  }

  /** Loads persisted items. Items that belong to another user are dropped (never shown or sent). */
  async load(): Promise<void> {
    const store = this.deps.store()
    const stored = await store.getAll<QueueItem>('queue')
    const mine: QueueItem[] = []
    for (const item of stored) {
      if (this.ctx && item.userId !== this.ctx.userId) {
        await store.delete('queue', item.id)
      } else {
        mine.push(item)
      }
    }
    mine.sort((a, b) => a.createdAt - b.createdAt)
    // Keep anything queued while loading.
    const ids = new Set(mine.map((i) => i.id))
    const queuedWhileLoading = this.items.filter((i) => !ids.has(i.id) && (!this.ctx || i.userId === this.ctx.userId))
    this.items = [...mine, ...queuedWhileLoading]
    this.emit()
  }

  /** Logout: forget every queued write. */
  async clear(): Promise<void> {
    this.items = []
    await this.deps.store().clearAll()
    this.emit()
  }

  async cancel(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id)
    await this.deps.store().delete('queue', id)
    this.emit()
  }

  private async save(item: QueueItem): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === item.id)
    if (idx === -1) this.items = [...this.items, item]
    else this.items[idx] = item
    await this.deps.store().put('queue', item.id, item)
    this.emit()
  }

  private async remove(item: QueueItem): Promise<void> {
    this.items = this.items.filter((i) => i.id !== item.id)
    await this.deps.store().delete('queue', item.id)
    this.emit()
  }

  /* ───────── submit (first attempt) ───────── */

  /**
   * Sends a write. A real server answer (success or an API error) is returned/thrown as usual. If the request
   * could not reach the server, it is queued with the SAME idempotency key it was first sent with.
   */
  async submit(spec: SubmitSpec): Promise<SubmitResult> {
    if (!this.ctx) throw new Error('Not signed in')
    const { userId, orgId } = this.ctx
    const now = this.deps.now()
    const item: QueueItem = {
      id: this.deps.newKey(),
      kind: spec.kind,
      label: spec.label,
      idempotencyKey: spec.idempotencyKey ?? this.deps.newKey(),
      body: { ...spec.body },
      photo: spec.photo ? { ...spec.photo } : undefined,
      userId,
      orgId,
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      status: 'pending',
    }

    if (!this.deps.isOnline()) {
      return { status: 'queued', item: await this.park(item, spec.photo ? 'needs_photo_upload' : 'pending') }
    }

    try {
      if (item.photo && !item.photo.objectKey) {
        item.photo.objectKey = await this.deps.transport.uploadPhoto(item.photo, orgId)
        item.body.proof_path = item.photo.objectKey
      }
    } catch (e) {
      if (!isNetworkError(e)) throw e
      return { status: 'queued', item: await this.park(item, 'needs_photo_upload') }
    }

    try {
      const data = await this.deps.transport.post(item.kind, item.body, item.idempotencyKey, orgId)
      return { status: 'sent', data }
    } catch (e) {
      if (!isNetworkError(e)) throw e
      return { status: 'queued', item: await this.park(item, 'pending') }
    }
  }

  private async park(item: QueueItem, status: QueueStatus): Promise<QueueItem> {
    const parked: QueueItem = {
      ...item,
      status: item.photo && !item.photo.objectKey ? 'needs_photo_upload' : status,
      attempts: 1,
      nextAttemptAt: this.deps.now() + backoffDelay(1),
    }
    await this.save(parked)
    return parked
  }

  /* ───────── flush (retries) ───────── */

  /** Retries due items now. Single-flight. Returns how many reached the server. */
  flush(opts: { force?: boolean } = {}): Promise<number> {
    this.flushing ??= this.runFlush(opts.force ?? false).finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async runFlush(force: boolean): Promise<number> {
    if (!this.ctx || !this.deps.isOnline()) return 0
    const { userId, orgId } = this.ctx
    let synced = 0

    const due = this.items
      .filter((i) => i.userId === userId && i.orgId === orgId && i.status !== 'failed')
      .filter((i) => force || i.nextAttemptAt <= this.deps.now())
      .sort((a, b) => a.createdAt - b.createdAt)

    for (const original of due) {
      // The user may have cancelled it while an earlier item was in flight.
      if (!this.items.some((i) => i.id === original.id)) continue
      let item = original
      try {
        if (item.photo && !item.photo.objectKey) {
          const objectKey = await this.deps.transport.uploadPhoto(item.photo, orgId)
          item = {
            ...item,
            photo: { ...item.photo, objectKey },
            body: { ...item.body, proof_path: objectKey },
            status: 'pending',
          }
          await this.save(item)
        }
        await this.deps.transport.post(item.kind, item.body, item.idempotencyKey, orgId)
        await this.remove(item)
        synced += 1
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) break // signed out; keep the item for the next login
        if (!(e instanceof ApiError) || isRetryableServerError(e)) {
          const attempts = item.attempts + 1
          await this.save({ ...item, attempts, nextAttemptAt: this.deps.now() + backoffDelay(attempts) })
          if (!(e instanceof ApiError)) break // still no network: later items would fail too
          continue
        }
        // The server answered and refused it (validation, permission, conflict). Retrying cannot help.
        await this.save({ ...item, status: 'failed', error: e.message })
      }
    }

    if (synced > 0) for (const l of this.syncedListeners) l()
    return synced
  }
}
