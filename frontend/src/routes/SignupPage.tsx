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
import { AuthLayout } from './AuthLayout'

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
    <AuthLayout
      title={['Create', 'NivasOS account']}
      description="Set up your organization as a PG owner."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      {formError && (
        <Notice role="alert" className="mb-5">
          {formError}
        </Notice>
      )}

      <form onSubmit={handleSubmit((values) => signupMutation.mutate(values))} className="flex flex-col gap-4" noValidate>
        <Field id="signup-name" label="Full name" error={errors.full_name?.message}>
          <Input
            id="signup-name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder="Meera Nair"
            aria-invalid={errors.full_name ? true : undefined}
            {...register('full_name')}
          />
        </Field>

        <Field id="signup-org" label="Organization / PG group name" error={errors.organization_name?.message}>
          <Input
            id="signup-org"
            type="text"
            autoComplete="organization"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder="Sunrise Living PGs"
            aria-invalid={errors.organization_name ? true : undefined}
            {...register('organization_name')}
          />
        </Field>

        <Field id="signup-phone" label="Mobile number" error={errors.phone?.message}>
          <Input
            id="signup-phone"
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

        <Field id="signup-password" label="Password (min 8 characters)" error={errors.password?.message}>
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="go"
            aria-invalid={errors.password ? true : undefined}
            {...register('password')}
          />
        </Field>

        <Button type="submit" size="lg" block disabled={signupMutation.isPending} className="mt-2">
          {signupMutation.isPending ? 'Creating account…' : 'Create organization'}
        </Button>
      </form>
    </AuthLayout>
  )
}
