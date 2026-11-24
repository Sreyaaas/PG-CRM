import { useState } from 'react'
import { ApiError } from '@/api/client'
import type { components } from '@/api/schema'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { PropertyChecklist } from './PropertyChecklist'
import { useUpdateStaff, type StaffMember } from './useStaff'

type Property = components['schemas']['Property']

export function EditStaffPanel({
  member,
  properties,
  onDone,
}: {
  member: StaffMember
  properties: Property[]
  onDone: () => void
}) {
  const { showToast } = useToast()
  const update = useUpdateStaff()
  const [ids, setIds] = useState<string[]>(member.assigned_property_ids)
  const [confirming, setConfirming] = useState(false)

  const fail = (err: unknown) =>
    showToast(err instanceof ApiError ? err.message : 'Could not update staff member', 'error')

  const save = () =>
    update.mutate(
      { userId: member.user_id, body: { assigned_property_ids: ids } },
      {
        onSuccess: () => {
          showToast('Buildings updated', 'success')
          onDone()
        },
        onError: fail,
      },
    )

  const deactivate = () =>
    update.mutate(
      { userId: member.user_id, body: { is_active: false } },
      {
        onSuccess: () => {
          showToast(`${member.full_name} deactivated`, 'success')
          setConfirming(false)
          onDone()
        },
        onError: (err) => {
          setConfirming(false)
          fail(err)
        },
      },
    )

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Edit {member.full_name}</h2>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-slate-700">Buildings they can see</legend>
        <PropertyChecklist properties={properties} value={ids} onChange={setIds} />
      </fieldset>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onDone} className="h-11 flex-1">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={update.isPending}
          className="h-11 flex-1 bg-slate-900 text-white hover:bg-slate-800"
        >
          Save
        </Button>
      </div>
      {member.is_active && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(true)}
          className="h-11 w-full border-red-300 text-red-800 hover:bg-red-50"
        >
          Deactivate
        </Button>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm deactivate"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
        >
          <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-base font-semibold text-slate-950">
              Deactivate {member.full_name}?
            </h3>
            <p className="text-sm text-slate-600">They will lose access immediately.</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                className="h-11 flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={deactivate}
                disabled={update.isPending}
                className="h-11 flex-1 bg-slate-900 text-white hover:bg-slate-800"
              >
                Confirm deactivate
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
