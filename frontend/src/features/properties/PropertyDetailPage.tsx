import type { ReactNode } from 'react'
import { BedDouble, ChevronRight, Pencil, QrCode } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { ListRow, LoadingRows, Notice, PageHeader, ROW_LINK } from '@/components/ui/misc'
import { usePropertyQuery } from './api'
import { ActiveBadge } from './ActiveBadge'
import { ConnectSoundboxQr } from './ConnectSoundboxQr'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3 text-[14px] sm:px-5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink tabular-nums">{children}</dd>
    </div>
  )
}

function NavRow({ to, icon, children }: { to: string; icon: ReactNode; children: string }) {
  return (
    <li>
      <Link to={to} className={ROW_LINK}>
        <ListRow
          leading={
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted [&_svg]:size-5">
              {icon}
            </span>
          }
          title={children}
          trailing={<ChevronRight className="size-4 text-subtle" aria-hidden="true" />}
        />
      </Link>
    </li>
  )
}

export function PropertyDetailPage() {
  const { propertyId } = useParams()
  const query = usePropertyQuery(propertyId)

  if (query.isLoading) {
    return (
      <Card>
        <LoadingRows label="Loading property…" />
      </Card>
    )
  }
  if (query.isError || !query.data) {
    return (
      <Notice role="alert">
        {query.error instanceof ApiError ? query.error.message : 'Unable to load property.'}
      </Notice>
    )
  }
  const p = query.data

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        back={{ to: '/owner/properties', label: 'All properties' }}
        title={p.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {p.locality && <span>{p.locality}</span>}
            <ActiveBadge active={p.is_active} />
          </span>
        }
        actions={
          <Button asChild variant="secondary" className="max-sm:flex-1">
            <Link to={`/owner/properties/${p.id}/edit`}>
              <Pencil aria-hidden="true" />
              Edit property
            </Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <CardList>
          <NavRow to={`/owner/properties/${p.id}/rooms`} icon={<BedDouble />}>
            Rooms &amp; beds
          </NavRow>
          <NavRow to={`/owner/properties/${p.id}/poster`} icon={<QrCode />}>
            Reception QR
          </NavRow>
        </CardList>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Billing rules" />
        <dl className="divide-y divide-line">
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
                <span className="break-all font-normal text-muted">{p.upi_vpa}</span>
              </span>
            ) : (
              <span className="font-normal text-muted">Not connected</span>
            )}
          </Row>
        </dl>
      </Card>

      <ConnectSoundboxQr propertyId={p.id} />
    </div>
  )
}
