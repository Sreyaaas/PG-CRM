import { useState } from 'react'
import type { components } from '@/api/schema'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'

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
    <li className="rounded-lg border border-slate-200 bg-white p-4" data-testid="discount-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">
            {r.property_name} · {r.bed_label}
          </div>
          {r.resident_name && <div className="truncate text-xs text-slate-500">{r.resident_name}</div>}
        </div>
        <span className="shrink-0 text-xs text-slate-500">Discount</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Floor rent</dt>
          <dd className="font-medium text-slate-950">
            <Money paise={r.base_rent_paise} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Requested rent</dt>
          <dd className="font-medium text-slate-950">
            <Money paise={r.requested_rent_paise} />
          </dd>
        </div>
      </dl>
      <div className="mt-2 text-sm font-semibold tabular-nums text-red-700" data-testid="discount-diff">
        {cut ? '−' : '+'}
        <Money paise={Math.abs(r.difference_paise)} />
        /month
      </div>

      <p className="mt-3 text-sm text-slate-700">{r.reason}</p>
      <p className="mt-1 text-xs text-slate-500">
        {r.requested_by_name} · <DateText value={r.created_at} />{' '}
        <span className="tabular-nums">{TIME_FORMATTER.format(new Date(r.created_at))}</span>
      </p>

      {rejecting ? (
        <div className="mt-4 space-y-2">
          <label htmlFor={noteId} className="block text-sm font-medium text-slate-700">
            Note (optional)
          </label>
          <textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="h-11"
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              className="h-11 bg-slate-900 text-white hover:bg-slate-800"
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
            variant="outline"
            disabled={busy}
            className="h-11"
            onClick={() => setRejecting(true)}
          >
            Reject
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="h-11 bg-slate-900 text-white hover:bg-slate-800"
            onClick={() => onDecide('approved')}
          >
            Approve
          </Button>
        </div>
      )}
    </li>
  )
}
