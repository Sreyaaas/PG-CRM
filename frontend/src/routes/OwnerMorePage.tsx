import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'

export function OwnerMorePage() {
  const { membership } = useAuth()
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">More</h1>
        <p className="mt-1 text-sm text-slate-500">
          {membership?.organization_name} · Owner workspace
        </p>
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        <li>
          <Link
            to="/owner/staff"
            className="flex min-h-11 items-center px-4 py-3 text-sm font-medium text-slate-950"
          >
            Staff
          </Link>
        </li>
      </ul>
    </div>
  )
}
