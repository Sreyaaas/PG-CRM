import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { parseRupeesToPaise } from '@/lib/money'
import { useAuth } from '@/features/auth/AuthContext'

export function BulkRoomsForm({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false)
  const { membership } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const orgId = membership?.org_id ?? ''

  const [floors, setFloors] = useState('6')
  const [roomsPerFloor, setRoomsPerFloor] = useState('4')
  const [startBase, setStartBase] = useState<'100' | '000'>('100')
  const [sharing, setSharing] = useState('2')
  const [isAc, setIsAc] = useState(false)
  const [rentRupees, setRentRupees] = useState('8000')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  const fCount = Math.min(20, Math.max(1, Number(floors) || 1))
  const rCount = Math.min(30, Math.max(1, Number(roomsPerFloor) || 1))
  const sCount = Math.min(4, Math.max(1, Number(sharing) || 2))

  const buildLabels = () => {
    const list: { label: string; floor: number }[] = []
    for (let f = 1; f <= fCount; f += 1) {
      const floorNum = startBase === '000' ? f - 1 : f
      for (let r = 1; r <= rCount; r += 1) {
        const label =
          startBase === '000' && floorNum === 0
            ? String(r).padStart(3, '0')
            : `${floorNum}${String(r).padStart(2, '0')}`
        list.push({ label, floor: f })
      }
    }
    return list
  }

  const preview = buildLabels()

  const handleGenerate = async () => {
    const rentPaise = parseRupeesToPaise(rentRupees)
    if (rentPaise === null || rentPaise <= 0) {
      showToast('Enter a valid base rent in rupees', 'error')
      return
    }
    setBusy(true)
    let created = 0
    try {
      for (const item of preview) {
        setProgress(`Creating ${item.label} (${created + 1}/${preview.length})…`)
        await apiClient.POST('/api/v1/properties/{property_id}/rooms', {
          params: { path: { property_id: propertyId }, header: { 'x-org-id': orgId } },
          body: {
            label: item.label,
            floor: item.floor,
            sharing: sCount,
            is_ac: isAc,
            base_rent_paise: rentPaise,
          },
        })
        created += 1
      }
      await queryClient.invalidateQueries({ queryKey: ['bed-board', orgId, propertyId] })
      showToast(`Created ${created} rooms (${created * sCount} beds)`, 'success')
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ['bed-board', orgId, propertyId] })
      showToast(
        err instanceof ApiError ? err.message : `Created ${created} rooms before an error occurred.`,
        'error',
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" block onClick={() => setOpen(true)}>
        Bulk generate rooms (multiple floors)
      </Button>
    )
  }

  return (
    <section
      aria-label="Bulk generate rooms"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Bulk generate rooms</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Create multiple floors and rooms at once (e.g. 6 floors × 4 rooms).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field id="bulk-floors" label="Floors">
          <Input
            id="bulk-floors"
            type="number"
            min={1}
            max={20}
            value={floors}
            onChange={(e) => setFloors(e.target.value)}
          />
        </Field>
        <Field id="bulk-rooms" label="Rooms / floor">
          <Input
            id="bulk-rooms"
            type="number"
            min={1}
            max={30}
            value={roomsPerFloor}
            onChange={(e) => setRoomsPerFloor(e.target.value)}
          />
        </Field>
        <Field id="bulk-start" label="Numbering from">
          <Select id="bulk-start" value={startBase} onChange={(e) => setStartBase(e.target.value as '100' | '000')}>
            <option value="100">100 (101, 201…)</option>
            <option value="000">000 (001, 101…)</option>
          </Select>
        </Field>
        <Field id="bulk-sharing" label="Sharing">
          <Select id="bulk-sharing" value={sharing} onChange={(e) => setSharing(e.target.value)}>
            <option value="1">1-sharing</option>
            <option value="2">2-sharing</option>
            <option value="3">3-sharing</option>
            <option value="4">4-sharing</option>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 items-end gap-3">
        <Field id="bulk-rent" label="Base rent (₹ / bed)">
          <Input
            id="bulk-rent"
            type="number"
            min={100}
            value={rentRupees}
            onChange={(e) => setRentRupees(e.target.value)}
          />
        </Field>
        <label className="flex h-11 items-center gap-2 rounded-control border border-line bg-surface-2 px-3 text-[14px] font-medium text-ink">
          <input type="checkbox" checked={isAc} onChange={(e) => setIsAc(e.target.checked)} className="size-4" />
          AC rooms
        </label>
      </div>

      <p className="text-[12.5px] text-muted tabular-nums">
        Preview: <strong>{preview.length}</strong> rooms ({preview.length * sCount} beds) —{' '}
        {preview.slice(0, 4).map((p) => p.label).join(', ')}
        {preview.length > 4 ? ` … ${preview[preview.length - 1].label}` : ''}
      </p>

      <Button type="button" variant="brand" block disabled={busy} onClick={handleGenerate}>
        {progress ?? `Generate ${preview.length} rooms`}
      </Button>
    </section>
  )
}
