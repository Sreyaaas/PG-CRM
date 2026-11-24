import { z } from 'zod'
import { parseRupeesToPaise } from '@/lib/money'
import type { Property, PropertyCreate } from './api'

function rupees(label: string, opts: { positive?: boolean } = {}) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) return
    try {
      const paise = parseRupeesToPaise(value)
      if (paise < 0 || (opts.positive && paise === 0)) {
        ctx.addIssue({
          code: 'custom',
          message: opts.positive ? `${label} must be more than ₹0` : `${label} cannot be negative`,
        })
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: `Enter ${label.toLowerCase()} in rupees, e.g. 4500` })
    }
  })
}

function dayOfMonth(label: string) {
  return z
    .string()
    .regex(/^\d+$/, `${label} must be a number from 1 to 28`)
    .refine((v) => Number(v) >= 1 && Number(v) <= 28, `${label} must be a number from 1 to 28`)
}

export const propertySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  address: z.string(),
  locality: z.string(),
  short_term_daily_rate: rupees('Daily rate', { positive: true }),
  exit_deduction: rupees('Exit deduction'),
  house_rules: z.string(),
  fallback_upi_id: z.string(),
  bank_details: z.string(),
  rent_due_day: dayOfMonth('Rent due day'),
  security_deposit: rupees('Security deposit'),
  maintenance_charge: rupees('Maintenance charge'),
  notice_deadline_day: dayOfMonth('Notice deadline day'),
})

export type PropertyFormValues = z.infer<typeof propertySchema>

export const DEFAULT_FORM_VALUES: PropertyFormValues = {
  name: '',
  address: '',
  locality: '',
  short_term_daily_rate: '',
  exit_deduction: '',
  house_rules: '',
  fallback_upi_id: '',
  bank_details: '',
  rent_due_day: '5',
  security_deposit: '',
  maintenance_charge: '',
  notice_deadline_day: '5',
}

/** Integer paise to an editable rupee string, using integer math only. */
export function paiseToRupeeInput(paise: number): string {
  const whole = Math.floor(paise / 100)
  const frac = paise % 100
  if (frac === 0) return String(whole)
  return `${whole}.${String(frac).padStart(2, '0')}`
}

export function propertyToFormValues(p: Property): PropertyFormValues {
  return {
    name: p.name,
    address: p.address ?? '',
    locality: p.locality ?? '',
    short_term_daily_rate:
      p.short_term_daily_rate_paise == null ? '' : paiseToRupeeInput(p.short_term_daily_rate_paise),
    exit_deduction: paiseToRupeeInput(p.exit_deduction_paise),
    house_rules: p.house_rules ?? '',
    fallback_upi_id: p.fallback_upi_id ?? '',
    bank_details: p.bank_details ?? '',
    rent_due_day: String(p.rent_due_day),
    security_deposit: paiseToRupeeInput(p.security_deposit_paise),
    maintenance_charge: paiseToRupeeInput(p.maintenance_charge_paise),
    notice_deadline_day: String(p.notice_deadline_day),
  }
}

const orNull = (v: string) => (v.trim() ? v.trim() : null)
const paiseOrZero = (v: string) => (v.trim() ? parseRupeesToPaise(v) : 0)

/** Request body for both POST (create) and PATCH (edit); money converted to paise. */
export function formValuesToBody(v: PropertyFormValues): PropertyCreate {
  return {
    name: v.name.trim(),
    address: orNull(v.address),
    locality: orNull(v.locality),
    short_term_daily_rate_paise: v.short_term_daily_rate.trim()
      ? parseRupeesToPaise(v.short_term_daily_rate)
      : null,
    exit_deduction_paise: paiseOrZero(v.exit_deduction),
    house_rules: orNull(v.house_rules),
    fallback_upi_id: orNull(v.fallback_upi_id),
    bank_details: orNull(v.bank_details),
    rent_due_day: Number(v.rent_due_day),
    security_deposit_paise: paiseOrZero(v.security_deposit),
    maintenance_charge_paise: paiseOrZero(v.maintenance_charge),
    notice_deadline_day: Number(v.notice_deadline_day),
  }
}
