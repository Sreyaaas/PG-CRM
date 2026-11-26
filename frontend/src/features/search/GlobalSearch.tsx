import { useEffect, useMemo, useState } from 'react'
import { DoorOpen, MessageSquareWarning, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { useComplaintsQuery } from '@/features/complaints/api'
import { useBoards } from '@/features/home/useBoards'
import { useOrgId, usePropertiesQuery } from '@/features/properties/api'
import { cn } from '@/lib/utils'

type Base = '/owner' | '/caretaker'

interface Result {
  key: string
  group: 'Residents' | 'Rooms' | 'Complaints'
  title: string
  meta: string
  to: string
  leading: React.ReactNode
  badge?: { text: string; tone: 'warning' | 'success' | 'neutral' | 'danger' }
}

const BED_STATUS: Record<string, { text: string; tone: 'warning' | 'success' | 'neutral' }> = {
  on_notice: { text: 'On notice', tone: 'warning' },
  reserved: { text: 'Reserved', tone: 'neutral' },
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Search icon for the top bar. Ctrl/Cmd+K or "/" opens it on a keyboard. */
export function SearchButton({ base }: { base: Base }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search residents, rooms and complaints"
        title="Search (Ctrl+K)"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-2 [&_svg]:size-5"
      >
        <Search aria-hidden="true" />
      </button>
      {open && <SearchSheet base={base} onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchSheet({ base, onClose }: { base: Base; onClose: () => void }) {
  const navigate = useNavigate()
  const orgId = useOrgId()
  const properties = usePropertiesQuery()
  const props = useMemo(() => (Array.isArray(properties.data) ? properties.data : []), [properties.data])
  const { boards, isLoading } = useBoards(orgId, props)
  const complaints = useComplaintsQuery()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const multi = props.length > 1

  const results = useMemo<Result[]>(() => {
    const query = norm(q)
    if (query.length < 1) return []
    const out: Result[] = []
    const rooms = new Map<string, Result>()

    for (const board of boards) {
      for (const room of board.rooms) {
        const roomText = norm(`room ${room.label}`)
        const where = multi ? `${board.property.name} · ` : ''
        const free = room.beds.filter((b) => b.is_active && b.status === 'vacant').length
        if (roomText.includes(query) || norm(room.label).startsWith(query)) {
          rooms.set(`${board.property.id}:${room.id}`, {
            key: `room-${room.id}`,
            group: 'Rooms',
            title: `Room ${room.label}`,
            meta: `${where}${room.sharing}-sharing · ${room.is_ac ? 'AC' : 'Non-AC'}${room.floor != null ? ` · Floor ${room.floor}` : ''}`,
            to: `${base}/beds`,
            leading: <Icon><DoorOpen /></Icon>,
            badge: free > 0 ? { text: `${free} free`, tone: 'success' } : { text: 'Full', tone: 'neutral' },
          })
        }
        for (const bed of room.beds) {
          const resident = bed.stay?.resident
          if (!resident) continue
          if (norm(resident.full_name).includes(query) || norm(bed.label).startsWith(query)) {
            out.push({
              key: `res-${resident.id}-${bed.id}`,
              group: 'Residents',
              title: resident.full_name,
              meta: `${where}${bed.label} · Room ${room.label}`,
              to: `${base}/residents/${resident.id}`,
              leading: <Avatar name={resident.full_name} />,
              badge: BED_STATUS[bed.status],
            })
          }
        }
      }
    }

    const complaintHits: Result[] = (Array.isArray(complaints.data) ? complaints.data : [])
      .filter((c) => c.status !== 'resolved' && (norm(c.title).includes(query) || norm(c.resident_name ?? '').includes(query)))
      .map((c) => ({
        key: `cmp-${c.id}`,
        group: 'Complaints',
        title: c.title,
        meta: [multi ? c.property_name : null, c.bed_label ?? c.room_label, c.resident_name].filter(Boolean).join(' · ') || 'Common area',
        to: `${base}/complaints`,
        leading: <Icon><MessageSquareWarning /></Icon>,
        badge: c.priority === 'urgent' ? { text: 'Urgent', tone: 'danger' } : undefined,
      }))

    return [...out.slice(0, 8), ...[...rooms.values()].slice(0, 5), ...complaintHits.slice(0, 5)]
  }, [q, boards, complaints.data, base, multi])

  const go = (r: Result) => {
    onClose()
    navigate(r.to)
  }

  const groups = (['Residents', 'Rooms', 'Complaints'] as const)
    .map((g) => ({ g, items: results.filter((r) => r.group === g) }))
    .filter((x) => x.items.length > 0)
  let index = -1

  return (
    <Sheet open onClose={onClose} title="Search" ariaLabel="Search">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            autoFocus
            type="search"
            inputMode="search"
            enterKeyHint="go"
            aria-label="Search residents, rooms and complaints"
            placeholder="Name, bed (102-A), room or complaint"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && results[active]) {
                go(results[active])
              }
            }}
            className="h-12 w-full rounded-control border border-line-strong bg-surface pl-10 pr-11 text-[16px] text-ink placeholder:text-subtle focus:border-ink focus:outline-none"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQ('')}
              className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-surface-2"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {q.trim() === '' ? (
          <p className="text-[14px] text-muted">Type a name, a bed like 102-A, a room number, or a complaint.</p>
        ) : results.length === 0 ? (
          <p className="text-[14px] text-muted">{isLoading ? 'Searching…' : `Nothing matches “${q.trim()}”.`}</p>
        ) : (
          <div className="flex flex-col gap-4" role="listbox" aria-label="Search results">
            {groups.map(({ g, items }) => (
              <section key={g} aria-label={g} className="flex flex-col gap-1">
                <h3 className="px-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-subtle">{g}</h3>
                {items.map((r) => {
                  index += 1
                  const i = index
                  return (
                    <button
                      key={r.key}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cn(
                        'flex min-h-14 w-full items-center gap-3 rounded-control px-2 py-2 text-left transition-colors',
                        i === active ? 'bg-surface-2' : 'hover:bg-surface-2',
                      )}
                    >
                      {r.leading}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-ink">{r.title}</span>
                        <span className="block truncate text-[12.5px] text-muted">{r.meta}</span>
                      </span>
                      {r.badge && <Badge tone={r.badge.tone}>{r.badge.text}</Badge>}
                    </button>
                  )
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink [&_svg]:size-[18px]">
      {children}
    </span>
  )
}

