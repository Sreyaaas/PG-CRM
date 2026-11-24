import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { usePropertyQuery } from './api'
import { ActiveBadge } from './ActiveBadge'
import { ConnectSoundboxQr } from './ConnectSoundboxQr'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-950">{children}</dd>
    </div>
  )
}

export function PropertyDetailPage() {
  const { propertyId } = useParams()
  const query = usePropertyQuery(propertyId)

  if (query.isLoading) return <p className="text-sm text-slate-500">Loading property…</p>
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {query.error instanceof ApiError ? query.error.message : 'Unable to load property.'}
      </div>
    )
  }
  const p = query.data

  return (
    <div className="max-w-xl space-y-5">
      <div className="border-b border-slate-200 pb-4">
        <Link to="/owner/properties" className="text-xs text-slate-500 underline underline-offset-4">
          All properties
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950">{p.name}</h1>
            {p.locality && <p className="text-sm text-slate-500">{p.locality}</p>}
          </div>
          <ActiveBadge active={p.is_active} />
        </div>
        <Button asChild variant="outline" className="mt-3 h-11 w-full sm:w-auto">
          <Link to={`/owner/properties/${p.id}/edit`}>Edit property</Link>
        </Button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white px-4 py-2">
        <dl className="divide-y divide-slate-100">
          <Row label="Rent due by day">{p.rent_due_day}</Row>
          <Row label="Security deposit">
            <Money paise={p.security_deposit_paise} />
          </Row>
          <Row label="Maintenance charge">
            <Money paise={p.maintenance_charge_paise} />
          </Row>
          <Row label="Notice deadline day">{p.notice_deadline_day}</Row>
          <Row label="Exit deduction">
            <Money paise={p.exit_deduction_paise} />
          </Row>
          {p.short_term_daily_rate_paise != null && (
            <Row label="Daily rate">
              <Money paise={p.short_term_daily_rate_paise} />
            </Row>
          )}
          <Row label="Soundbox UPI">
            {p.upi_vpa ? (
              <span>
                {p.upi_payee_name && <span className="block">{p.upi_payee_name}</span>}
                <span className="break-all">{p.upi_vpa}</span>
              </span>
            ) : (
              'Not connected'
            )}
          </Row>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-950">Rooms &amp; beds</h2>
        <Button asChild variant="outline" className="mt-3 h-11 w-full sm:w-auto">
          <Link to={`/owner/properties/${p.id}/rooms`}>Rooms &amp; beds</Link>
        </Button>
      </section>

      <ConnectSoundboxQr propertyId={p.id} />
    </div>
  )
}
