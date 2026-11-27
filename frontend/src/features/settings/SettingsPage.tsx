import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import {
  Building2,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  LogOut,
  MonitorSmartphone,
  Share,
  Users,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { ApiError, apiClient } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { OrgDetailsCard } from './OrgDetailsCard'
import { PalettePicker } from './PalettePicker'
import { Card, CardBody, CardHeader, CardList } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ListRow, Notice, PageHeader, ROW_LINK } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { useAuth } from '@/features/auth/AuthContext'
import { usePropertiesQuery } from '@/features/properties/api'
import { useStaffQuery } from '@/features/staff/useStaff'
import { cn } from '@/lib/utils'
import {
  useAppearance,
  type DensityChoice,
  type RadiusChoice,
  type ThemeChoice,
} from './appearance'
import { useInstallPrompt } from './installPrompt'

const APP_VERSION = '1.0.0'

const passwordSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
})

type PasswordFormValues = z.infer<typeof passwordSchema>

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13.5px] font-medium text-ink">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="grid grid-cols-3 gap-1 rounded-control border border-line bg-surface-2 p-1"
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                'min-h-9 rounded-chip px-2.5 text-[13px] font-semibold transition-colors',
                active
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-muted hover:text-ink',
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SegmentedPair<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13.5px] font-medium text-ink">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="grid grid-cols-2 gap-1 rounded-control border border-line bg-surface-2 p-1"
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                'min-h-9 rounded-chip px-2.5 text-[13px] font-semibold transition-colors',
                active
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-muted hover:text-ink',
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PasswordInput({
  id,
  show,
  onToggle,
  toggleLabel,
  ...props
}: React.ComponentProps<'input'> & {
  id: string
  show: boolean
  onToggle: () => void
  toggleLabel: string
}) {
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} className="pr-11" {...props} />
      <button
        type="button"
        aria-label={toggleLabel}
        onClick={onToggle}
        className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-chip text-muted hover:bg-surface-2 hover:text-ink"
      >
        {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )
}

function OwnerOrgCard({ orgName }: { orgName?: string }) {
  const propertiesQuery = usePropertiesQuery()
  const staffQuery = useStaffQuery()

  return (
    <Card>
      <CardHeader title="Organization" description={orgName} />
      <CardList>
        <li>
          <Link to="/owner/properties" className={ROW_LINK}>
            <ListRow
              leading={<Building2 className="size-5 text-muted" aria-hidden="true" />}
              title="Properties"
              trailing={
                <>
                  <span className="text-[13px] font-semibold text-muted tabular-nums">
                    {propertiesQuery.data?.length ?? '—'}
                  </span>
                  <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                </>
              }
            />
          </Link>
        </li>
        <li>
          <Link to="/owner/staff" className={ROW_LINK}>
            <ListRow
              leading={<Users className="size-5 text-muted" aria-hidden="true" />}
              title="Staff"
              trailing={
                <>
                  <span className="text-[13px] font-semibold text-muted tabular-nums">
                    {staffQuery.data?.length ?? '—'}
                  </span>
                  <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                </>
              }
            />
          </Link>
        </li>
        <li>
          <ListRow
            title="App version"
            trailing={<span className="text-[13px] text-muted tabular-nums">v{APP_VERSION}</span>}
          />
        </li>
      </CardList>
    </Card>
  )
}

export function SettingsPage() {
  const { session, membership, logout, updateMe } = useAuth()
  const { showToast } = useToast()
  const { prefs, update } = useAppearance()
  const { isStandalone, isIos, canInstall, promptInstall } = useInstallPrompt()

  const isOwner = membership?.role === 'owner'

  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [logoutAllOpen, setLogoutAllOpen] = useState(false)
  const [logoutAllError, setLogoutAllError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: '', new_password: '' },
  })

  const changePasswordMutation = useMutation({
    mutationFn: async (values: PasswordFormValues) => {
      await apiClient.POST('/api/v1/auth/change-password', { body: values })
    },
    onSuccess: () => {
      setPasswordError(null)
      reset()
      showToast('Password updated', 'success')
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Unable to update password'
      setPasswordError(message)
    },
  })

  const logoutAllMutation = useMutation({
    mutationFn: async () => {
      await apiClient.POST('/api/v1/auth/logout-all')
    },
    onSuccess: () => {
      setLogoutAllOpen(false)
      setLogoutAllError(null)
      logout()
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Unable to sign out of all devices'
      setLogoutAllError(message)
    },
  })

  const roleLabel = isOwner ? 'Owner' : 'Caretaker'
  const backTo = isOwner ? '/owner/more' : '/caretaker/more'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        back={{ to: backTo, label: 'More' }}
        description="Account, appearance, and app installation."
      />

      {/* Account */}
      <Card>
        <CardHeader title="Account" description="Your profile and security" />
        <CardList>
          <li className="px-4 py-3 sm:px-5">
            <div className="text-[12.5px] text-muted">Full name</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                aria-label="Your full name"
                defaultValue={session?.me.full_name ?? ''}
                id="settings-full-name"
                className="h-10 flex-1 rounded-control border border-line-strong bg-surface px-3 text-[15px] text-ink outline-none focus:border-ink"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const el = document.getElementById('settings-full-name') as HTMLInputElement | null
                  const val = el?.value.trim()
                  if (!val) return
                  try {
                    const { data } = await apiClient.PATCH('/api/v1/me', { body: { full_name: val } })
                    if (data) updateMe(data)
                    showToast('Name updated', 'success')
                  } catch (err) {
                    showToast(err instanceof ApiError ? err.message : 'Unable to update name', 'error')
                  }
                }}
              >
                Save
              </Button>
            </div>
          </li>
          <li className="px-4 py-3 sm:px-5">
            <div className="text-[12.5px] text-muted">Phone</div>
            <div className="text-[15px] font-semibold text-ink tabular-nums">{session?.me.phone ?? '—'}</div>
          </li>
          <li className="px-4 py-3 sm:px-5">
            <div className="text-[12.5px] text-muted">Role</div>
            <div className="text-[15px] font-semibold text-ink">{roleLabel}</div>
          </li>
          <li className="px-4 py-3 sm:px-5">
            <div className="text-[12.5px] text-muted">Organization</div>
            {isOwner && membership ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Organization name"
                  defaultValue={membership.organization_name}
                  id="settings-org-name"
                  className="h-10 flex-1 rounded-control border border-line-strong bg-surface px-3 text-[15px] text-ink outline-none focus:border-ink"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const el = document.getElementById('settings-org-name') as HTMLInputElement | null
                    const val = el?.value.trim()
                    if (!val) return
                    try {
                      await apiClient.PATCH('/api/v1/organization', {
                        params: { header: { 'x-org-id': membership.org_id } },
                        body: { name: val },
                      })
                      const { data } = await apiClient.GET('/api/v1/me')
                      if (data) updateMe(data)
                      showToast('Organization name updated', 'success')
                    } catch (err) {
                      showToast(err instanceof ApiError ? err.message : 'Unable to update organization', 'error')
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            ) : (
              <div className="text-[15px] font-semibold text-ink">{membership?.organization_name ?? '—'}</div>
            )}
          </li>
        </CardList>
        <CardBody className="flex flex-col gap-5 border-t border-line">
          <form
            onSubmit={handleSubmit((values) => {
              setPasswordError(null)
              changePasswordMutation.mutate(values)
            })}
            className="flex flex-col gap-4"
            noValidate
          >
            <h3 className="text-[15px] font-semibold text-ink">Change password</h3>

            {passwordError && <Notice role="alert">{passwordError}</Notice>}

            <Field id="current-password" label="Current password" error={errors.current_password?.message}>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                show={showCurrent}
                onToggle={() => setShowCurrent((s) => !s)}
                toggleLabel={showCurrent ? 'Hide current password' : 'Show current password'}
                aria-invalid={errors.current_password ? true : undefined}
                {...register('current_password')}
              />
            </Field>

            <Field
              id="new-password"
              label="New password"
              hint="At least 8 characters."
              error={errors.new_password?.message}
            >
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                show={showNew}
                onToggle={() => setShowNew((s) => !s)}
                toggleLabel={showNew ? 'Hide new password' : 'Show new password'}
                aria-invalid={errors.new_password ? true : undefined}
                {...register('new_password')}
              />
            </Field>

            <div>
              <Button type="submit" disabled={changePasswordMutation.isPending}>
                {changePasswordMutation.isPending ? 'Updating…' : 'Update password'}
              </Button>
            </div>
          </form>

          <div className="border-t border-line pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[14.5px] font-semibold text-ink">Active sessions</div>
                <p className="text-[13px] text-muted">End your session on every phone and browser.</p>
              </div>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setLogoutAllError(null)
                  setLogoutAllOpen(true)
                }}
              >
                <MonitorSmartphone className="size-4" aria-hidden="true" />
                Sign out of all devices
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader title="Appearance" description="Saved on this device" />
        <CardBody className="flex flex-col gap-4">
          <SegmentedControl<ThemeChoice>
            label="Theme"
            value={prefs.theme}
            options={[
              { value: 'system', label: 'Match system' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(value) => update('theme', value)}
          />
          <PalettePicker value={prefs.palette} onChange={(value) => update('palette', value)} />
          <SegmentedPair<DensityChoice>
            label="Density"
            value={prefs.density}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
            onChange={(value) => update('density', value)}
          />
          <SegmentedPair<RadiusChoice>
            label="Corners"
            value={prefs.radius}
            options={[
              { value: 'soft', label: 'Soft' },
              { value: 'sharp', label: 'Sharp' },
            ]}
            onChange={(value) => update('radius', value)}
          />
        </CardBody>
      </Card>

      {/* Install app */}
      {!isStandalone && (
        <Card data-testid="install-app-section">
          <CardHeader title="Install app" description="Add PG-CRM to your home screen" />
          <CardBody className="flex flex-col gap-3">
            {canInstall ? (
              <>
                <p className="text-[14px] text-muted">
                  Install PG-CRM for quick one-tap access from your home screen.
                </p>
                <div>
                  <Button
                    type="button"
                    variant="brand"
                    onClick={() => {
                      void promptInstall()
                    }}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Install app
                  </Button>
                </div>
              </>
            ) : isIos ? (
              <ol className="flex flex-col gap-2 text-[14px] text-ink">
                <li className="flex items-center gap-2">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] font-bold tabular-nums">
                    1
                  </span>
                  <span>
                    Tap <Share className="mx-0.5 inline size-4 align-text-bottom text-muted" aria-hidden="true" />{' '}
                    <strong>Share</strong> in Safari.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] font-bold tabular-nums">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] font-bold tabular-nums">
                    3
                  </span>
                  <span>
                    Tap <strong>Add</strong> in the top-right corner.
                  </span>
                </li>
              </ol>
            ) : (
              <p className="text-[14px] text-muted">
                Open your browser menu and choose <strong>Install app</strong> or{' '}
                <strong>Add to Home screen</strong>.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Organization (owner only) */}
      {isOwner && <OrgDetailsCard />}
      {isOwner && <OwnerOrgCard orgName={membership?.organization_name} />}

      {/* Log out */}
      <div>
        <Button type="button" variant="secondary" block onClick={logout}>
          <LogOut className="size-4" aria-hidden="true" />
          Log out
        </Button>
      </div>

      {/* Sign out of all devices confirmation */}
      <Sheet
        open={logoutAllOpen}
        onClose={() => {
          if (!logoutAllMutation.isPending) setLogoutAllOpen(false)
        }}
        title="Sign out of all devices?"
        description="You will be signed out on every phone and browser, including this one."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={logoutAllMutation.isPending}
              onClick={() => setLogoutAllOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={logoutAllMutation.isPending}
              onClick={() => logoutAllMutation.mutate()}
            >
              {logoutAllMutation.isPending ? 'Signing out…' : 'Sign out everywhere'}
            </Button>
          </>
        }
      >
        {logoutAllError && (
          <Notice role="alert" className="mt-2">
            {logoutAllError}
          </Notice>
        )}
      </Sheet>
    </div>
  )
}
