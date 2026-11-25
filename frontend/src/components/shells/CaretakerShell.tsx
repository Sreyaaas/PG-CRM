import { useState, type ReactNode } from 'react'
import { CARETAKER_NAV as NAV, CARETAKER_QUICK_ACTIONS } from './navConfig'
import { BottomNav, QuickActionsSheet, TopBar, type ShellAccount } from './ShellParts'

export type { ShellNavItem } from './ShellParts'

export interface CaretakerShellProps {
  orgName?: string
  userName?: string
  onLogout?: () => void
  onSwitchOrg?: () => void
  /** Badge counts keyed by nav `to` path; zero or absent hides the badge. */
  badges?: Record<string, number>
  children: ReactNode
}

export function CaretakerShell({
  orgName = 'PG-CRM',
  userName,
  onLogout,
  onSwitchOrg,
  badges = {},
  children,
}: CaretakerShellProps) {
  const [quickOpen, setQuickOpen] = useState(false)
  const account: ShellAccount = { userName, roleLabel: 'Caretaker', onLogout, onSwitchOrg }

  return (
    <div className="flex min-h-dvh flex-col bg-page text-ink">
      <TopBar orgName={orgName} homeTo="/caretaker" account={account} />

      <main className="safe-x mx-auto w-full max-w-lg flex-1 pb-[calc(var(--bottomnav-h)+32px+env(safe-area-inset-bottom))] pt-5">
        {children}
      </main>

      <BottomNav
        label="Caretaker navigation"
        left={[NAV.home, NAV.checkIns]}
        right={[NAV.payments, NAV.more]}
        exactRoot="/caretaker"
        badges={badges}
        onQuickActions={() => setQuickOpen(true)}
      />
      <QuickActionsSheet open={quickOpen} onClose={() => setQuickOpen(false)} actions={CARETAKER_QUICK_ACTIONS} />
    </div>
  )
}
