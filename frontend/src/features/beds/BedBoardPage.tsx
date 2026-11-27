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
import { useAuth } from '@/features/auth/AuthContext'
import { countBeds } from '@/features/home/useBoards'
import { usePropertiesQuery } from '@/features/properties/api'
import { useBedBoardQuery, type BoardBed, type BoardRoom } from '@/features/rooms/api'
import { cn } from '@/lib/utils'

type BedFilter = 'all' | 'vacant' | 'on_notice'

const FILTERS: { id: BedFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'vacant', label: 'Vacant' },
  { id: 'on_notice', label: 'On notice' },
]

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0]
  return first || fullName
}

function bedMatchesFilter(bed: BoardBed, filter: BedFilter): boolean {
  if (!bed.is_active) return false
  if (filter === 'all') return true
  return bed.status === filter
}

function BedTile({ bed, isOwner }: { bed: BoardBed; isOwner: boolean }) {
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
    resident ? 'hover:border-line-strong hover:bg-surface-2 active:bg-surface-2' : 'bg-surface-2/50',
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
    <div data-testid={`bed-tile-${bed.label}`} className={tileClasses}>
      {content}
    </div>
  )
}

function RoomRow({ room, beds, isOwner }: { room: BoardRoom; beds: BoardBed[]; isOwner: boolean }) {
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
          <BedTile key={bed.id} bed={bed} isOwner={isOwner} />
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

  const filteredRooms = useMemo(() => {
    return rooms
      .map((room) => ({
        room,
        beds: room.beds.filter((b) => bedMatchesFilter(b, filter)),
      }))
      .filter((entry) => (filter === 'all' ? entry.beds.length > 0 || entry.room.beds.length === 0 : entry.beds.length > 0))
  }, [rooms, filter])

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
            <p data-testid="bed-board-summary" className="text-[14px] font-medium text-muted tabular-nums">
              {counts.occupied} occupied · {counts.vacant} vacant · {counts.onNotice} on notice
              {counts.reserved > 0 ? ` · ${counts.reserved} reserved` : ''}
            </p>
          )}

          <div role="group" aria-label="Bed status filter" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Chip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </Chip>
            ))}
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
                <RoomRow key={room.id} room={room} beds={beds} isOwner={isOwner} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
