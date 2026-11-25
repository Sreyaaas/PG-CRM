import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { CaretakerShell } from '@/components/shells/CaretakerShell'
import { OwnerShell } from '@/components/shells/OwnerShell'
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

  const switchOrg = session.me.memberships.length > 1 ? () => navigate('/select-org') : undefined

  return (
    <OwnerShell
      orgName={membership.organization_name}
      userName={session.me.full_name}
      onLogout={logout}
      onSwitchOrg={switchOrg}
      badges={{ '/owner/approvals': approvalsCount }}
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

  const switchOrg = session.me.memberships.length > 1 ? () => navigate('/select-org') : undefined

  return (
    <CaretakerShell
      orgName={membership.organization_name}
      userName={session.me.full_name}
      onLogout={logout}
      onSwitchOrg={switchOrg}
    >
      <Outlet />
    </CaretakerShell>
  )
}
