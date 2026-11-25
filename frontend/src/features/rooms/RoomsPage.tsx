import { useState, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useParams } from 'react-router-dom'
import { ApiError, apiClient } from '@/api/client'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Checkbox, Input } from '@/components/ui/input'
import { EmptyState, LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { parseRupeesToPaise } from '@/lib/money'
import { useOrgId, usePropertyQuery } from '@/features/properties/api'
import { useBedBoardQuery, type BoardBed, type BoardRoom } from './api'
import {
  bedSchema,
  paiseToRupeeInput,
  previewText,
  roomSchema,
  toIntOrNull,
  type BedFormValues,
  type RoomFormValues,
} from './roomForm'

function Warning({ children }: { children: ReactNode }) {
  return <Notice tone="warning">{children}</Notice>
}

const header = (orgId: string) => ({ 'x-org-id': orgId })

function useRefreshBoard() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['bed-board'] })
}

function AddRoomForm({
  propertyId,
  onWarning,
}: {
  propertyId: string
  onWarning: (roomId: string, warning: string) => void
}) {
  const orgId = useOrgId()
  const { showToast } = useToast()
  const refresh = useRefreshBoard()
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<RoomFormValues>({
    resolver: zodResolver(roomSchema),
    defaultValues: { label: '', floor: '', sharing: 3, is_ac: false, area_sqft: '', rent: '' },
  })
  const [label, sharing, rent] = watch(['label', 'sharing', 'rent'])
  const preview = previewText(label, sharing, rent)

  const mutation = useMutation({
    mutationFn: async (v: RoomFormValues) => {
      const { data } = await apiClient.POST('/api/v1/properties/{property_id}/rooms', {
        params: { path: { property_id: propertyId }, header: header(orgId) },
        body: {
          label: v.label.trim(),
          floor: toIntOrNull(v.floor),
          sharing: v.sharing,
          is_ac: v.is_ac,
          area_sqft: toIntOrNull(v.area_sqft),
          base_rent_paise: parseRupeesToPaise(v.rent),
        },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: async (room) => {
      if (room.warning) onWarning(room.id, room.warning)
      await refresh()
      showToast(`Room ${room.label} added`, 'success')
      reset()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setError('label', { type: 'server', message: err.message })
      } else {
        showToast(err instanceof ApiError ? err.message : 'Unable to add room.', 'error')
      }
    },
  })

  return (
    <form
      onSubmit={handleSubmit((v) => mutation.mutate(v))}
      noValidate
      aria-label="Add room"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Add room</h2>
      <Field id="r-label" label="Room label" error={errors.label?.message}>
        <Input id="r-label" type="text" placeholder="204" {...register('label')} enterKeyHint="next" />
      </Field>
      <Field id="r-floor" label="Floor" error={errors.floor?.message}>
        <Input
          id="r-floor"
          type="text"
          inputMode="numeric"
          {...register('floor')}
          enterKeyHint="next"
          className="tabular-nums"
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span id="r-sharing-label" className="block text-[14px] font-medium text-ink">
          Sharing
        </span>
        <div role="group" aria-labelledby="r-sharing-label" className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Decrease sharing"
            disabled={sharing <= 1}
            onClick={() => setValue('sharing', sharing - 1)}
          >
            −
          </Button>
          <output aria-live="polite" className="w-8 text-center text-[20px] font-bold tabular-nums">
            {sharing}
          </output>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Increase sharing"
            disabled={sharing >= 8}
            onClick={() => setValue('sharing', sharing + 1)}
          >
            +
          </Button>
        </div>
      </div>
      <Checkbox {...register('is_ac')} label="AC room" />
      <Field id="r-area" label="Area (sq ft, optional)" error={errors.area_sqft?.message}>
        <Input
          id="r-area"
          type="text"
          inputMode="numeric"
          {...register('area_sqft')}
          enterKeyHint="next"
          className="tabular-nums"
        />
      </Field>
      <Field id="r-rent" label="Rent per bed (₹)" error={errors.rent?.message}>
        <Input
          id="r-rent"
          type="text"
          inputMode="numeric"
          placeholder="6000"
          {...register('rent')}
          enterKeyHint="next"
          className="tabular-nums"
        />
      </Field>
      {preview && (
        <p data-testid="room-preview" className="text-[14px] text-ink tabular-nums">
          {preview}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending} block>
        {mutation.isPending ? 'Adding…' : 'Add room'}
      </Button>
    </form>
  )
}

function EditRoomForm({
  room,
  onDone,
  onWarning,
}: {
  room: BoardRoom
  onDone: () => void
  onWarning: (roomId: string, warning: string) => void
}) {
  const orgId = useOrgId()
  const { showToast } = useToast()
  const refresh = useRefreshBoard()
  const { register, handleSubmit, setError, formState } = useForm<{
    label: string
    floor: string
    is_ac: boolean
    area_sqft: string
  }>({
    defaultValues: {
      label: room.label,
      floor: room.floor == null ? '' : String(room.floor),
      is_ac: room.is_ac,
      area_sqft: '',
    },
  })
  const { errors } = formState

  const mutation = useMutation({
    mutationFn: async (v: { label: string; floor: string; is_ac: boolean; area_sqft: string }) => {
      const body: { label?: string; floor?: number | null; is_ac?: boolean; area_sqft?: number } = {}
      if (v.label.trim() !== room.label) body.label = v.label.trim()
      if (v.floor.trim() !== (room.floor == null ? '' : String(room.floor))) {
        body.floor = toIntOrNull(v.floor)
      }
      if (v.is_ac !== room.is_ac) body.is_ac = v.is_ac
      // The bed board doesn't return area, so blank means "leave unchanged".
      if (v.area_sqft.trim()) body.area_sqft = Number(v.area_sqft.trim())
      const { data } = await apiClient.PATCH('/api/v1/rooms/{room_id}', {
        params: { path: { room_id: room.id }, header: header(orgId) },
        body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: async (saved) => {
      if (saved.warning) onWarning(saved.id, saved.warning)
      await refresh()
      showToast(`Room ${saved.label} saved`, 'success')
      onDone()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setError('label', { type: 'server', message: err.message })
      } else {
        showToast(err instanceof ApiError ? err.message : 'Unable to save room.', 'error')
      }
    },
  })

  const id = `room-${room.id}`
  return (
    <form
      onSubmit={handleSubmit((v) => mutation.mutate(v))}
      noValidate
      aria-label={`Edit room ${room.label}`}
      className="flex flex-col gap-3 border-t border-line pt-3"
    >
      <Field id={`${id}-label`} label="Room label" error={errors.label?.message}>
        <Input id={`${id}-label`} type="text" {...register('label', { required: true })} enterKeyHint="next" />
      </Field>
      <Field id={`${id}-floor`} label="Floor">
        <Input
          id={`${id}-floor`}
          type="text"
          inputMode="numeric"
          {...register('floor')}
          enterKeyHint="next"
          className="tabular-nums"
        />
      </Field>
      <Field id={`${id}-area`} label="Area (sq ft), leave blank to keep">
        <Input
          id={`${id}-area`}
          type="text"
          inputMode="numeric"
          {...register('area_sqft')}
          enterKeyHint="next"
          className="tabular-nums"
        />
      </Field>
      <Checkbox {...register('is_ac')} label="AC room" />
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save room'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function EditBedForm({ bed, onDone }: { bed: BoardBed; onDone: () => void }) {
  const orgId = useOrgId()
  const { showToast } = useToast()
  const refresh = useRefreshBoard()
  const [activeError, setActiveError] = useState<string | null>(null)
  const { register, handleSubmit, setError, formState } = useForm<{
    label: string
    rent: string
    is_active: boolean
  }>({
    defaultValues: {
      label: bed.label,
      rent: paiseToRupeeInput(bed.base_rent_paise),
      is_active: bed.is_active,
    },
  })
  const { errors } = formState

  const mutation = useMutation({
    mutationFn: async (v: { label: string; rent: string; is_active: boolean }) => {
      const body: { label?: string; base_rent_paise?: number; is_active?: boolean } = {}
      if (v.label.trim() !== bed.label) body.label = v.label.trim()
      const paise = parseRupeesToPaise(v.rent)
      if (paise !== bed.base_rent_paise) body.base_rent_paise = paise
      if (v.is_active !== bed.is_active) body.is_active = v.is_active
      const { data } = await apiClient.PATCH('/api/v1/beds/{bed_id}', {
        params: { path: { bed_id: bed.id }, header: header(orgId) },
        body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: async (saved) => {
      await refresh()
      showToast(`Bed ${saved.label} saved`, 'success')
      onDone()
    },
    onError: (err, vars) => {
      if (err instanceof ApiError && err.status === 409) {
        setError('label', { type: 'server', message: err.message })
      } else if (err instanceof ApiError && vars.is_active !== bed.is_active) {
        setActiveError(err.message)
      } else {
        showToast(err instanceof ApiError ? err.message : 'Unable to save bed.', 'error')
      }
    },
  })

  const submit = (v: { label: string; rent: string; is_active: boolean }) => {
    setActiveError(null)
    const parsed = bedSchema.safeParse({ label: v.label, rent: v.rent })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        setError(issue.path[0] === 'rent' ? 'rent' : 'label', { message: issue.message })
      }
      return
    }
    mutation.mutate(v)
  }

  const id = `bed-${bed.id}`
  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      aria-label={`Edit bed ${bed.label}`}
      className="flex flex-col gap-3 pt-3"
    >
      <Field id={`${id}-label`} label="Bed label" error={errors.label?.message}>
        <Input id={`${id}-label`} type="text" {...register('label')} enterKeyHint="next" />
      </Field>
      <Field id={`${id}-rent`} label="Rent (₹)" error={errors.rent?.message}>
        <Input
          id={`${id}-rent`}
          type="text"
          inputMode="numeric"
          {...register('rent')}
          enterKeyHint="next"
          className="tabular-nums"
        />
      </Field>
      <Checkbox {...register('is_active')} label="Active" />
      {activeError && (
        <p role="alert" className="text-[12.5px] font-medium text-danger-ink">
          {activeError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save bed'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function AddBedForm({ room, onDone }: { room: BoardRoom; onDone: () => void }) {
  const orgId = useOrgId()
  const { showToast } = useToast()
  const refresh = useRefreshBoard()
  const { register, handleSubmit, setError, formState } = useForm<BedFormValues>({
    resolver: zodResolver(bedSchema),
    defaultValues: { label: '', rent: '' },
  })
  const { errors } = formState

  const mutation = useMutation({
    mutationFn: async (v: BedFormValues) => {
      const { data } = await apiClient.POST('/api/v1/rooms/{room_id}/beds', {
        params: { path: { room_id: room.id }, header: header(orgId) },
        body: { label: v.label.trim(), base_rent_paise: parseRupeesToPaise(v.rent) },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: async (bed) => {
      await refresh()
      showToast(`Bed ${bed.label} added`, 'success')
      onDone()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setError('label', { type: 'server', message: err.message })
      } else {
        showToast(err instanceof ApiError ? err.message : 'Unable to add bed.', 'error')
      }
    },
  })

  const id = `addbed-${room.id}`
  return (
    <form
      onSubmit={handleSubmit((v) => mutation.mutate(v))}
      noValidate
      aria-label={`Add bed to room ${room.label}`}
      className="flex flex-col gap-3 border-t border-line pt-3"
    >
      <Field id={`${id}-label`} label="New bed label" error={errors.label?.message}>
        <Input id={`${id}-label`} type="text" {...register('label')} enterKeyHint="next" />
      </Field>
      <Field id={`${id}-rent`} label="New bed rent (₹)" error={errors.rent?.message}>
        <Input
          id={`${id}-rent`}
          type="text"
          inputMode="numeric"
          {...register('rent')}
          enterKeyHint="next"
          className="tabular-nums"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding…' : 'Add bed'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function BedRow({ bed }: { bed: BoardBed }) {
  const [editing, setEditing] = useState(false)
  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">{bed.label}</p>
          <p className="text-[14px] text-muted">
            <Money paise={bed.base_rent_paise} />
            {!bed.is_active && <span className="ml-2 text-[12.5px] text-muted">Inactive</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge kind="bed" value={bed.status} />
          {!editing && (
            <Button
              type="button"
              variant="secondary"
              
              aria-label={`Edit bed ${bed.label}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
        </div>
      </div>
      {editing && <EditBedForm bed={bed} onDone={() => setEditing(false)} />}
    </li>
  )
}

function RoomCard({
  room,
  warning,
  onWarning,
}: {
  room: BoardRoom
  warning?: string
  onWarning: (roomId: string, warning: string) => void
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'addBed'>('view')
  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3 shadow-sm sm:px-5" aria-label={`Room ${room.label}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Room {room.label}</h3>
          <p className="text-[14px] text-muted">
            {room.floor != null && (
              <>
                Floor <span className="tabular-nums">{room.floor}</span>
                {' · '}
              </>
            )}
            <span className="tabular-nums">{room.sharing}</span>-sharing{' · '}
            {room.is_ac ? 'AC' : 'Non-AC'}
          </p>
        </div>
        {mode === 'view' && (
          <Button
            type="button"
            variant="secondary"
            
            aria-label={`Edit room ${room.label}`}
            onClick={() => setMode('edit')}
          >
            Edit room
          </Button>
        )}
      </div>
      {warning && <div className="mt-2"><Warning>{warning}</Warning></div>}
      {mode === 'edit' && (
        <div className="mt-3">
          <EditRoomForm room={room} onDone={() => setMode('view')} onWarning={onWarning} />
        </div>
      )}
      <ul className="mt-2 divide-y divide-line">
        {room.beds.map((b) => (
          <BedRow key={b.id} bed={b} />
        ))}
      </ul>
      {mode === 'addBed' ? (
        <AddBedForm room={room} onDone={() => setMode('view')} />
      ) : (
        mode === 'view' && (
          <Button
            type="button"
            variant="secondary"
            block className="mt-2"
            onClick={() => setMode('addBed')}
          >
            Add bed to {room.label}
          </Button>
        )
      )}
    </section>
  )
}

export function RoomsPage() {
  const { propertyId } = useParams()
  const property = usePropertyQuery(propertyId)
  const board = useBedBoardQuery(propertyId)
  const [warnings, setWarnings] = useState<Record<string, string>>({})
  const onWarning = (roomId: string, warning: string) =>
    setWarnings((prev) => ({ ...prev, [roomId]: warning }))

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader back={{ to: `/owner/properties/${propertyId}`, label: property.data?.name ?? 'Back' }} title="Rooms &amp; beds" />

      {propertyId && <AddRoomForm propertyId={propertyId} onWarning={onWarning} />}

      {board.isLoading && (
        <Card>
          <LoadingRows label="Loading rooms…" />
        </Card>
      )}
      {board.isError && (
        <Notice role="alert">
          {board.error instanceof ApiError ? board.error.message : 'Unable to load rooms.'}
        </Notice>
      )}
      {board.data && board.data.length === 0 && (
        <Card>
          <EmptyState>No rooms yet. Add the first room above.</EmptyState>
        </Card>
      )}
      <div className="flex flex-col gap-3">
        {board.data?.map((room) => (
          <RoomCard key={room.id} room={room} warning={warnings[room.id]} onWarning={onWarning} />
        ))}
      </div>
    </div>
  )
}
