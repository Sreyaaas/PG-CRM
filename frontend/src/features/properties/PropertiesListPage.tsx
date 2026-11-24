import { Link } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { usePropertiesQuery } from './api'
import { ActiveBadge } from './ActiveBadge'

export function PropertiesListPage() {
  const query = usePropertiesQuery()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">Properties</h1>
        <Button
          asChild
          className="h-11 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Link to="/owner/properties/new">Add property</Link>
        </Button>
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Loading properties…</p>}
      {query.isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {query.error instanceof ApiError ? query.error.message : 'Unable to load properties.'}
        </div>
      )}
      {query.data && query.data.length === 0 && (
        <p className="text-sm text-slate-500">No properties yet. Add your first building.</p>
      )}
      {query.data && query.data.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {query.data.map((p) => (
            <li key={p.id}>
              <Link
                to={`/owner/properties/${p.id}`}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-950">{p.name}</div>
                  {p.locality && <div className="truncate text-xs text-slate-500">{p.locality}</div>}
                </div>
                <ActiveBadge active={p.is_active} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
