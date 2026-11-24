import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { AddCaretakerForm } from './AddCaretakerForm'
import { EditStaffPanel } from './EditStaffPanel'
import { usePropertiesQuery, useStaffQuery } from './useStaff'

function Pill({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
      {children}
    </span>
  )
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
    <div className="space-y-4">
      <div className="border-b border-slate-200 pb-4">
        <Link to="/owner/more" className="text-xs text-slate-500 underline underline-offset-4">
          More
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">Staff</h1>
          {!adding && (
            <Button
              type="button"
              onClick={() => {
                setEditingId(null)
                setAdding(true)
              }}
              className="h-11 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Add caretaker
            </Button>
          )}
        </div>
      </div>

      {adding && <AddCaretakerForm properties={properties} onDone={() => setAdding(false)} />}

      {editing && (
        <EditStaffPanel
          key={editing.user_id}
          member={editing}
          properties={properties}
          onDone={() => setEditingId(null)}
        />
      )}

      {staffQuery.isLoading && <p className="text-sm text-slate-500">Loading staff…</p>}

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {staff.map((m) => (
          <li key={m.user_id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-950">{m.full_name}</div>
                <div className="text-xs tabular-nums text-slate-500">{m.phone}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Pill>{m.role === 'owner' ? 'Owner' : 'Caretaker'}</Pill>
                <Pill>{m.is_active ? 'Active' : 'Inactive'}</Pill>
              </div>
            </div>
            {m.role !== 'owner' && (
              <div className="flex flex-wrap gap-1.5">
                {m.assigned_property_ids.length === 0 ? (
                  <span className="text-xs text-slate-500">No buildings assigned</span>
                ) : (
                  m.assigned_property_ids.map((id) => (
                    <span
                      key={id}
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
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
                variant="outline"
                aria-label={`Edit ${m.full_name}`}
                onClick={() => {
                  setAdding(false)
                  setEditingId(m.user_id)
                }}
                className="h-11 w-full"
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
