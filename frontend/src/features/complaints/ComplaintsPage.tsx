import { useMemo, useRef, useState } from 'react'
import {
  AirVent,
  CircleHelp,
  Droplets,
  Plus,
  ShieldAlert,
  Sparkles,
  UtensilsCrossed,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { DateText } from '@/components/DateText'
import { useToast } from '@/components/Toast'
import { Badge, Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { EmptyState, ListRow, LoadingRows, Notice, PageHeader, ROW_LINK, StatTile } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { useBoards } from '@/features/home/useBoards'
import { useOrgId, usePropertiesQuery } from '@/features/properties/api'
import { cn } from '@/lib/utils'
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  ageLabel,
  sortComplaints,
  useComplaintsQuery,
  useCreateComplaint,
  useUpdateComplaint,
  type Complaint,
  type ComplaintCategory,
  type ComplaintPriority,
  type ComplaintStatus,
} from './api'

const CATEGORY_ICONS: Record<ComplaintCategory, React.ReactNode> = {
  wifi: <Wifi />,
  water: <Droplets />,
  electricity: <Zap />,
  plumbing: <Wrench />,
  ac: <AirVent />,
  cleaning: <Sparkles />,
  food: <UtensilsCrossed />,
  security: <ShieldAlert />,
  other: <CircleHelp />,
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ComplaintCategory[]
const PRIORITIES: ComplaintPriority[] = ['low', 'normal', 'urgent']

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback
}

export function StatusBadgeFor({ status }: { status: ComplaintStatus }) {
  const tone = status === 'resolved' ? 'success' : status === 'in_progress' ? 'info' : 'warning'
  return (
    <Badge tone={tone} dot>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: ComplaintPriority }) {
  if (priority === 'normal') return null
  return <Badge tone={priority === 'urgent' ? 'danger' : 'neutral'}>{PRIORITY_LABELS[priority]}</Badge>
}

export function CategoryIcon({ category, className }: { category: ComplaintCategory; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink [&_svg]:size-[18px]',
        className,
      )}
    >
      {CATEGORY_ICONS[category]}
    </span>
  )
}

function where(c: Complaint): string {
  const place = c.bed_label ?? (c.room_label ? `Room ${c.room_label}` : null)
  if (c.resident_name) return place ? `${place} · ${c.resident_name}` : c.resident_name
  return place ?? 'Common area'
}

export function ComplaintRow({ c, onOpen, showProperty }: { c: Complaint; onOpen: (c: Complaint) => void; showProperty: boolean }) {
  return (
    <li data-testid="complaint-row">
      <button type="button" className={cn(ROW_LINK, 'w-full text-left')} onClick={() => onOpen(c)}>
        <ListRow
          leading={<CategoryIcon category={c.category} />}
          title={c.title}
          meta={
            <>
              {showProperty && <>{c.property_name} · </>}
              {where(c)} · {ageLabel(c.status === 'resolved' ? (c.resolved_at ?? c.updated_at) : c.created_at)}
            </>
          }
          trailing={
            <div className="flex flex-col items-end gap-1">
              <StatusBadgeFor status={c.status} />
              <PriorityBadge priority={c.priority} />
            </div>
          }
        />
      </button>
    </li>
  )
}

/* ───────── Detail sheet ───────── */

export function ComplaintSheet({ complaint, onClose }: { complaint: Complaint | null; onClose: () => void }) {
  // Keyed by id so the resolve form starts fresh for every complaint.
  return complaint ? <ComplaintSheetBody key={complaint.id} c={complaint} onClose={onClose} /> : null
}

function ComplaintSheetBody({ c, onClose }: { c: Complaint; onClose: () => void }) {
  const update = useUpdateComplaint()
  const { showToast } = useToast()
  const [resolving, setResolving] = useState(false)
  const [note, setNote] = useState('')

  const save = (body: Parameters<typeof update.mutate>[0]['body'], done: string) =>
    update.mutate(
      { id: c.id, body },
      {
        onSuccess: () => {
          showToast(done, 'success')
          onClose()
        },
        onError: (err) => showToast(errorText(err, 'Unable to update the complaint.'), 'error'),
      },
    )

  const footer =
    c.status === 'resolved' ? (
      <Button type="button" variant="secondary" block disabled={update.isPending} onClick={() => save({ status: 'open' }, 'Complaint reopened')}>
        Reopen
      </Button>
    ) : resolving ? (
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={() => setResolving(false)}>
          Back
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={update.isPending || note.trim().length < 3}
          onClick={() => save({ status: 'resolved', resolution_note: note.trim() }, 'Marked resolved')}
        >
          {update.isPending ? 'Saving…' : 'Mark resolved'}
        </Button>
      </div>
    ) : (
      <div className="flex gap-2">
        {c.status === 'open' && (
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={update.isPending}
            onClick={() => save({ status: 'in_progress' }, 'Marked in progress')}
          >
            Start work
          </Button>
        )}
        <Button type="button" className="flex-1" onClick={() => setResolving(true)}>
          Resolve
        </Button>
      </div>
    )

  return (
    <Sheet open onClose={onClose} title={c.title} description={`${CATEGORY_LABELS[c.category]} · ${c.property_name}`} footer={footer}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadgeFor status={c.status} />
          <PriorityBadge priority={c.priority} />
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-muted">Where</dt>
          <dd className="text-ink">{where(c)}</dd>
          <dt className="text-muted">Reported</dt>
          <dd className="text-ink">
            <DateText value={c.created_at} /> · {ageLabel(c.created_at)} by {c.created_by_name}
          </dd>
          {c.assigned_to_name && (
            <>
              <dt className="text-muted">Assigned</dt>
              <dd className="text-ink">{c.assigned_to_name}</dd>
            </>
          )}
          {c.status === 'resolved' && c.resolved_at && (
            <>
              <dt className="text-muted">Resolved</dt>
              <dd className="text-ink">
                <DateText value={c.resolved_at} /> · {ageLabel(c.resolved_at)}
              </dd>
            </>
          )}
        </dl>

        {c.note && <p className="whitespace-pre-wrap rounded-control bg-surface-2 px-3 py-2.5 text-[14px] text-ink">{c.note}</p>}
        {c.resolution_note && (
          <Notice tone="success">
            <span className="font-semibold">Resolution:</span> {c.resolution_note}
          </Notice>
        )}

        {c.status !== 'resolved' && !resolving && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-muted">Priority</span>
            <div role="group" aria-label="Priority" className="flex gap-2">
              {PRIORITIES.map((p) => (
                <Chip
                  key={p}
                  pressed={c.priority === p}
                  disabled={update.isPending}
                  onClick={() => p !== c.priority && save({ priority: p }, `Priority set to ${PRIORITY_LABELS[p].toLowerCase()}`)}
                >
                  {PRIORITY_LABELS[p]}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {resolving && (
          <Field id="resolution-note" label="What was done?" hint="The resident and owner see this.">
            <Textarea
              id="resolution-note"
              rows={3}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Router restarted, speed checked in the room"
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}

/* ───────── New complaint sheet ───────── */

export function NewComplaintSheet(props: { open: boolean; onClose: () => void; defaultPropertyId?: string | null }) {
  // Mounted only while open, so every new complaint starts from an empty form.
  return props.open ? <NewComplaintForm onClose={props.onClose} defaultPropertyId={props.defaultPropertyId} /> : null
}

function NewComplaintForm({ onClose, defaultPropertyId }: { onClose: () => void; defaultPropertyId?: string | null }) {
  const orgId = useOrgId()
  const properties = usePropertiesQuery()
  const props = useMemo(() => (properties.data ?? []).filter((p) => p.is_active), [properties.data])
  const [chosenPropertyId, setPropertyId] = useState<string>(defaultPropertyId ?? '')
  const propertyId = chosenPropertyId || (props.length === 1 ? props[0].id : '')
  const [bedId, setBedId] = useState<string>('')
  const [category, setCategory] = useState<ComplaintCategory | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<ComplaintPriority>('normal')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateComplaint()
  const { showToast } = useToast()
  const submitting = useRef(false)

  const selectedProperty = props.find((p) => p.id === propertyId) ?? null
  const { boards } = useBoards(orgId, selectedProperty ? [selectedProperty] : [])
  const beds = boards[0]?.beds ?? []
  const occupied = beds.filter((b) => b.stay)

  const submit = () => {
    if (submitting.current) return
    if (!propertyId) return setError('Choose the building.')
    if (!category) return setError('Choose what the problem is about.')
    if (title.trim().length < 3) return setError('Describe the problem in a few words.')
    setError(null)
    const bed = beds.find((b) => b.id === bedId)
    submitting.current = true
    create.mutate(
      {
        property_id: propertyId,
        bed_id: bed?.id ?? null,
        resident_id: bed?.stay?.resident.id ?? null,
        category,
        title: title.trim(),
        note: note.trim() || null,
        priority,
      },
      {
        onSuccess: () => {
          showToast('Complaint logged', 'success')
          onClose()
        },
        onError: (err) => setError(errorText(err, 'Unable to log the complaint.')),
        onSettled: () => {
          submitting.current = false
        },
      },
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="New complaint"
      description="Log it now so nothing gets forgotten at shift change."
      footer={
        <Button type="button" block disabled={create.isPending} onClick={submit}>
          {create.isPending ? 'Saving…' : 'Log complaint'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice role="alert">{error}</Notice>}

        {props.length > 1 && (
          <Field id="complaint-property" label="Building">
            <Select id="complaint-property" value={propertyId} onChange={(e) => (setPropertyId(e.target.value), setBedId(''))}>
              <option value="">Choose a building</option>
              {props.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field id="complaint-bed" label="Resident or room" hint="Leave as common area for corridors, kitchen, terrace.">
          <Select id="complaint-bed" value={bedId} disabled={!propertyId} onChange={(e) => setBedId(e.target.value)}>
            <option value="">Common area</option>
            {occupied.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} · {b.stay?.resident.full_name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-[13.5px] font-medium text-ink">What is it about?</span>
          <div role="group" aria-label="Category" className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                aria-pressed={category === cat}
                onClick={() => setCategory(cat)}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border px-1 py-2 text-[12.5px] font-medium transition-colors [&_svg]:size-5',
                  category === cat
                    ? 'border-[color-mix(in_oklab,var(--brand)_60%,var(--line))] bg-brand-soft text-ink'
                    : 'border-line bg-surface text-muted active:bg-surface-2',
                )}
              >
                {CATEGORY_ICONS[cat]}
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        <Field id="complaint-title" label="Problem">
          <Input
            id="complaint-title"
            value={title}
            maxLength={120}
            enterKeyHint="next"
            onChange={(e) => setTitle(e.target.value)}
            placeholder="No hot water in the 2nd floor bathroom"
          />
        </Field>

        <Field id="complaint-note" label="Details (optional)">
          <Textarea id="complaint-note" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-[13.5px] font-medium text-ink">Priority</span>
          <div role="group" aria-label="Priority" className="flex gap-2">
            {PRIORITIES.map((p) => (
              <Chip key={p} pressed={priority === p} onClick={() => setPriority(p)}>
                {PRIORITY_LABELS[p]}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/* ───────── Page ───────── */

type View = 'open' | 'resolved' | 'all'

export function ComplaintsPage() {
  const [params, setParams] = useSearchParams()
  const properties = usePropertiesQuery()
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [view, setView] = useState<View>('open')
  const [selected, setSelected] = useState<Complaint | null>(null)
  const newOpen = params.get('new') === '1'
  const query = useComplaintsQuery({ propertyId })

  const all = useMemo(() => sortComplaints(query.data ?? []), [query.data])
  const unresolved = all.filter((c) => c.status !== 'resolved')
  const rows = view === 'open' ? unresolved : view === 'resolved' ? all.filter((c) => c.status === 'resolved') : all
  const multi = (properties.data?.length ?? 0) > 1

  const openNew = () => setParams((p) => (p.set('new', '1'), p), { replace: true })
  const closeNew = () => setParams((p) => (p.delete('new'), p), { replace: true })

  // Keep the open sheet in sync after an update refetches the list.
  const current = selected ? (all.find((c) => c.id === selected.id) ?? selected) : null

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Complaints"
        description="Resident issues, unresolved and urgent first."
        actions={
          <Button type="button" size="sm" onClick={openNew}>
            <Plus aria-hidden="true" />
            New complaint
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Open" value={unresolved.filter((c) => c.status === 'open').length} />
        <StatTile label="In progress" value={unresolved.filter((c) => c.status === 'in_progress').length} />
        <StatTile label="Urgent" value={unresolved.filter((c) => c.priority === 'urgent').length} highlight={unresolved.some((c) => c.priority === 'urgent')} />
      </div>

      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Filter by status" className="flex gap-2">
          <Chip pressed={view === 'open'} onClick={() => setView('open')}>
            Unresolved
          </Chip>
          <Chip pressed={view === 'resolved'} onClick={() => setView('resolved')}>
            Resolved
          </Chip>
          <Chip pressed={view === 'all'} onClick={() => setView('all')}>
            All
          </Chip>
        </div>
        {multi && (
          <div role="group" aria-label="Filter by building" className="flex flex-wrap gap-2">
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
      </div>

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading complaints…" />
        </Card>
      )}
      {query.isError && <Notice role="alert">{errorText(query.error, 'Unable to load complaints.')}</Notice>}
      {query.data && rows.length === 0 && (
        <Card>
          <EmptyState>{view === 'open' ? 'No open complaints. Everything is sorted.' : 'No complaints here yet.'}</EmptyState>
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <CardList aria-label="Complaints">
            {rows.map((c) => (
              <ComplaintRow key={c.id} c={c} onOpen={setSelected} showProperty={multi && propertyId === null} />
            ))}
          </CardList>
        </Card>
      )}

      <ComplaintSheet complaint={current} onClose={() => setSelected(null)} />
      <NewComplaintSheet open={newOpen} onClose={closeNew} defaultPropertyId={propertyId} />
    </div>
  )
}
