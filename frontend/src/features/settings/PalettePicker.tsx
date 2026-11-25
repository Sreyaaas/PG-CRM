import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PALETTES, type PaletteChoice } from './appearance'

/** Swatch grid for the accent palette. A radio group, so arrow keys and screen readers work as expected. */
export function PalettePicker({ value, onChange }: { value: PaletteChoice; onChange: (v: PaletteChoice) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span id="palette-label" className="text-[13.5px] font-medium text-ink">
        Colour palette
      </span>
      <div role="radiogroup" aria-labelledby="palette-label" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PALETTES.map((p) => {
          const selected = value === p.value
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(p.value)}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-control border px-3 py-2.5 text-left transition-colors',
                selected ? 'border-ink bg-surface-2' : 'border-line bg-surface hover:bg-surface-2',
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line"
                style={{ background: p.brand }}
              >
                {selected && <Check className="size-4" strokeWidth={3} color={p.value === 'marigold' ? '#1c1917' : '#ffffff'} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink">{p.label}</span>
                <span className="block truncate text-[12.5px] text-muted">{p.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
