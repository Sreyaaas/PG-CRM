import { z } from 'zod'
import { formatINR, parseRupeesToPaise } from '@/lib/money'

export function rentField(label = 'Rent per bed') {
  return z.string().superRefine((value, ctx) => {
    let paise = 0
    try {
      paise = parseRupeesToPaise(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: `Enter ${label.toLowerCase()} in rupees, e.g. 6000` })
      return
    }
    if (paise <= 0) ctx.addIssue({ code: 'custom', message: `${label} must be more than ₹0` })
  })
}

const wholeNumber = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^-?\d+$/.test(v), `${label} must be a whole number`)

export const roomSchema = z.object({
  label: z.string().trim().min(1, 'Room label is required'),
  floor: wholeNumber('Floor'),
  sharing: z.number().int().min(1).max(8),
  is_ac: z.boolean(),
  area_sqft: wholeNumber('Area').refine((v) => v === '' || Number(v) > 0, 'Area must be more than 0'),
  rent: rentField(),
})
export type RoomFormValues = z.infer<typeof roomSchema>

export const bedSchema = z.object({
  label: z.string().trim().min(1, 'Bed label is required'),
  rent: rentField('Rent'),
})
export type BedFormValues = z.infer<typeof bedSchema>

export function bedLabels(room: string, sharing: number): string[] {
  return Array.from({ length: sharing }, (_, i) => `${room}-${String.fromCharCode(65 + i)}`)
}

/** e.g. "Creates 3 beds: 204-A, 204-B, 204-C at ₹6,000 each" */
export function previewText(label: string, sharing: number, rent: string): string | null {
  const room = label.trim()
  if (!room) return null
  let paise: number
  try {
    paise = parseRupeesToPaise(rent)
  } catch {
    return null
  }
  if (paise <= 0) return null
  const noun = sharing === 1 ? 'bed' : 'beds'
  return `Creates ${sharing} ${noun}: ${bedLabels(room, sharing).join(', ')} at ${formatINR(paise)} each`
}

export const toIntOrNull = (v: string) => (v.trim() ? Number(v.trim()) : null)

/** Integer paise to an editable rupee string, integer math only. */
export function paiseToRupeeInput(paise: number): string {
  const whole = Math.floor(paise / 100)
  const frac = paise % 100
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`
}
