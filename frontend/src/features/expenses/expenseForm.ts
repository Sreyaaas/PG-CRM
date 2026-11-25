import { z } from 'zod'
import type { ExpenseCategory } from './api'
import { parseRupeesToPaise } from '@/lib/money'

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  water_tanker: 'Water tanker',
  electricity_bescom: 'Electricity',
  groceries: 'Groceries',
  gas_lpg: 'Gas (LPG)',
  maintenance_repairs: 'Repairs',
  cleaning: 'Cleaning',
  internet: 'Internet',
  staff_salary: 'Staff salary',
  security: 'Security',
  lease_rent: 'Lease rent',
  other: 'Other',
}

/** Water tanker first (the most common spend); lease rent is owner-only. */
export const CATEGORY_ORDER: ExpenseCategory[] = [
  'water_tanker',
  'electricity_bescom',
  'groceries',
  'gas_lpg',
  'maintenance_repairs',
  'cleaning',
  'internet',
  'staff_salary',
  'security',
  'lease_rent',
  'other',
]

export const LOCATION_REQUIRED = 'Location is required for expenses without a bill'
export const NOTE_MIN = 5

/** Date in IST as YYYY-MM-DD, shifted by `offsetDays` from today. */
export function istDate(offsetDays = 0, now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000 + offsetDays * 86_400_000)
  return ist.toISOString().slice(0, 10)
}

export const expenseSchema = z
  .object({
    property_id: z.string().min(1, 'Choose a building'),
    category: z.string().min(1, 'Choose a category'),
    amount: z
      .string()
      .trim()
      .min(1, 'Enter the amount')
      .refine((v) => {
        try {
          return parseRupeesToPaise(v) > 0
        } catch {
          return false
        }
      }, 'Enter a valid amount in rupees'),
    quantity: z.string().trim(),
    unit: z.string().trim().max(20, 'Unit is too long'),
    expense_date: z.string().min(1, 'Choose the date'),
    vendor_name: z.string().trim().max(120, 'Vendor name is too long'),
    notes: z.string().trim().max(1000, 'Notes are too long'),
    bill_mode: z.enum(['has_bill', 'no_bill']),
    paid_from: z.enum(['caretaker_cash', 'owner_direct']),
  })
  .superRefine((v, ctx) => {
    if (v.bill_mode === 'no_bill' && v.notes.length < NOTE_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['notes'],
        message: `A note of at least ${NOTE_MIN} characters is required without a bill`,
      })
    }
    if (v.category === 'water_tanker' && v.quantity) {
      const q = Number(v.quantity)
      if (!Number.isFinite(q) || q <= 0) {
        ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a valid quantity' })
      }
    }
  })

export type ExpenseFormValues = z.infer<typeof expenseSchema>

export function mapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`
}
