import { Link } from 'react-router-dom'
import { Money } from '@/components/Money'
import { Card } from '@/components/ui/card'

const PROVISIONAL_FILL = 'bg-[color-mix(in_oklab,var(--brand)_45%,var(--surface))]'

/**
 * The one number an owner opens the app for: how much rent is in. Confirmed money (verified UPI + cash), UPI still
 * waiting for the bank statement, and what residents still owe (when known). Amounts come from the API in paise;
 * only the percentage is derived.
 */
export function CollectionCard({
  confirmedPaise,
  provisionalPaise,
  duePaise,
  dueCount,
}: {
  confirmedPaise: number
  provisionalPaise: number
  /** null when dues couldn't be loaded: the card then shows what came in, without a target. */
  duePaise: number | null
  dueCount: number
}) {
  const received = confirmedPaise + provisionalPaise
  const expected = received + (duePaise ?? 0)
  const hasTarget = duePaise !== null && expected > 0
  const pct = (n: number) => (expected > 0 ? (n / expected) * 100 : 0)
  const receivedPct = Math.round(pct(received))

  return (
    <Card aria-label="Rent collection" className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-muted">Rent received</h2>
          <Money paise={received} className="block text-[28px] font-bold leading-tight tracking-[-0.025em] text-ink" />
          {hasTarget && (
            <p className="text-[13.5px] text-muted">
              of <Money paise={expected} className="font-semibold text-ink" /> expected
            </p>
          )}
        </div>
        {hasTarget && (
          <span
            className="shrink-0 pt-4 text-[26px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums"
            aria-label={`${receivedPct} percent received`}
          >
            {receivedPct}%
          </span>
        )}
      </div>

      {hasTarget && (
        <div
          role="img"
          aria-label={`Collection: ${receivedPct}% received, ${100 - receivedPct}% still due`}
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
        >
          <span className="h-full bg-brand" style={{ width: `${pct(confirmedPaise)}%` }} />
          <span className={`h-full ${PROVISIONAL_FILL}`} style={{ width: `${pct(provisionalPaise)}%` }} />
        </div>
      )}

      <dl className="flex flex-col divide-y divide-line border-t border-line text-[14px]">
        <div className="flex items-center gap-2.5 py-2.5">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-brand" />
          <dt className="text-ink">Collected</dt>
          <dd className="ml-auto font-semibold text-ink tabular-nums">
            <Money paise={confirmedPaise} />
          </dd>
        </div>
        <div className="flex items-center gap-2.5 py-2.5">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${PROVISIONAL_FILL}`} />
          <dt className="text-ink">UPI to verify</dt>
          <dd className="ml-auto font-semibold text-ink tabular-nums">
            <Money paise={provisionalPaise} />
          </dd>
        </div>
        {duePaise !== null && (
          <Link to="/owner/money" className="-mx-1 flex items-center gap-2.5 rounded-control px-1 py-2.5 hover:bg-surface-2 active:bg-surface-2">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-surface-3 ring-1 ring-line-strong" />
            <dt className="text-ink">
              Still due{dueCount > 0 && <span className="text-muted"> · {dueCount} {dueCount === 1 ? 'resident' : 'residents'}</span>}
            </dt>
            <dd className="ml-auto font-semibold text-danger-ink tabular-nums">
              <Money paise={duePaise} />
            </dd>
          </Link>
        )}
      </dl>
    </Card>
  )
}
