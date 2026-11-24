import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ApiError, apiClient } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthContext'

const signupSchema = z.object({
  phone: z
    .string()
    .regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number starting with 6–9'),
  full_name: z.string().trim().min(1, 'Enter your full name').max(120),
  organization_name: z.string().trim().min(1, 'Enter your PG / organization name').max(120),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

type SignupFormValues = z.infer<typeof signupSchema>

export function SignupPage() {
  const { session, membership, loginWithToken } = useAuth()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { phone: '', full_name: '', organization_name: '', password: '' },
  })

  const signupMutation = useMutation({
    mutationFn: async (values: SignupFormValues) => {
      const { data } = await apiClient.POST('/api/v1/auth/signup', {
        body: values,
      })
      if (!data) {
        throw new Error('Empty signup response')
      }
      return data
    },
    onSuccess: (data) => {
      setFormError(null)
      loginWithToken(data)
      navigate('/owner', { replace: true })
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Unable to create account.'
      setFormError(msg)
      showToast(msg, 'error')
    },
  })

  if (session) {
    if (!membership) {
      return <Navigate to="/select-org" replace />
    }
    return <Navigate to={membership.role === 'owner' ? '/owner' : '/caretaker'} replace />
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 text-slate-950">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">
            Create PG-CRM account
          </h1>
          <p className="mt-1 text-sm text-slate-500">Set up your organization as a PG owner.</p>
        </div>

        {formError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit((values) => signupMutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="signup-name" className="block text-sm font-medium text-slate-700">
              Full name
            </label>
            <input
              id="signup-name"
              type="text"
              placeholder="Meera Nair"
              {...register('full_name')}
              className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {errors.full_name && <p className="text-xs text-red-700">{errors.full_name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-org" className="block text-sm font-medium text-slate-700">
              Organization / PG group name
            </label>
            <input
              id="signup-org"
              type="text"
              placeholder="Sunrise Living PGs"
              {...register('organization_name')}
              className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {errors.organization_name && (
              <p className="text-xs text-red-700">{errors.organization_name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-phone" className="block text-sm font-medium text-slate-700">
              Mobile number
            </label>
            <input
              id="signup-phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="9876543210"
              {...register('phone')}
              className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base tabular-nums text-slate-950 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {errors.phone && <p className="text-xs text-red-700">{errors.phone.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-password" className="block text-sm font-medium text-slate-700">
              Password (min 8 characters)
            </label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              {...register('password')}
              className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {errors.password && <p className="text-xs text-red-700">{errors.password.message}</p>}
          </div>

          <Button
            type="submit"
            disabled={signupMutation.isPending}
            className="h-11 w-full bg-slate-900 text-sm font-medium text-white hover:bg-slate-800"
          >
            {signupMutation.isPending ? 'Creating account…' : 'Create organization'}
          </Button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-slate-950 underline underline-offset-4 hover:text-slate-700">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  )
}
