import type { components } from '@/api/schema'

type Property = components['schemas']['Property']

interface Props {
  properties: Property[]
  value: string[]
  onChange: (ids: string[]) => void
}

export function PropertyChecklist({ properties, value, onChange }: Props) {
  if (properties.length === 0) {
    return <p className="text-[14px] text-muted">No buildings added yet.</p>
  }
  return (
    <ul className="divide-y divide-line rounded-control border border-line bg-surface">
      {properties.map((p) => {
        const checked = value.includes(p.id)
        return (
          <li key={p.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-[14px] text-ink">
              <input
                type="checkbox"
                className="size-5"
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
