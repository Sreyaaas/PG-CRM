import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/api/client'
import type { components } from '@/api/schema'
import { useToast } from '@/components/Toast'
import { Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { useOrgId } from '@/features/properties/api'
import { residentKey } from './api'

type Resident = components['schemas']['Resident']
type ProfileUpdate = components['schemas']['ResidentProfileUpdate']
type Food = NonNullable<ProfileUpdate['food_preference']>
type Police = ProfileUpdate['police_verification_status']

const FOOD: { value: Food; label: string }[] = [
  { value: 'veg', label: 'Veg' },
  { value: 'egg', label: 'Egg' },
  { value: 'non_veg', label: 'Non-veg' },
]
const POLICE: { value: Police; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'verified', label: 'Verified' },
]

function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

export function ProfileEditSheet({ resident, open, onClose }: { resident: Resident; open: boolean; onClose: () => void }) {
  return open ? <ProfileEditForm resident={resident} onClose={onClose} /> : null
}

function ProfileEditForm({ resident, onClose }: { resident: Resident; onClose: () => void }) {
  const orgId = useOrgId()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const [food, setFood] = useState<Food | null>((resident.food_preference as Food | null) ?? null)
  const [vehicle, setVehicle] = useState(resident.vehicle_number ?? '')
  const [relation, setRelation] = useState(resident.emergency_contact_relation ?? '')
  const [police, setPolice] = useState<Police>(resident.police_verification_status as Police)
  const [policeDate, setPoliceDate] = useState(resident.police_verification_date ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (body: ProfileUpdate) => {
      const { data } = await apiClient.PATCH('/api/v1/residents/{resident_id}/profile', {
        params: { path: { resident_id: resident.id }, header: { 'x-org-id': orgId } },
        body,
      })
      return data
    },
    onSuccess: () => {
      showToast('Profile updated', 'success')
      qc.invalidateQueries({ queryKey: residentKey(orgId, resident.id) })
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : 'Unable to save.'),
  })

  const submit = () => {
    if (police !== 'pending' && !policeDate) return setError('Add the date the police verification was submitted or completed.')
    setError(null)
    save.mutate({
      food_preference: food,
      vehicle_number: vehicle.trim() ? vehicle.trim().toUpperCase() : null,
      emergency_contact_relation: relation.trim() || null,
      police_verification_status: police,
      police_verification_date: police === 'pending' ? null : policeDate || null,
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit profile"
      description={resident.full_name}
      footer={
        <Button type="button" block disabled={save.isPending} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save profile'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice role="alert">{error}</Notice>}

        <div className="flex flex-col gap-2">
          <span className="text-[13.5px] font-medium text-ink">Police verification</span>
          <div role="group" aria-label="Police verification" className="flex gap-2">
            {POLICE.map((p) => (
              <Chip
                key={p.value}
                pressed={police === p.value}
                onClick={() => {
                  setPolice(p.value)
                  if (p.value !== 'pending' && !policeDate) setPoliceDate(todayIST())
                }}
              >
                {p.label}
              </Chip>
            ))}
          </div>
        </div>
        {police !== 'pending' && (
          <Field id="police-date" label={police === 'verified' ? 'Verified on' : 'Submitted on'}>
            <Input id="police-date" type="date" max={todayIST()} value={policeDate} onChange={(e) => setPoliceDate(e.target.value)} />
          </Field>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[13.5px] font-medium text-ink">Food preference</span>
          <div role="group" aria-label="Food preference" className="flex gap-2">
            {FOOD.map((f) => (
              <Chip key={f.value} pressed={food === f.value} onClick={() => setFood(food === f.value ? null : f.value)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        <Field id="vehicle" label="Vehicle number (optional)">
          <Input
            id="vehicle"
            value={vehicle}
            maxLength={20}
            autoCapitalize="characters"
            spellCheck={false}
            className="uppercase"
            placeholder="KA01AB1234"
            onChange={(e) => setVehicle(e.target.value)}
          />
        </Field>

        <Field id="relation" label="Emergency contact is their…" hint={resident.emergency_contact_name ?? undefined}>
          <Select id="relation" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option value="">Not set</option>
            {['Father', 'Mother', 'Parent', 'Sibling', 'Spouse', 'Relative', 'Friend', 'Guardian'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            {relation && !['Father', 'Mother', 'Parent', 'Sibling', 'Spouse', 'Relative', 'Friend', 'Guardian'].includes(relation) && (
              <option value={relation}>{relation}</option>
            )}
          </Select>
        </Field>
      </div>
    </Sheet>
  )
}
