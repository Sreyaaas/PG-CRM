import type { ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, apiClient } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { useOrgId, usePropertyQuery, type Property } from './api'
import {
  DEFAULT_FORM_VALUES,
  formValuesToBody,
  propertySchema,
  propertyToFormValues,
  type PropertyFormValues,
} from './propertyForm'

const INPUT =
  'h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900'
const TEXTAREA =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900'

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string
  label: string
  help?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {help && <p className="text-xs text-slate-500">{help}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  )
}

function TextInput({
  id,
  reg,
  numeric,
  money,
  placeholder,
}: {
  id: string
  reg: UseFormRegisterReturn
  numeric?: boolean
  money?: boolean
  placeholder?: string
}) {
  return (
    <div className={money ? 'relative' : undefined}>
      {money && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-slate-500">
          ₹
        </span>
      )}
      <input
        id={id}
        type="text"
        inputMode={numeric || money ? 'numeric' : undefined}
        placeholder={placeholder}
        {...reg}
        className={`${INPUT} ${numeric || money ? 'tabular-nums' : ''} ${money ? 'pl-7' : ''}`}
      />
    </div>
  )
}

function PropertyForm({ property }: { property?: Property }) {
  const orgId = useOrgId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: property ? propertyToFormValues(property) : DEFAULT_FORM_VALUES,
  })

  const saveMutation = useMutation({
    mutationFn: async (values: PropertyFormValues) => {
      const body = formValuesToBody(values)
      const header = { 'x-org-id': orgId }
      if (property) {
        const { data } = await apiClient.PATCH('/api/v1/properties/{property_id}', {
          params: { path: { property_id: property.id }, header },
          body,
        })
        if (!data) throw new Error('Empty response')
        return data
      }
      const { data } = await apiClient.POST('/api/v1/properties', { params: { header }, body })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      showToast(property ? 'Property saved' : 'Property created', 'success')
      navigate(`/owner/properties/${saved.id}`)
    },
    onError: (err) => {
      showToast(err instanceof ApiError ? err.message : 'Unable to save property.', 'error')
    },
  })

  const backTo = property ? `/owner/properties/${property.id}` : '/owner/properties'

  return (
    <div className="space-y-5">
      <div className="border-b border-slate-200 pb-4">
        <Link to={backTo} className="text-xs text-slate-500 underline underline-offset-4">
          Back
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
          {property ? 'Edit property' : 'Add property'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit((v) => saveMutation.mutate(v))}
        className="max-w-xl space-y-4"
        noValidate
      >
        <Field id="p-name" label="Name *" error={errors.name?.message}>
          <TextInput id="p-name" reg={register('name')} placeholder="Sunrise PG" />
        </Field>
        <Field id="p-address" label="Address" error={errors.address?.message}>
          <TextInput id="p-address" reg={register('address')} />
        </Field>
        <Field id="p-locality" label="Locality" error={errors.locality?.message}>
          <TextInput id="p-locality" reg={register('locality')} />
        </Field>
        <Field
          id="p-daily"
          label="Short-term daily rate"
          error={errors.short_term_daily_rate?.message}
        >
          <TextInput id="p-daily" money reg={register('short_term_daily_rate')} placeholder="500" />
        </Field>
        <Field
          id="p-exit"
          label="Exit deduction"
          help="Deducted from deposit at move-out; residents accept this amount on Day 1"
          error={errors.exit_deduction?.message}
        >
          <TextInput id="p-exit" money reg={register('exit_deduction')} placeholder="0" />
        </Field>
        <Field id="p-rules" label="House rules" error={errors.house_rules?.message}>
          <textarea id="p-rules" rows={4} {...register('house_rules')} className={TEXTAREA} />
        </Field>
        <Field id="p-fallback" label="Fallback UPI ID" error={errors.fallback_upi_id?.message}>
          <TextInput id="p-fallback" reg={register('fallback_upi_id')} placeholder="name@bank" />
        </Field>
        <Field id="p-bank" label="Bank details" error={errors.bank_details?.message}>
          <textarea id="p-bank" rows={3} {...register('bank_details')} className={TEXTAREA} />
        </Field>

        <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Billing</legend>
          <Field
            id="p-due-day"
            label="Rent due by day of month"
            help="Rent is for the calendar month and shows as overdue after this day"
            error={errors.rent_due_day?.message}
          >
            <TextInput id="p-due-day" numeric reg={register('rent_due_day')} />
          </Field>
          <Field
            id="p-deposit"
            label="Security deposit (refundable)"
            error={errors.security_deposit?.message}
          >
            <TextInput id="p-deposit" money reg={register('security_deposit')} placeholder="0" />
          </Field>
          <Field
            id="p-maint"
            label="Maintenance charge at joining (one-time, not refundable)"
            error={errors.maintenance_charge?.message}
          >
            <TextInput id="p-maint" money reg={register('maintenance_charge')} placeholder="0" />
          </Field>
          <Field
            id="p-notice-day"
            label="Notice deadline day"
            help="Residents who give notice on or before this day leave at the end of that month; later notice means they also pay the next month"
            error={errors.notice_deadline_day?.message}
          >
            <TextInput id="p-notice-day" numeric reg={register('notice_deadline_day')} />
          </Field>
        </fieldset>

        <Button
          type="submit"
          disabled={saveMutation.isPending}
          className="h-11 w-full bg-slate-900 text-sm font-medium text-white hover:bg-slate-800"
        >
          {saveMutation.isPending ? 'Saving…' : property ? 'Save changes' : 'Create property'}
        </Button>
      </form>
    </div>
  )
}

export function PropertyCreatePage() {
  return <PropertyForm />
}

export function PropertyEditPage() {
  const { propertyId } = useParams()
  const query = usePropertyQuery(propertyId)

  if (query.isLoading) return <p className="text-sm text-slate-500">Loading property…</p>
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {query.error instanceof ApiError ? query.error.message : 'Unable to load property.'}
      </div>
    )
  }
  return <PropertyForm key={query.data.updated_at} property={query.data} />
}
