import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ApiError, apiClient } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { getSelectedMembership } from '@/features/auth/session'
import { useHealthQuery } from '@/features/health/useHealthQuery'
import { AuthLayout } from './AuthLayout'

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
    <AuthLayout
      title={['Sign in to', 'NivasOS']}
      description="For PG owners and caretakers."
      footer={
        <>
          New PG owner?{' '}
          <Link to="/signup" className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">
            Create organization
          </Link>
          {healthData && (
            <span data-testid="api-status" className="mt-2 block text-[12px] text-subtle">
              API: {healthData.status ?? 'ok'}
            </span>
          )}
        </>
      }
    >
      {formError && (
        <Notice role="alert" className="mb-5">
          {formError}
        </Notice>
      )}

      <form onSubmit={handleSubmit((values) => loginMutation.mutate(values))} className="flex flex-col gap-4" noValidate>
        <Field id="login-phone" label="Mobile number" error={errors.phone?.message}>
          <Input
            id="login-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            enterKeyHint="next"
            maxLength={10}
            placeholder="9876543210"
            aria-invalid={errors.phone ? true : undefined}
            className="tabular-nums"
            {...register('phone')}
          />
        </Field>

        <Field id="login-password" label="Password" error={errors.password?.message}>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            aria-invalid={errors.password ? true : undefined}
            {...register('password')}
          />
        </Field>

        <Button type="submit" size="lg" block disabled={loginMutation.isPending} className="mt-2">
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-6 border-t border-line pt-4">
        <p className="mb-2.5 text-center text-[12px] font-medium text-muted">Quick Access</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loginMutation.isPending}
            onClick={() => loginMutation.mutate({ phone: '9000000001', password: 'devpass123' })}
          >
            Owner
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loginMutation.isPending}
            onClick={() => loginMutation.mutate({ phone: '9000000002', password: 'devpass123' })}
          >
            Caretaker
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}
