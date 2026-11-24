import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { useAuth } from '@/features/auth/AuthContext'

export function OwnerDashboardPage({ section = 'Dashboard' }: { section?: string }) {
  const { membership } = useAuth()

  const propertiesQuery = useQuery({
    queryKey: ['properties', membership?.org_id],
    enabled: Boolean(membership?.org_id),
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/properties', {
        params: { header: { 'x-org-id': membership!.org_id } },
      })
      return data ?? []
    },
    retry: false,
  })

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">{section}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {membership?.organization_name} · Owner workspace
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Properties</h2>
        {propertiesQuery.isLoading && (
          <p className="mt-2 text-sm text-slate-500">Loading properties…</p>
        )}
        {propertiesQuery.data && propertiesQuery.data.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">
            No buildings added yet. Property setup arrives in FE-10.
          </p>
        )}
        {propertiesQuery.data && propertiesQuery.data.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {propertiesQuery.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="font-medium text-slate-950">{p.name}</div>
                  {p.locality && <div className="text-xs text-slate-500">{p.locality}</div>}
                </div>
                <span className="text-xs text-slate-500">{p.upi_vpa ?? 'No UPI set'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
