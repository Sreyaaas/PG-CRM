import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { BrandMark } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import { CARETAKER_NAV as NAV, CARETAKER_QUICK_ACTIONS } from './navConfig'
import { useIsDesktop } from './useIsDesktop'
import {
  BottomNav,
  CountBadge,
  QuickActionsSheet,
  TopBar,
  useIsActive,
  type ShellAccount,
} from './ShellParts'

export type { ShellNavItem } from './ShellParts'

const SIDEBAR_ITEMS = [
  NAV.home,
  NAV.complaints,
  NAV.checkIns,
  NAV.payments,
  NAV.expenses,
  NAV.beds,
  NAV.cash,
  NAV.more,
]

export interface CaretakerShellProps {
  orgName?: string
  userName?: string
  onLogout?: () => void
  onSwitchOrg?: () => void
  /** Badge counts keyed by nav `to` path; zero or absent hides the badge. */
  badges?: Record<string, number>
  children: ReactNode
}

/**
 * Phones: top bar + bottom nav with the raised + button (the desk caretaker's one-thumb layout).
 * Tablets and laptops (>= 1024px): a left sidebar and a wide content area, so a PC at the reception desk
 * doesn't show a narrow phone column.
 */
export function CaretakerShell({
  orgName = 'PG-CRM',
  userName,
  onLogout,
  onSwitchOrg,
  badges = {},
  children,
}: CaretakerShellProps) {
  const [quickOpen, setQuickOpen] = useState(false)
  const isActive = useIsActive()
  const isDesktop = useIsDesktop()
  const account: ShellAccount = {
    userName,
    roleLabel: 'Caretaker',
    settingsTo: '/caretaker/settings',
    onLogout,
    onSwitchOrg,
  }

  return (
    <div className="min-h-dvh bg-page text-ink">
      {isDesktop && (
        <aside
          aria-label="Caretaker sidebar"
          className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface pl-[env(safe-area-inset-left)] lg:flex print:!hidden"
        >
          <div className="flex h-14 items-center gap-2.5 px-4 pt-[env(safe-area-inset-top)]">
            <BrandMark size="sm" />
            <span className="text-[15px] font-bold tracking-[-0.02em]">
              PG-CRM
            </span>
          </div>
          <div className="px-3 pb-2 pt-1">
            <button
              type="button"
              onClick={() => setQuickOpen(true)}
              className="flex h-10 w-full items-center gap-2 rounded-control bg-brand px-3 text-[14px] font-semibold text-on-brand shadow-xs hover:bg-[color-mix(in_oklab,var(--brand)_88%,black)] active:scale-[0.98]"
            >
              <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
              Quick actions
            </button>
          </div>
          <nav
            aria-label="Caretaker sections"
            className="flex flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 py-2"
          >
            {SIDEBAR_ITEMS.map((item) => {
              const active = isActive(item, '/caretaker')
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 items-center gap-3 rounded-control px-3 text-[14px] font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0',
                    active
                      ? 'bg-brand-soft text-ink'
                      : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <span className={active ? 'text-brand-ink' : undefined}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  <CountBadge count={badges[item.to] ?? 0} />
                </NavLink>
              )
            })}
          </nav>
        </aside>
      )}

      <div className="flex min-h-dvh flex-col lg:pl-60 print:pl-0">
        <TopBar orgName={orgName} homeTo="/caretaker" account={account} />

        <main className="safe-x mx-auto w-full max-w-lg flex-1 pb-[calc(var(--bottomnav-h)+32px+env(safe-area-inset-bottom))] pt-5 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pb-12 lg:pt-8">
          {children}
        </main>
      </div>

      <BottomNav
        label="Caretaker navigation"
        left={[NAV.home, NAV.checkIns]}
        right={[NAV.payments, NAV.more]}
        exactRoot="/caretaker"
        badges={badges}
        onQuickActions={() => setQuickOpen(true)}
        className="lg:hidden"
      />
      <QuickActionsSheet
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        actions={CARETAKER_QUICK_ACTIONS}
      />
    </div>
  )
}
