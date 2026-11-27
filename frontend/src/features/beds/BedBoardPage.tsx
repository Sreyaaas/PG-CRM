import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Chip } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/features/auth/AuthContext'
import { countBeds } from '@/features/home/useBoards'
import { usePropertiesQuery } from '@/features/properties/api'
import { useBedBoardQuery, type BoardBed, type BoardRoom } from '@/features/rooms/api'
import { cn } from '@/lib/utils'

type BedFilter = 'all' | 'occupied' | 'vacant' | 'on_notice' | 'reserved'
type AcFilter = 'all' | 'ac' | 'non_ac'

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0]
  return first || fullName
}

function bedMatchesFilter(bed: BoardBed, filter: BedFilter): boolean {
  if (!bed.is_active) return false
  if (filter === 'all') return true
  return bed.status === filter
}

function BedTile({
  bed,
  isOwner,
  onSelectVacant,
}: {
  bed: BoardBed
  isOwner: boolean
  onSelectVacant?: (bed: BoardBed) => void
}) {
  const resident = bed.stay?.resident ?? null
  const rentPaise = bed.stay ? bed.stay.rent_paise : bed.base_rent_paise
  const rolePrefix = isOwner ? '/owner' : '/caretaker'

  const content = (
    <div className="flex h-full flex-col justify-between gap-2.5">
      {/* The badge wraps under the label on narrow tiles; the label itself never breaks ("101-A", not "101-" / "A"). */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span className="whitespace-nowrap text-[15px] font-semibold text-ink tabular-nums">{bed.label}</span>
        <StatusBadge kind="bed" value={bed.status} />
      </div>

      <div className="flex flex-col gap-0.5">
        {resident ? (
          <span className="truncate text-[14px] font-medium text-ink">{firstName(resident.full_name)}</span>
        ) : (
          <span className="text-[13px] text-muted">Available</span>
        )}
        <span className="text-[13.5px] font-semibold text-ink">
          <Money paise={rentPaise} />
          <span className="font-normal text-muted">
            {bed.stay?.stay_type === 'short_term' ? '/night' : '/mo'}
          </span>
        </span>
        {bed.status === 'on_notice' && bed.stay?.expected_vacate_date && (
          <span className="text-[12px] text-warning-ink">
            Leaves <DateText value={bed.stay.expected_vacate_date} />
          </span>
        )}
      </div>
    </div>
  )

  const tileClasses = cn(
    'flex min-h-[104px] flex-col rounded-control border border-line bg-surface p-3 text-left shadow-xs transition-colors',
    resident
      ? 'hover:border-line-strong hover:bg-surface-2 active:bg-surface-2'
      : 'bg-surface-2/50 hover:border-line-strong hover:bg-surface-2 active:bg-surface-2 cursor-pointer',
  )

  if (resident) {
    return (
      <Link
        to={`${rolePrefix}/residents/${resident.id}`}
        data-testid={`bed-tile-${bed.label}`}
        className={tileClasses}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelectVacant?.(bed)}
      data-testid={`bed-tile-${bed.label}`}
      className={tileClasses}
    >
      {content}
    </button>
  )
}

function RoomRow({
  room,
  beds,
  isOwner,
  onSelectVacant,
}: {
  room: BoardRoom
  beds: BoardBed[]
  isOwner: boolean
  onSelectVacant: (bed: BoardBed, room: BoardRoom) => void
}) {
  return (
    <section
      aria-label={`Room ${room.label}`}
      className="rounded-card border border-line bg-surface px-4 py-3.5 shadow-sm sm:px-5"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15.5px] font-semibold tracking-[-0.01em] text-ink">Room {room.label}</h2>
          <span className="text-[13px] text-muted">
            {room.floor != null && (
              <>
                Floor <span className="tabular-nums">{room.floor}</span>
                {' · '}
              </>
            )}
            <span className="tabular-nums">{room.sharing}</span>-sharing · {room.is_ac ? 'AC' : 'Non-AC'}
          </span>
        </div>
        <span className="text-[12.5px] text-muted tabular-nums">
          {beds.length} {beds.length === 1 ? 'bed' : 'beds'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        {beds.map((bed) => (
          <BedTile
            key={bed.id}
            bed={bed}
            isOwner={isOwner}
            onSelectVacant={(b) => onSelectVacant(b, room)}
          />
        ))}
      </div>
    </section>
  )
}

export function BedBoardPage() {
  const { membership } = useAuth()
  const { propertyId: routePropertyId } = useParams<{ propertyId: string }>()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isOwner = pathname.startsWith('/owner')

  const propertiesQuery = usePropertiesQuery()
  const properties = useMemo(
    () => (Array.isArray(propertiesQuery.data) ? propertiesQuery.data : []),
    [propertiesQuery.data],
  )

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('')
  const [filter, setFilter] = useState<BedFilter>('all')
  const [floorFilter, setFloorFilter] = useState<number | 'all'>('all')
  const [acFilter, setAcFilter] = useState<AcFilter>('all')
  const [selectedVacant, setSelectedVacant] = useState<{ bed: BoardBed; room: BoardRoom } | null>(null)
  const rolePrefix = isOwner ? '/owner' : '/caretaker'
  const { showToast } = useToast()

  const activePropertyId = useMemo(() => {
    if (routePropertyId) return routePropertyId
    if (selectedPropertyId && properties.some((p) => p.id === selectedPropertyId)) {
      return selectedPropertyId
    }
    return properties[0]?.id ?? ''
  }, [routePropertyId, selectedPropertyId, properties])

  const activeProperty = properties.find((p) => p.id === activePropertyId)
  const boardQuery = useBedBoardQuery(activePropertyId || undefined)
  const rooms = useMemo(() => boardQuery.data ?? [], [boardQuery.data])

  const counts = useMemo(() => countBeds(rooms), [rooms])

  const floors = useMemo(() => {
    const set = new Set<number>()
    for (const r of rooms) {
      if (r.floor != null) set.add(r.floor)
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [rooms])

  const filteredRooms = useMemo(() => {
    return rooms
      .filter((room) => {
        if (floorFilter !== 'all' && room.floor !== floorFilter) return false
        if (acFilter === 'ac' && !room.is_ac) return false
        if (acFilter === 'non_ac' && room.is_ac) return false
        return true
      })
      .map((room) => ({
        room,
        beds: room.beds.filter((b) => bedMatchesFilter(b, filter)),
      }))
      .filter((entry) =>
        filter === 'all' ? entry.beds.length > 0 || entry.room.beds.length === 0 : entry.beds.length > 0,
      )
  }, [rooms, filter, floorFilter, acFilter])

  function toggleCardFilter(next: BedFilter) {
    setFilter((prev) => (prev === next ? 'all' : next))
  }

  function handleSelectProperty(nextId: string) {
    if (routePropertyId) {
      navigate(`/owner/properties/${nextId}/beds`)
    } else {
      setSelectedPropertyId(nextId)
    }
  }

  const backLink = routePropertyId
    ? { to: `/owner/properties/${routePropertyId}`, label: activeProperty?.name ?? 'Property' }
    : undefined

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={backLink}
        title="Bed board"
        description={
          activeProperty ? (
            <span>{activeProperty.name}</span>
          ) : undefined
        }
        actions={
          membership?.role === 'owner' && activeProperty ? (
            <Button asChild variant="secondary" size="sm">
              <Link to={`/owner/properties/${activeProperty.id}/rooms`}>Manage rooms & beds</Link>
            </Button>
          ) : undefined
        }
      />

      {properties.length > 1 && (
        <div role="group" aria-label="Property switcher" className="flex flex-wrap gap-2">
          {properties.map((p) => (
            <Chip
              key={p.id}
              pressed={p.id === activePropertyId}
              onClick={() => handleSelectProperty(p.id)}
            >
              {p.name}
            </Chip>
          ))}
        </div>
      )}

      {propertiesQuery.isError && (
        <Notice role="alert">
          {propertiesQuery.error instanceof ApiError ? propertiesQuery.error.message : 'Unable to load properties.'}
        </Notice>
      )}

      {propertiesQuery.data && properties.length === 0 && (
        <Card>
          <EmptyState>No buildings assigned yet.</EmptyState>
        </Card>
      )}

      {activePropertyId && (
        <>
          {boardQuery.data && (
            <div
              data-testid="bed-board-summary"
              className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
              role="group"
              aria-label="Bed summary cards"
            >
              {(
                [
                  { id: 'all', label: 'All beds', count: counts.total, tone: 'text-ink' },
                  { id: 'vacant', label: 'Vacant', count: counts.vacant, tone: 'text-success-ink' },
                  { id: 'on_notice', label: 'To be vacant', count: counts.onNotice, tone: 'text-warning-ink' },
                  { id: 'occupied', label: 'Occupied', count: counts.occupied, tone: 'text-ink' },
                ] as const
              ).map((card) => {
                const active = filter === card.id
                return (
                  <button
                    key={card.id}
                    type="button"
                    aria-pressed={active}
                    data-testid={`bed-card-${card.id}`}
                    onClick={() => (card.id === 'all' ? setFilter('all') : toggleCardFilter(card.id))}
                    className={cn(
                      'flex flex-col items-start justify-between gap-1 rounded-card border bg-surface px-3.5 py-3 text-left shadow-xs transition-colors cursor-pointer',
                      active
                        ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
                        : 'border-line hover:border-line-strong hover:bg-surface-2',
                    )}
                  >
                    <span className="text-[12.5px] font-medium text-muted">{card.label}</span>
                    <span className={cn('text-[22px] font-bold leading-tight tabular-nums', card.tone)}>
                      {card.count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Bed board filters">
            {floors.length > 0 && (
              <>
                <Chip pressed={floorFilter === 'all'} onClick={() => setFloorFilter('all')}>
                  All floors
                </Chip>
                {floors.map((fl) => (
                  <Chip key={fl} pressed={floorFilter === fl} onClick={() => setFloorFilter(fl)}>
                    Floor {fl}
                  </Chip>
                ))}
              </>
            )}

            <Chip pressed={acFilter === 'all'} onClick={() => setAcFilter('all')}>
              All rooms
            </Chip>
            <Chip pressed={acFilter === 'ac'} onClick={() => setAcFilter(acFilter === 'ac' ? 'all' : 'ac')}>
              AC
            </Chip>
            <Chip
              pressed={acFilter === 'non_ac'}
              onClick={() => setAcFilter(acFilter === 'non_ac' ? 'all' : 'non_ac')}
            >
              Non-AC
            </Chip>

            {counts.reserved > 0 && (
              <Chip
                pressed={filter === 'reserved'}
                onClick={() => toggleCardFilter('reserved')}
              >
                Reserved ({counts.reserved})
              </Chip>
            )}
          </div>

          {boardQuery.isLoading && (
            <Card>
              <LoadingRows label="Loading bed board…" rows={4} />
            </Card>
          )}

          {boardQuery.isError && (
            <Notice role="alert">
              {boardQuery.error instanceof ApiError ? boardQuery.error.message : 'Unable to load bed board.'}
            </Notice>
          )}

          {boardQuery.data && filteredRooms.length === 0 && (
            <Card>
              <EmptyState>
                {filter === 'vacant'
                  ? 'No vacant beds.'
                  : filter === 'on_notice'
                    ? 'Nobody is on notice.'
                    : 'No rooms or beds added yet.'}
              </EmptyState>
            </Card>
          )}

          {filteredRooms.length > 0 && (
            <div className="flex flex-col gap-3">
              {filteredRooms.map(({ room, beds }) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  beds={beds}
                  isOwner={isOwner}
                  onSelectVacant={(bed, r) => setSelectedVacant({ bed, room: r })}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Sheet
        open={selectedVacant !== null}
        onClose={() => setSelectedVacant(null)}
        title={selectedVacant ? `Bed ${selectedVacant.bed.label}` : ''}
        description={
          selectedVacant
            ? `Room ${selectedVacant.room.label}${
                selectedVacant.room.floor != null ? ` · Floor ${selectedVacant.room.floor}` : ''
              } · ${selectedVacant.room.sharing}-sharing · ${selectedVacant.room.is_ac ? 'AC' : 'Non-AC'}`
            : undefined
        }
        footer={
          selectedVacant && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setSelectedVacant(null)}>
                Close
              </Button>
              {activeProperty?.qr_slug && (
                <Button asChild variant="secondary">
                  <Link to={`/join/${activeProperty.qr_slug}`}>New tenant form</Link>
                </Button>
              )}
              <Button asChild>
                <Link to={`${rolePrefix}/check-ins`}>Pending check-ins</Link>
              </Button>
            </div>
          )
        }
      >
        {selectedVacant && (
          <div className="flex flex-col gap-3 text-[14px]">
            <div className="flex items-center justify-between rounded-control border border-line bg-surface-2/60 px-3.5 py-2.5">
              <span className="text-muted">Status</span>
              <StatusBadge kind="bed" value={selectedVacant.bed.status} />
            </div>
            <div className="flex items-center justify-between rounded-control border border-line bg-surface-2/60 px-3.5 py-2.5">
              <span className="text-muted">Monthly rent</span>
              <span className="font-semibold text-ink">
                <Money paise={selectedVacant.bed.base_rent_paise} />
                <span className="font-normal text-muted">/mo</span>
              </span>
            </div>
            {activeProperty?.qr_slug && (
              <div className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2/60 px-3.5 py-2.5">
                <span className="text-muted">Share join link</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const url = `${window.location.origin}/join/${activeProperty.qr_slug}`
                    void navigator.clipboard?.writeText(url)
                    showToast('Join link copied')
                  }}
                >
                  Copy link
                </Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
