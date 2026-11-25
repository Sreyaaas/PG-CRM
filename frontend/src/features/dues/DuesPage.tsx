import { useState } from 'react'
import { FilePlus2, HandCoins } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { Avatar, EmptyState, ListRow, LoadingRows, Notice, PageHeader, ROW_LINK, StatTile } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { usePropertiesQuery } from '@/features/properties/api'
import { getErrorMessage } from '@/features/residents/api'
import { useDuesQuery, useGenerateInvoices, type DueRow } from './api'

function overdueLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} overdue`
}

function DueRowItem({ row, base }: { row: DueRow; base: string }) {
  const overdue = row.days_overdue > 0
  return (
    <li data-testid="due-row">
      <Link to={`${base}/residents/${row.resident_id}/ledger`} className={ROW_LINK}>
        <ListRow
          leading={<Avatar name={row.full_name} />}
          title={row.full_name}
          meta={row.bed_label ?? 'Moved out'}
          trailing={
            <div className="flex flex-col items-end">
              <Money paise={row.outstanding_paise} className="text-[14.5px] font-semibold text-ink" />
              <span
                className={overdue ? 'text-[12.5px] font-medium text-danger-ink' : 'text-[12.5px] text-muted'}
                data-testid="due-status"
              >
                {overdue ? (
                  overdueLabel(row.days_overdue)
                ) : (
                  <>
                    due by <DateText value={row.oldest_due_date} />
                  </>
                )}
              </span>
            </div>
          }
        />
      </Link>
    </li>
  )
}

export function DuesPage() {
  const { pathname } = useLocation()
  const { membership } = useAuth()
  const { showToast } = useToast()
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const base = pathname.startsWith('/owner') ? '/owner' : '/caretaker'
  const isOwner = membership?.role === 'owner'

  const properties = usePropertiesQuery()
  const dues = useDuesQuery(propertyId)
  const generate = useGenerateInvoices()

  const rows = dues.data ?? []
  const total = rows.reduce((sum, r) => sum + r.outstanding_paise, 0)

  function handleGenerate() {
    generate.mutate(propertyId, {
      onSuccess: (res) =>
        showToast(`Created ${res.created} ${res.created === 1 ? 'invoice' : 'invoices'}`, 'success'),
      onError: (err) => showToast(getErrorMessage(err, 'Unable to create invoices.'), 'error'),
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={isOwner ? 'Money' : 'Payments'}
        description="Residents who owe rent, most overdue first."
        actions={
          isOwner && (
            <>
              <Button asChild variant="secondary">
                <Link to="/owner/money/cash">
                  <HandCoins aria-hidden="true" />
                  Cash in hand
                </Link>
              </Button>
              <Button type="button" variant="secondary" disabled={generate.isPending} onClick={handleGenerate}>
                <FilePlus2 aria-hidden="true" />
                {generate.isPending ? 'Creating invoices…' : "Generate this month's invoices"}
              </Button>
            </>
          )
        }
      />

      {(properties.data?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by building">
          <Chip pressed={propertyId === null} onClick={() => setPropertyId(null)}>
            All buildings
          </Chip>
          {properties.data?.map((p) => (
            <Chip key={p.id} pressed={propertyId === p.id} onClick={() => setPropertyId(p.id)}>
              {p.name}
            </Chip>
          ))}
        </div>
      )}

      {dues.data && (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Total outstanding" value={<Money paise={total} />} highlight={total > 0} />
          <StatTile label="Residents with dues" value={<span className="tabular-nums">{rows.length}</span>} />
        </div>
      )}

      {dues.isError && <Notice role="alert">{getErrorMessage(dues.error, 'Unable to load dues.')}</Notice>}

      <Card className="overflow-hidden" aria-label="Dues">
        {dues.isLoading && <LoadingRows label="Loading dues…" rows={4} />}
        {dues.data && rows.length === 0 && <EmptyState>No one owes anything right now.</EmptyState>}
        {rows.length > 0 && (
          <CardList>
            {rows.map((r) => (
              <DueRowItem key={r.resident_id} row={r} base={base} />
            ))}
          </CardList>
        )}
      </Card>
    </div>
  )
}
