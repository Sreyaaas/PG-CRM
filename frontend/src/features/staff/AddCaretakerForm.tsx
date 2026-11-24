import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '@/api/client'
import type { components } from '@/api/schema'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
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

const inputClass =
  'h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900'

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
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <p role="status" className="text-sm text-slate-800">
          This person already has a PG-CRM account; they'll use their existing password.
        </p>
        <Button
          type="button"
          onClick={onDone}
          className="h-11 w-full bg-slate-900 text-white hover:bg-slate-800"
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
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">Add caretaker</h2>

      <div className="space-y-1.5">
        <label htmlFor="staff-phone" className="block text-sm font-medium text-slate-700">
          Mobile number
        </label>
        <input
          id="staff-phone"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          placeholder="9876543210"
          {...register('phone')}
          className={`${inputClass} tabular-nums`}
        />
        {errors.phone && <p className="text-xs text-red-700">{errors.phone.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="staff-name" className="block text-sm font-medium text-slate-700">
          Full name
        </label>
        <input
          id="staff-name"
          type="text"
          autoComplete="off"
          {...register('full_name')}
          className={inputClass}
        />
        {errors.full_name && <p className="text-xs text-red-700">{errors.full_name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="staff-password" className="block text-sm font-medium text-slate-700">
          Initial password
        </label>
        <div className="flex gap-2">
          <input
            id="staff-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            {...register('password')}
            className={inputClass}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowPassword((s) => !s)}
            className="h-11 px-3"
          >
            {showPassword ? 'Hide' : 'Show'}
          </Button>
          <Button type="button" variant="outline" onClick={copyPassword} className="h-11 px-3">
            Copy
          </Button>
        </div>
        {errors.password && <p className="text-xs text-red-700">{errors.password.message}</p>}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-slate-700">Buildings they can see</legend>
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
        <Button type="button" variant="outline" onClick={onDone} className="h-11 flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={addStaff.isPending}
          className="h-11 flex-1 bg-slate-900 text-white hover:bg-slate-800"
        >
          {addStaff.isPending ? 'Adding…' : 'Add caretaker'}
        </Button>
      </div>
    </form>
  )
}
