import type { ReactNode } from 'react'
import { Home, IndianRupee, Menu, Receipt, UserCheck } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

export interface ShellNavItem {
  label: string
  to: string
  icon: ReactNode
}

const CARETAKER_NAV: ShellNavItem[] = [
  { label: 'Home', to: '/caretaker', icon: <Home className="h-5 w-5" /> },
  { label: 'Check-ins', to: '/caretaker/check-ins', icon: <UserCheck className="h-5 w-5" /> },
  { label: 'Payments', to: '/caretaker/payments', icon: <IndianRupee className="h-5 w-5" /> },
  { label: 'Expenses', to: '/caretaker/expenses', icon: <Receipt className="h-5 w-5" /> },
  { label: 'More', to: '/caretaker/more', icon: <Menu className="h-5 w-5" /> },
]

export interface CaretakerShellProps {
  orgName?: string
  userName?: string
  headerAction?: ReactNode
  primaryAction?: ReactNode
  children: ReactNode
}

export function CaretakerShell({
  orgName = 'PG-CRM',
  userName,
  headerAction,
  primaryAction,
  children,
}: CaretakerShellProps) {
  return (
    <div className="min-h-screen bg-white text-slate-950 flex flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{orgName}</div>
          {userName && <div className="truncate text-xs text-slate-500">{userName}</div>}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            Caretaker
          </span>
          {headerAction}
        </div>
      </header>

      <main className={cn('mx-auto w-full max-w-lg flex-1 px-4 py-4', primaryAction ? 'pb-40' : 'pb-24')}>
        {children}
      </main>

      {primaryAction && (
        <div className="fixed inset-x-0 bottom-16 z-20 mx-auto max-w-lg px-4 pb-3 pointer-events-none">
          <div className="pointer-events-auto">{primaryAction}</div>
        </div>
      )}

      <nav
        aria-label="Caretaker navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white"
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
          {CARETAKER_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/caretaker'}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'text-slate-950 before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-slate-950'
                    : 'text-slate-500 hover:text-slate-900',
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
