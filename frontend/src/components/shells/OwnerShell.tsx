import type { ReactNode } from 'react'
import { Building2, CheckCircle2, IndianRupee, LayoutDashboard, Menu } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { ShellNavItem } from './CaretakerShell'

const OWNER_NAV: ShellNavItem[] = [
  { label: 'Dashboard', to: '/owner', icon: <LayoutDashboard className="h-5 w-5" /> },
  { label: 'Approvals', to: '/owner/approvals', icon: <CheckCircle2 className="h-5 w-5" /> },
  { label: 'Properties', to: '/owner/properties', icon: <Building2 className="h-5 w-5" /> },
  { label: 'Money', to: '/owner/money', icon: <IndianRupee className="h-5 w-5" /> },
  { label: 'More', to: '/owner/more', icon: <Menu className="h-5 w-5" /> },
]

export interface OwnerShellProps {
  orgName?: string
  userName?: string
  headerAction?: ReactNode
  sidebarFooter?: ReactNode
  children: ReactNode
}

export function OwnerShell({
  orgName = 'PG-CRM',
  userName,
  headerAction,
  sidebarFooter,
  children,
}: OwnerShellProps) {
  return (
    <div className="min-h-screen bg-white text-slate-950 lg:flex">
      {/* Desktop sidebar (>= 1024px) */}
      <aside
        aria-label="Owner sidebar"
        className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 lg:border-r lg:border-slate-200 lg:bg-slate-50/50"
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">{orgName}</div>
            {userName && <div className="truncate text-xs text-slate-500">{userName}</div>}
          </div>
          <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
            Owner
          </span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {OWNER_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/owner'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {sidebarFooter && <div className="border-t border-slate-200 p-3">{sidebarFooter}</div>}
      </aside>

      {/* Main area */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="min-w-0 lg:hidden">
            <div className="truncate text-sm font-semibold text-slate-950">{orgName}</div>
            {userName && <div className="truncate text-xs text-slate-500">{userName}</div>}
          </div>
          <div className="hidden lg:block text-sm font-medium text-slate-600">{orgName}</div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 lg:hidden">
              Owner
            </span>
            {headerAction}
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 pb-24 lg:px-6 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav (< 1024px) */}
      <nav
        aria-label="Owner bottom navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white lg:hidden"
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
          {OWNER_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/owner'}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  isActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900',
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
