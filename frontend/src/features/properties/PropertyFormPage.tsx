import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, apiClient } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input, MoneyInput, Textarea } from '@/components/ui/input'
import { LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { useOrgId, usePropertyQuery, type Property } from './api'
import {
  DEFAULT_FORM_VALUES,
  formValuesToBody,
  propertySchema,
  propertyToFormValues,
  type PropertyFormValues,
} from './propertyForm'

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
  if (money) return <MoneyInput id={id} placeholder={placeholder} {...reg} />
  return (
    <Input
      id={id}
      type="text"
      inputMode={numeric ? 'numeric' : undefined}
      enterKeyHint="next"
      placeholder={placeholder}
      className={numeric ? 'tabular-nums' : undefined}
      {...reg}
    />
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
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: backTo, label: 'Back' }}
        title={property ? 'Edit property' : 'Add property'}
      />

      <form
        onSubmit={handleSubmit((v) => saveMutation.mutate(v))}
        className="flex max-w-xl flex-col gap-5"
        noValidate
      >
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <Field id="p-name" label="Name *" error={errors.name?.message}>
            <TextInput id="p-name" reg={register('name')} placeholder="Sunrise PG" />
          </Field>
          <Field id="p-address" label="Address" error={errors.address?.message}>
            <TextInput id="p-address" reg={register('address')} />
          </Field>
          <Field id="p-locality" label="Locality" error={errors.locality?.message}>
            <TextInput id="p-locality" reg={register('locality')} />
          </Field>
          <Field id="p-daily" label="Short-term daily rate" error={errors.short_term_daily_rate?.message}>
            <TextInput id="p-daily" money reg={register('short_term_daily_rate')} placeholder="500" />
          </Field>
          <Field
            id="p-exit"
            label="Exit deduction"
            hint="Deducted from deposit at move-out; residents accept this amount on Day 1"
            error={errors.exit_deduction?.message}
          >
            <TextInput id="p-exit" money reg={register('exit_deduction')} placeholder="0" />
          </Field>
          <Field id="p-rules" label="House rules" error={errors.house_rules?.message}>
            <Textarea id="p-rules" rows={4} {...register('house_rules')} />
          </Field>
          <Field id="p-fallback" label="Fallback UPI ID" error={errors.fallback_upi_id?.message}>
            <Input
              id="p-fallback"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="name@bank"
              {...register('fallback_upi_id')}
            />
          </Field>
          <Field id="p-bank" label="Bank details" error={errors.bank_details?.message}>
            <Textarea id="p-bank" rows={3} {...register('bank_details')} />
          </Field>
        </Card>

        <FieldGroup legend="Billing">
          <Field
            id="p-due-day"
            label="Rent due by day of month"
            hint="Rent is for the calendar month and shows as overdue after this day"
            error={errors.rent_due_day?.message}
          >
            <TextInput id="p-due-day" numeric reg={register('rent_due_day')} />
          </Field>
          <Field id="p-deposit" label="Security deposit (refundable)" error={errors.security_deposit?.message}>
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
            hint="Residents who give notice on or before this day leave at the end of that month; later notice means they also pay the next month"
            error={errors.notice_deadline_day?.message}
          >
            <TextInput id="p-notice-day" numeric reg={register('notice_deadline_day')} />
          </Field>
        </FieldGroup>

        <Button type="submit" size="lg" block disabled={saveMutation.isPending}>
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

  if (query.isLoading) {
    return (
      <Card>
        <LoadingRows label="Loading property…" />
      </Card>
    )
  }
  if (query.isError || !query.data) {
    return (
      <Notice role="alert">
        {query.error instanceof ApiError ? query.error.message : 'Unable to load property.'}
      </Notice>
    )
  }
  return <PropertyForm key={query.data.updated_at} property={query.data} />
}
