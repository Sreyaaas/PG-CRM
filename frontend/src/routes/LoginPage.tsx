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
import { getSelectedMembership } from '@/features/auth/session'
import { useHealthQuery } from '@/features/health/useHealthQuery'

const loginSchema = z.object({
  phone: z
    .string()
    .regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number starting with 6–9'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const { session, membership, loginWithToken } = useAuth()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const { data: healthData } = useHealthQuery()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: '', password: '' },
  })

  const loginMutation = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const { data } = await apiClient.POST('/api/v1/auth/login', {
        body: values,
      })
      if (!data) {
        throw new Error('Empty login response')
      }
      return data
    },
    onSuccess: (data) => {
      setFormError(null)
      const next = loginWithToken(data)
      const selected = getSelectedMembership(next)
      if (!selected && next.me.memberships.length > 1) {
        navigate('/select-org', { replace: true })
        return
      }
      if (selected?.role === 'owner') {
        navigate('/owner', { replace: true })
      } else if (selected?.role === 'caretaker') {
        navigate('/caretaker', { replace: true })
      } else {
        navigate('/select-org', { replace: true })
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.'
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
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">Sign in to PG-CRM</h1>
          <p className="mt-1 text-sm text-slate-500">Staff access for PG owners and caretakers.</p>
        </div>

        {formError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit((values) => loginMutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-phone" className="block text-sm font-medium text-slate-700">
              Mobile number
            </label>
            <input
              id="login-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder="9876543210"
              {...register('phone')}
              className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base tabular-nums text-slate-950 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
            {errors.phone && <p className="text-xs text-red-700">{errors.phone.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              {...register('password')}
              className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
            {errors.password && <p className="text-xs text-red-700">{errors.password.message}</p>}
          </div>

          <Button
            type="submit"
            disabled={loginMutation.isPending}
            className="h-11 w-full bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          New PG owner?{' '}
          <Link to="/signup" className="font-medium text-indigo-600 hover:text-indigo-700">
            Create organization
          </Link>
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-400">
        {healthData && <span data-testid="api-status">API: {healthData.status ?? 'ok'}</span>}
      </div>
    </main>
  )
}
