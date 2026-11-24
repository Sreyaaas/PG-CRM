import { useState } from 'react'
import type { components } from '@/api/schema'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'

export type DiscountRequest = components['schemas']['DiscountRequest']

const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
})

interface Props {
  request: DiscountRequest
  busy: boolean
  onDecide: (decision: 'approved' | 'rejected', note?: string) => void
}

export function DiscountRequestCard({ request: r, busy, onDecide }: Props) {
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const noteId = `reject-note-${r.id}`
  const cut = r.difference_paise >= 0

  return (
    <li className="rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5" data-testid="discount-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ink">
            {r.property_name} · {r.bed_label}
          </div>
          {r.resident_name && <div className="truncate text-[12.5px] text-muted">{r.resident_name}</div>}
        </div>
        <span className="shrink-0 text-[12.5px] text-muted">Discount</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-[14px]">
        <div>
          <dt className="text-[12.5px] text-muted">Floor rent</dt>
          <dd className="font-medium text-ink">
            <Money paise={r.base_rent_paise} />
          </dd>
        </div>
        <div>
          <dt className="text-[12.5px] text-muted">Requested rent</dt>
          <dd className="font-medium text-ink">
            <Money paise={r.requested_rent_paise} />
          </dd>
        </div>
      </dl>
      <div className="mt-2 text-[14px] font-semibold tabular-nums font-medium text-danger-ink" data-testid="discount-diff">
        {cut ? '−' : '+'}
        <Money paise={Math.abs(r.difference_paise)} />
        /month
      </div>

      <p className="mt-3 text-[14px] text-ink">{r.reason}</p>
      <p className="mt-1 text-[12.5px] text-muted">
        {r.requested_by_name} · <DateText value={r.created_at} />{' '}
        <span className="tabular-nums">{TIME_FORMATTER.format(new Date(r.created_at))}</span>
      </p>

      {rejecting ? (
        <div className="mt-4 space-y-2">
          <label htmlFor={noteId} className="block text-[14px] font-medium text-ink">
            Note (optional)
          </label>
          <Textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              
              onClick={() => onDecide('rejected', note)}
            >
              Confirm reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            
            onClick={() => setRejecting(true)}
          >
            Reject
          </Button>
          <Button
            type="button"
            disabled={busy}
            
            onClick={() => onDecide('approved')}
          >
            Approve
          </Button>
        </div>
      )}
    </li>
  )
}
