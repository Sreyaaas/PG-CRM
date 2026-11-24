import { useState } from 'react'
import { ApiError } from '@/api/client'
import type { components } from '@/api/schema'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
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
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface shadow-sm p-4">
      <h2 className="text-[14px] font-semibold text-ink">Edit {member.full_name}</h2>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[14px] font-medium text-ink">Buildings they can see</legend>
        <PropertyChecklist properties={properties} value={ids} onChange={setIds} />
      </fieldset>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onDone} className="flex-1">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={update.isPending}
          className="flex-1"
        >
          Save
        </Button>
      </div>
      {member.is_active && (
        <Button
          type="button"
          variant="danger"
          block
          onClick={() => setConfirming(true)}
        >
          Deactivate
        </Button>
      )}

      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Deactivate ${member.full_name}?`}
        ariaLabel="Confirm deactivate"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={deactivate} disabled={update.isPending}>
              Confirm deactivate
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-muted">They will lose access immediately.</p>
      </Sheet>
    </div>
  )
}
