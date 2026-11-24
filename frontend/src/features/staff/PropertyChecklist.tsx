import type { components } from '@/api/schema'

type Property = components['schemas']['Property']

interface Props {
  properties: Property[]
  value: string[]
  onChange: (ids: string[]) => void
}

export function PropertyChecklist({ properties, value, onChange }: Props) {
  if (properties.length === 0) {
    return <p className="text-sm text-slate-500">No buildings added yet.</p>
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {properties.map((p) => {
        const checked = value.includes(p.id)
        return (
          <li key={p.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm text-slate-900">
              <input
                type="checkbox"
                className="h-5 w-5 accent-slate-900"
                checked={checked}
                onChange={() =>
                  onChange(checked ? value.filter((id) => id !== p.id) : [...value, p.id])
                }
              />
              <span>{p.name}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}
