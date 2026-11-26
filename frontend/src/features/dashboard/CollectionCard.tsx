import { Link } from 'react-router-dom'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'

/**
 * How much of the rent is in: confirmed money (verified UPI + cash), UPI still waiting for the bank statement
 * (provisional), and what residents still owe. All amounts in paise from the API; only the percentage is derived.
 */
export function CollectionCard({
  confirmedPaise,
  provisionalPaise,
  duePaise,
  dueCount,
}: {
  confirmedPaise: number
  provisionalPaise: number
  duePaise: number
  dueCount: number
}) {
  const received = confirmedPaise + provisionalPaise
  const expected = received + duePaise
  if (expected <= 0) return null
  const pct = (n: number) => (n / expected) * 100
  const receivedPct = Math.round(pct(received))

  return (
    <Card aria-label="Rent collection">
      <CardHeader
        title="Rent collection"
        description="Received this period against what residents still owe"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/owner/money">Who owes</Link>
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[15px] text-muted">
            <Money paise={received} className="text-[24px] font-bold tracking-[-0.02em] text-ink" /> received of{' '}
            <Money paise={expected} className="font-semibold text-ink" />
          </p>
          <span className="text-[22px] font-bold text-ink tabular-nums" aria-label={`${receivedPct} percent received`}>
            {receivedPct}%
          </span>
        </div>

        <div
          role="img"
          aria-label={`Collection: ${receivedPct}% received, ${100 - receivedPct}% still due`}
          className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3"
        >
          <span className="h-full bg-brand" style={{ width: `${pct(confirmedPaise)}%` }} />
          <span className="h-full bg-[color-mix(in_oklab,var(--brand)_45%,var(--surface))]" style={{ width: `${pct(provisionalPaise)}%` }} />
        </div>

        <dl className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-brand" />
            <dt className="text-muted">Confirmed</dt>
            <dd className="ml-auto font-semibold text-ink sm:ml-1">
              <Money paise={confirmedPaise} />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-[color-mix(in_oklab,var(--brand)_45%,var(--surface))]" />
            <dt className="text-muted">UPI to verify</dt>
            <dd className="ml-auto font-semibold text-ink sm:ml-1">
              <Money paise={provisionalPaise} />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-surface-3 ring-1 ring-line-strong" />
            <dt className="text-muted">Still due · {dueCount}</dt>
            <dd className="ml-auto font-semibold text-danger-ink sm:ml-1">
              <Money paise={duePaise} />
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  )
}
