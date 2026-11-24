import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { CaretakerShell } from '@/components/shells/CaretakerShell'
import { OwnerShell } from '@/components/shells/OwnerShell'
import { Button } from '@/components/ui/button'
import { usePendingApprovalsCount } from '@/features/approvals/useDiscountRequests'
import { useAuth } from '@/features/auth/AuthContext'

export function RoleRedirect() {
  const { session, membership } = useAuth()

  if (!session) {
    return <Navigate to="/login" replace />
  }
  if (!membership) {
    return <Navigate to="/select-org" replace />
  }
  return <Navigate to={membership.role === 'owner' ? '/owner' : '/caretaker'} replace />
}

export function OwnerLayoutRoute() {
  const { session, membership, logout } = useAuth()
  const navigate = useNavigate()
  const approvalsCount = usePendingApprovalsCount()

  if (!session) {
    return <Navigate to="/login" replace />
  }
  if (!membership) {
    return <Navigate to="/select-org" replace />
  }
  if (membership.role !== 'owner') {
    return <Navigate to="/caretaker" replace />
  }

  const actions = (
    <div className="flex items-center gap-2">
      {session.me.memberships.length > 1 && (
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/select-org')}>
          Switch org
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" onClick={logout}>
        Log out
      </Button>
    </div>
  )

  return (
    <OwnerShell
      orgName={membership.organization_name}
      userName={session.me.full_name}
      headerAction={actions}
      badges={{ '/owner/approvals': approvalsCount }}
      sidebarFooter={
        <div className="flex flex-col gap-2">
          {session.me.memberships.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate('/select-org')}
            >
              Switch organization
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={logout}>
            Log out
          </Button>
        </div>
      }
    >
      <Outlet />
    </OwnerShell>
  )
}

export function CaretakerLayoutRoute() {
  const { session, membership, logout } = useAuth()
  const navigate = useNavigate()

  if (!session) {
    return <Navigate to="/login" replace />
  }
  if (!membership) {
    return <Navigate to="/select-org" replace />
  }
  if (membership.role !== 'caretaker') {
    return <Navigate to="/owner" replace />
  }

  const actions = (
    <div className="flex items-center gap-2">
      {session.me.memberships.length > 1 && (
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/select-org')}>
          Switch org
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" onClick={logout}>
        Log out
      </Button>
    </div>
  )

  return (
    <CaretakerShell
      orgName={membership.organization_name}
      userName={session.me.full_name}
      headerAction={actions}
    >
      <Outlet />
    </CaretakerShell>
  )
}
