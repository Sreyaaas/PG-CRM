import { useEffect } from 'react'
import { Building2 } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthContext'

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 text-slate-950">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-950">
              Select organization
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Signed in as {session.me.full_name}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>

        {memberships.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No organization memberships found for this account.
          </div>
        ) : (
          <ul className="space-y-2">
            {memberships.map((m) => (
              <li key={m.org_id}>
                <button
                  type="button"
                  onClick={() => {
                    selectOrg(m.org_id)
                    navigate(m.role === 'owner' ? '/owner' : '/caretaker', { replace: true })
                  }}
                  className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Building2 className="h-5 w-5 shrink-0 text-slate-400" />
                    <span className="truncate font-medium text-slate-950">
                      {m.organization_name}
                    </span>
                  </div>
                  <span className="ml-3 shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
                    {m.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
