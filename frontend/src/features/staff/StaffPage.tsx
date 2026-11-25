import { useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Badge, type Tone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, LoadingRows, PageHeader } from '@/components/ui/misc'
import { AddCaretakerForm } from './AddCaretakerForm'
import { EditStaffPanel } from './EditStaffPanel'
import { usePropertiesQuery, useStaffQuery } from './useStaff'

function Pill({ children, tone = 'neutral' }: { children: string; tone?: Tone }) {
  return <Badge tone={tone}>{children}</Badge>
}

export function StaffPage() {
  const { showToast } = useToast()
  const staffQuery = useStaffQuery()
  const propertiesQuery = usePropertiesQuery()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const loadError = staffQuery.error ?? propertiesQuery.error
  useEffect(() => {
    if (loadError) {
      showToast(loadError instanceof ApiError ? loadError.message : 'Could not load staff', 'error')
    }
  }, [loadError, showToast])

  const properties = propertiesQuery.data ?? []
  const propertyName = (id: string) =>
    properties.find((p) => p.id === id)?.name ?? 'Unknown building'
  const staff = staffQuery.data ?? []
  const editing = staff.find((m) => m.user_id === editingId && m.role !== 'owner')

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={{ to: '/owner/more', label: 'More' }}
        title="Staff"
        actions={
          !adding && (
            <Button
              type="button"
              onClick={() => {
                setEditingId(null)
                setAdding(true)
              }}
            >
              <UserPlus aria-hidden="true" />
              Add caretaker
            </Button>
          )
        }
      />

      {adding && <AddCaretakerForm properties={properties} onDone={() => setAdding(false)} />}

      {editing && (
        <EditStaffPanel
          key={editing.user_id}
          member={editing}
          properties={properties}
          onDone={() => setEditingId(null)}
        />
      )}

      {staffQuery.isLoading && (
        <Card>
          <LoadingRows label="Loading staff…" />
        </Card>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        {staff.map((m) => (
          <li key={m.user_id} className="flex flex-col gap-2.5 px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-3">
              <Avatar name={m.full_name} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-semibold text-ink">{m.full_name}</div>
                <div className="text-[12.5px] tabular-nums text-muted">{m.phone}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Pill>{m.role === 'owner' ? 'Owner' : 'Caretaker'}</Pill>
                <Pill tone={m.is_active ? 'success' : 'neutral'}>{m.is_active ? 'Active' : 'Inactive'}</Pill>
              </div>
            </div>
            {m.role !== 'owner' && (
              <div className="flex flex-wrap gap-1.5">
                {m.assigned_property_ids.length === 0 ? (
                  <span className="text-[12.5px] text-muted">No buildings assigned</span>
                ) : (
                  m.assigned_property_ids.map((id) => (
                    <span
                      key={id}
                      className="inline-flex h-7 items-center rounded-chip border border-line bg-surface-2 px-2.5 text-[12.5px] font-medium text-ink"
                    >
                      {propertyName(id)}
                    </span>
                  ))
                )}
              </div>
            )}
            {m.role !== 'owner' && m.is_active && (
              <Button
                type="button"
                variant="secondary"
                aria-label={`Edit ${m.full_name}`}
                onClick={() => {
                  setAdding(false)
                  setEditingId(m.user_id)
                }}
                block
              >
                Edit
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
