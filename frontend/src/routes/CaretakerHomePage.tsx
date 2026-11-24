import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { useAuth } from '@/features/auth/AuthContext'

export function CaretakerHomePage({ section = 'Desk' }: { section?: string }) {
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
    <div className="space-y-5">
      <div className="border-b border-slate-200 pb-3">
        <h1 className="text-lg font-semibold tracking-tight text-slate-950">{section}</h1>
        <p className="text-sm text-slate-500">
          {membership?.organization_name} · Caretaker workspace
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Assigned buildings</h2>
        {propertiesQuery.isLoading && (
          <p className="mt-2 text-sm text-slate-500">Loading assigned buildings…</p>
        )}
        {propertiesQuery.data && propertiesQuery.data.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">No buildings assigned yet.</p>
        )}
        {propertiesQuery.data && propertiesQuery.data.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {propertiesQuery.data.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <div className="font-medium text-slate-950">{p.name}</div>
                {p.locality && <div className="text-xs text-slate-500">{p.locality}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
