import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '@/api/client'
import type { components } from '@/api/schema'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PropertyChecklist } from './PropertyChecklist'
import { useAddStaff } from './useStaff'

type Property = components['schemas']['Property']

const schema = z.object({
  phone: z
    .string()
    .regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number starting with 6–9'),
  full_name: z.string().trim().min(1, 'Enter the full name').max(120),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  property_ids: z.array(z.string()),
})

type Values = z.infer<typeof schema>

export function AddCaretakerForm({
  properties,
  onDone,
}: {
  properties: Property[]
  onDone: () => void
}) {
  const { showToast } = useToast()
  const addStaff = useAddStaff()
  const [showPassword, setShowPassword] = useState(false)
  const [existing, setExisting] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '', full_name: '', password: '', property_ids: [] },
  })

  const onSubmit = (values: Values) => {
    addStaff.mutate(
      { ...values, role: 'caretaker' },
      {
        onSuccess: (data) => {
          if (data.existing_account) {
            setExisting(true)
          } else {
            showToast('Caretaker added', 'success')
            onDone()
          }
        },
        onError: (err) => {
          showToast(err instanceof ApiError ? err.message : 'Could not add caretaker', 'error')
        },
      },
    )
  }

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(getValues('password'))
      showToast('Password copied', 'success')
    } catch {
      showToast('Could not copy the password', 'error')
    }
  }

  if (existing) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface shadow-sm p-4">
        <p role="status" className="text-[14px] text-ink">
          This person already has a PG-CRM account; they'll use their existing password.
        </p>
        <Button
          type="button"
          onClick={onDone}
          block
        >
          Done
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Add caretaker"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface shadow-sm p-4"
    >
      <h2 className="text-[14px] font-semibold text-ink">Add caretaker</h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="staff-phone" className="text-[13.5px] font-medium text-ink">
          Mobile number
        </label>
        <Input
          id="staff-phone"
          autoComplete="off"
          enterKeyHint="next"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          placeholder="9876543210"
          {...register('phone')}
          className="tabular-nums"
        />
        {errors.phone && (
          <p role="alert" className="text-[12.5px] font-medium text-danger-ink">
            {errors.phone.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="staff-name" className="text-[13.5px] font-medium text-ink">
          Full name
        </label>
        <Input
          id="staff-name"
          autoCapitalize="words"
          enterKeyHint="next"
          type="text"
          autoComplete="off"
          {...register('full_name')}
        />
        {errors.full_name && (
          <p role="alert" className="text-[12.5px] font-medium text-danger-ink">
            {errors.full_name.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="staff-password" className="text-[13.5px] font-medium text-ink">
          Initial password
        </label>
        <div className="flex gap-2">
          <Input
            id="staff-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            {...register('password')}
            />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowPassword((s) => !s)}
            
          >
            {showPassword ? 'Hide' : 'Show'}
          </Button>
          <Button type="button" variant="secondary" onClick={copyPassword} >
            Copy
          </Button>
        </div>
        {errors.password && (
          <p role="alert" className="text-[12.5px] font-medium text-danger-ink">
            {errors.password.message}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[14px] font-medium text-ink">Buildings they can see</legend>
        <Controller
          control={control}
          name="property_ids"
          render={({ field }) => (
            <PropertyChecklist
              properties={properties}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </fieldset>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onDone} className="flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={addStaff.isPending}
          className="flex-1"
        >
          {addStaff.isPending ? 'Adding…' : 'Add caretaker'}
        </Button>
      </div>
    </form>
  )
}
