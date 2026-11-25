import { useEffect } from 'react'
import { Building2, ChevronRight } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { EmptyState, ListRow, ROW_LINK } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { AuthLayout } from './AuthLayout'

export function OrgPickerPage() {
  const { session, selectOrg, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!session) return
    if (session.me.memberships.length === 1) {
      const only = session.me.memberships[0]
      selectOrg(only.org_id)
      navigate(only.role === 'owner' ? '/owner' : '/caretaker', { replace: true })
    }
  }, [session, selectOrg, navigate])

  if (!session) {
    return <Navigate to="/login" replace />
  }

  const memberships = session.me.memberships

  return (
    <AuthLayout
      title={['Select', 'organization']}
      description={<>Signed in as {session.me.full_name}</>}
      aside={
        <Button type="button" variant="ghost" size="sm" onClick={logout}>
          Sign out
        </Button>
      }
    >
      {memberships.length === 0 ? (
        <Card>
          <EmptyState>No organization memberships found for this account.</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardList>
            {memberships.map((m) => (
              <li key={m.org_id}>
                <button
                  type="button"
                  onClick={() => {
                    selectOrg(m.org_id)
                    navigate(m.role === 'owner' ? '/owner' : '/caretaker', { replace: true })
                  }}
                  className={`w-full text-left ${ROW_LINK}`}
                >
                  <ListRow
                    leading={
                      <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted">
                        <Building2 className="size-5" aria-hidden="true" />
                      </span>
                    }
                    title={m.organization_name}
                    trailing={
                      <>
                        <Badge className="capitalize">{m.role}</Badge>
                        <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                      </>
                    }
                  />
                </button>
              </li>
            ))}
          </CardList>
        </Card>
      )}
    </AuthLayout>
  )
}
