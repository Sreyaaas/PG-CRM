import { useState } from 'react'
import { Check, FilePlus2, HandCoins, MessageCircle, Download } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { Sheet } from '@/components/ui/sheet'
import { Avatar, EmptyState, ListRow, LoadingRows, Notice, PageHeader, ROW_LINK, StatTile } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { useOrgId, usePropertiesQuery } from '@/features/properties/api'
import { getErrorMessage } from '@/features/residents/api'
import { LogPaymentSheet } from '@/features/payments/LogPaymentSheet'
import { downloadCsv, paiseToRupeesText, toCsv, todayIST } from '@/lib/csv'
import { useDuesQuery, useGenerateInvoices, type DueRow } from './api'
import { useReminders } from './reminders'

function overdueLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} overdue`
}

function DueRowItem({
  row,
  base,
  reminded,
  onRemind,
  onLog,
}: {
  row: DueRow
  base: string
  reminded: boolean
  onRemind: (row: DueRow) => void
  onLog: (row: DueRow) => void
}) {
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
      <div className="-mt-1 flex justify-end gap-2 px-4 pb-3 sm:px-5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`${reminded ? 'Remind again' : 'Send reminder to'} ${row.full_name}`}
          onClick={() => onRemind(row)}
        >
          {reminded ? <Check aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
          {reminded ? 'Reminded' : 'Remind'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          aria-label={`Log payment for ${row.full_name}`}
          onClick={() => onLog(row)}
        >
          Log payment
        </Button>
      </div>
    </li>
  )
}

function RemindAllSheet({
  open,
  onClose,
  rows,
  isReminded,
  onRemind,
}: {
  open: boolean
  onClose: () => void
  rows: DueRow[]
  isReminded: (residentId: string) => boolean
  onRemind: (row: DueRow) => void
}) {
  const sent = rows.filter((r) => isReminded(r.resident_id)).length
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Remind all overdue"
      description={
        rows.length > 0
          ? `${sent} of ${rows.length} sent. WhatsApp opens one chat at a time.`
          : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No one is overdue.</EmptyState>
      ) : (
        <ul className="-mx-4 divide-y divide-line sm:-mx-5">
          {rows.map((r) => {
            const done = isReminded(r.resident_id)
            return (
              <li key={r.resident_id} data-testid="remind-row" data-sent={done}>
                <ListRow
                  title={r.full_name}
                  meta={
                    <>
                      <Money paise={r.outstanding_paise} /> · {overdueLabel(r.days_overdue)}
                    </>
                  }
                  trailing={
                    <Button
                      type="button"
                      size="sm"
                      variant={done ? 'ghost' : 'secondary'}
                      aria-label={`${done ? 'Send again to' : 'Send reminder to'} ${r.full_name}`}
                      onClick={() => onRemind(r)}
                    >
                      {done ? <Check aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
                      {done ? 'Sent' : 'Send'}
                    </Button>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}

export function DuesPage() {
  const { pathname } = useLocation()
  const { membership } = useAuth()
  const { showToast } = useToast()
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [remindAllOpen, setRemindAllOpen] = useState(false)
  const [logFor, setLogFor] = useState<DueRow | null>(null)
  const orgId = useOrgId()
  const reminders = useReminders(orgId)
  const base = pathname.startsWith('/owner') ? '/owner' : '/caretaker'
  const isOwner = membership?.role === 'owner'

  const properties = usePropertiesQuery()
  const dues = useDuesQuery(propertyId)
  const generate = useGenerateInvoices()

  const rows = dues.data ?? []
  const overdueRows = rows.filter((r) => r.days_overdue > 0)
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
          <>
            {overdueRows.length > 0 && (
              <Button type="button" variant="secondary" onClick={() => setRemindAllOpen(true)}>
                <MessageCircle aria-hidden="true" />
                Remind all overdue
              </Button>
            )}
            {isOwner && (
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
              {rows.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    downloadCsv(
                      `dues-${todayIST()}.csv`,
                      toCsv(rows, [
                        { header: 'Resident', value: (r) => r.full_name },
                        { header: 'Bed', value: (r) => r.bed_label ?? 'Moved out' },
                        { header: 'Phone', value: (r) => r.phone },
                        { header: 'Outstanding (INR)', value: (r) => paiseToRupeesText(r.outstanding_paise) },
                        { header: 'Oldest due date', value: (r) => r.oldest_due_date },
                        { header: 'Days overdue', value: (r) => r.days_overdue },
                      ]),
                    )
                  }
                >
                  <Download aria-hidden="true" />
                  Export CSV
                </Button>
              )}
              </>
            )}
          </>
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
          <StatTile label="Total due" value={<Money paise={total} />} highlight={total > 0} />
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
              <DueRowItem
                key={r.resident_id}
                row={r}
                base={base}
                reminded={reminders.isRemindedToday(r.resident_id)}
                onRemind={(row) => reminders.send(row.resident_id, row.whatsapp_url)}
                onLog={setLogFor}
              />
            ))}
          </CardList>
        )}
      </Card>

      <RemindAllSheet
        open={remindAllOpen}
        onClose={() => setRemindAllOpen(false)}
        rows={overdueRows}
        isReminded={reminders.isRemindedToday}
        onRemind={(row) => reminders.send(row.resident_id, row.whatsapp_url)}
      />
      {logFor && (
        <LogPaymentSheet
          residentId={logFor.resident_id}
          residentName={logFor.full_name}
          outstandingPaise={logFor.outstanding_paise}
          onClose={() => setLogFor(null)}
        />
      )}
    </div>
  )
}
