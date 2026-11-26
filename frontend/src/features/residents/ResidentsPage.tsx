import { useMemo, useState } from 'react'
import { MessageCircle, Search } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { Badge, Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { Avatar, EmptyState, ListRow, LoadingRows, PageHeader, ROW_LINK, StatTile } from '@/components/ui/misc'
import { useDuesQuery, type DueRow } from '@/features/dues/api'
import { useBoards } from '@/features/home/useBoards'
import { useOrgId, usePropertiesQuery } from '@/features/properties/api'

type Filter = 'all' | 'notice' | 'overdue' | 'new'

interface ResidentRow {
  residentId: string
  name: string
  bedLabel: string
  roomLabel: string
  propertyId: string
  propertyName: string
  rentPaise: number
  checkIn: string
  onNotice: boolean
  vacateDate: string | null
  due: DueRow | null
}

function monthStartIST(now = new Date()): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
  return `${d.slice(0, 7)}-01`
}

export function ResidentsPage() {
  const { pathname } = useLocation()
  const base = pathname.startsWith('/owner') ? '/owner' : '/caretaker'
  const orgId = useOrgId()
  const properties = usePropertiesQuery()
  const props = useMemo(() => (Array.isArray(properties.data) ? properties.data : []), [properties.data])
  const { boards, isLoading } = useBoards(orgId, props)
  const duesQuery = useDuesQuery(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const multi = props.length > 1

  const all = useMemo<ResidentRow[]>(() => {
    const dues = new Map((Array.isArray(duesQuery.data) ? duesQuery.data : []).map((d) => [d.resident_id, d]))
    const rows: ResidentRow[] = []
    for (const b of boards) {
      for (const room of b.rooms) {
        for (const bed of room.beds) {
          const s = bed.stay
          if (!s) continue
          rows.push({
            residentId: s.resident.id,
            name: s.resident.full_name,
            bedLabel: bed.label,
            roomLabel: room.label,
            propertyId: b.property.id,
            propertyName: b.property.name,
            rentPaise: s.rent_paise,
            checkIn: s.check_in_date,
            onNotice: bed.status === 'on_notice',
            vacateDate: s.expected_vacate_date,
            due: dues.get(s.resident.id) ?? null,
          })
        }
      }
    }
    return rows.sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.bedLabel.localeCompare(b.bedLabel, undefined, { numeric: true }))
  }, [boards, duesQuery.data])

  const monthStart = monthStartIST()
  const inBuilding = propertyId ? all.filter((r) => r.propertyId === propertyId) : all
  const counts = {
    all: inBuilding.length,
    notice: inBuilding.filter((r) => r.onNotice).length,
    overdue: inBuilding.filter((r) => (r.due?.days_overdue ?? 0) > 0).length,
    new: inBuilding.filter((r) => r.checkIn >= monthStart).length,
  }
  const query = q.trim().toLowerCase()
  const rows = inBuilding.filter((r) => {
    if (filter === 'notice' && !r.onNotice) return false
    if (filter === 'overdue' && !((r.due?.days_overdue ?? 0) > 0)) return false
    if (filter === 'new' && r.checkIn < monthStart) return false
    if (query && !r.name.toLowerCase().includes(query) && !r.bedLabel.toLowerCase().startsWith(query)) return false
    return true
  })
  const rentRoll = inBuilding.reduce((sum, r) => sum + r.rentPaise, 0)

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: `All ${counts.all}` },
    { value: 'overdue', label: `Rent overdue ${counts.overdue}` },
    { value: 'notice', label: `On notice ${counts.notice}` },
    { value: 'new', label: `New this month ${counts.new}` },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Residents" description="Everyone staying now, by building and bed." />

      <section aria-label="Residents summary" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="Staying now" value={counts.all} />
        <StatTile label="Monthly rent roll" value={<Money paise={rentRoll} />} />
        <StatTile label="Rent overdue" value={counts.overdue} highlight={counts.overdue > 0} />
        <StatTile label="On notice" value={counts.notice} />
      </section>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          inputMode="search"
          aria-label="Filter residents by name or bed"
          placeholder="Name or bed"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 w-full rounded-control border border-line-strong bg-surface pl-10 pr-3 text-[16px] text-ink placeholder:text-subtle focus:border-ink focus:outline-none"
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter residents">
        {FILTERS.map((f) => (
          <Chip key={f.value} pressed={filter === f.value} onClick={() => setFilter(f.value)} className="shrink-0">
            {f.label}
          </Chip>
        ))}
      </div>
      {multi && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by building">
          <Chip pressed={propertyId === null} onClick={() => setPropertyId(null)}>
            All buildings
          </Chip>
          {props.map((p) => (
            <Chip key={p.id} pressed={propertyId === p.id} onClick={() => setPropertyId(p.id)}>
              {p.name}
            </Chip>
          ))}
        </div>
      )}

      {isLoading ? (
        <Card>
          <LoadingRows label="Loading residents…" />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState>{all.length === 0 ? 'Nobody is staying yet.' : 'No residents match this filter.'}</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardList aria-label="Residents">
            {rows.map((r) => {
              const overdue = (r.due?.days_overdue ?? 0) > 0
              return (
                <li key={`${r.residentId}-${r.bedLabel}`} className="flex items-center gap-1 pr-2 sm:pr-3">
                  <Link to={`${base}/residents/${r.residentId}`} className={`${ROW_LINK} min-w-0 flex-1`}>
                    <ListRow
                      leading={<Avatar name={r.name} />}
                      title={r.name}
                      meta={
                        <>
                          <span className="font-medium text-ink">{r.bedLabel}</span>
                          {multi && propertyId === null && <> · {r.propertyName}</>} · since <DateText value={r.checkIn} />
                        </>
                      }
                      trailing={
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[13.5px] font-semibold text-ink">
                            <Money paise={r.rentPaise} />
                            <span className="font-normal text-muted">/mo</span>
                          </span>
                          {overdue ? (
                            <Badge tone="danger">
                              <Money paise={r.due!.outstanding_paise} /> due
                            </Badge>
                          ) : r.onNotice ? (
                            <Badge tone="warning">
                              Leaving {r.vacateDate ? <DateText value={r.vacateDate} /> : 'soon'}
                            </Badge>
                          ) : null}
                        </div>
                      }
                    />
                  </Link>
                  {overdue && r.due?.whatsapp_url && (
                    <Button asChild variant="ghost" size="icon" aria-label={`Send rent reminder to ${r.name} on WhatsApp`}>
                      <a href={r.due.whatsapp_url} target="_blank" rel="noopener noreferrer">
                        <MessageCircle aria-hidden="true" />
                      </a>
                    </Button>
                  )}
                </li>
              )
            })}
          </CardList>
        </Card>
      )}
    </div>
  )
}
