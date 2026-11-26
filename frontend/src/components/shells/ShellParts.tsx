import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftRight, ChevronRight, LogOut, Moon, Plus, Settings, Sun } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Avatar, BrandMark } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { SearchButton } from '@/features/search/GlobalSearch'
import { resolvedTheme, useAppearance } from '@/features/settings/appearance'
import { cn } from '@/lib/utils'

export interface ShellNavItem {
  label: string
  to: string
  icon: ReactNode
  /** Extra path prefixes that also mark this item active (e.g. More covers Staff). */
  alsoActiveFor?: string[]
}

export interface QuickAction {
  label: string
  hint: string
  to: string
  icon: ReactNode
}

export interface ShellAccount {
  userName?: string
  roleLabel: string
  settingsTo?: string
  onLogout?: () => void
  onSwitchOrg?: () => void
}

export function useIsActive() {
  const { pathname } = useLocation()
  return (item: ShellNavItem, exactRoot: string) => {
    const matches = (to: string) =>
      to === exactRoot ? pathname === to || pathname === `${to}/` : pathname === to || pathname.startsWith(`${to}/`)
    return matches(item.to) || (item.alsoActiveFor ?? []).some(matches)
  }
}

/* ───────── Count badge (marigold) ───────── */

export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      data-testid="nav-badge"
      aria-label={`${count} pending`}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-on-brand tabular-nums',
        className,
      )}
    >
      {count}
    </span>
  )
}

/* ───────── Account menu ───────── */

export function AccountMenu({ account }: { account: ShellAccount }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const name = account.userName ?? 'Signed in'

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-mr-1.5 inline-flex size-11 items-center justify-center rounded-full active:opacity-70"
      >
        <Avatar name={name} size="sm" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="anim-pop absolute right-0 top-[calc(100%+4px)] z-50 w-64 rounded-xl border border-line bg-surface p-1.5 text-ink shadow-lg"
        >
          <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
            <Avatar name={name} size="md" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold">{name}</p>
              <p className="truncate text-[12.5px] text-muted">{account.roleLabel}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          {account.settingsTo && (
            <Link
              to={account.settingsTo}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] hover:bg-surface-2 active:bg-surface-2"
            >
              <Settings className="size-4 text-muted" aria-hidden="true" />
              Settings
            </Link>
          )}
          {account.onSwitchOrg && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                account.onSwitchOrg?.()
              }}
              className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] hover:bg-surface-2 active:bg-surface-2"
            >
              <ArrowLeftRight className="size-4 text-muted" aria-hidden="true" />
              Switch organization
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              account.onLogout?.()
            }}
            className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] text-danger-ink hover:bg-danger-soft active:bg-danger-soft"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

/* ───────── Top bar ───────── */

export function TopBar({
  orgName,
  homeTo,
  account,
  className,
}: {
  orgName: string
  homeTo: string
  account: ShellAccount
  className?: string
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-line bg-page pt-[env(safe-area-inset-top)] print:hidden',
        className,
      )}
    >
      <div className="safe-x flex h-14 items-center gap-2.5">
        <Link to={homeTo} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 active:opacity-70">
          <BrandMark size="sm" />
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{orgName}</span>
        </Link>
        <SearchButton base={homeTo === '/owner' ? '/owner' : '/caretaker'} />
        <ThemeToggle />
        <AccountMenu account={account} />
      </div>
    </header>
  )
}

/** One tap between light and dark. Follows the phone's setting until the first tap. */
export function ThemeToggle() {
  const { prefs, update } = useAppearance()
  const dark = resolvedTheme(prefs.theme) === 'dark'
  return (
    <button
      type="button"
      onClick={() => update('theme', dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-2 [&_svg]:size-5"
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  )
}

/* ───────── Bottom nav ───────── */

function TabLink({ item, active, badge = 0 }: { item: ShellNavItem; active: boolean; badge?: number }) {
  return (
    <NavLink
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-full min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors active:opacity-70',
        active ? 'text-ink' : 'text-muted',
      )}
    >
      {active && (
        <span aria-hidden="true" className="absolute inset-x-[22%] top-0 h-[3px] rounded-b-full bg-brand" />
      )}
      <span className={cn('relative [&_svg]:size-[22px]', active ? '[&_svg]:stroke-[2.2]' : '[&_svg]:stroke-[1.8]')}>
        {item.icon}
        {badge > 0 && <CountBadge count={badge} className="absolute -right-3 -top-1.5" />}
      </span>
      <span className="max-w-full truncate px-0.5">{item.label}</span>
    </NavLink>
  )
}

export function BottomNav({
  label,
  left,
  right,
  exactRoot,
  onQuickActions,
  badges = {},
  className,
}: {
  label: string
  left: [ShellNavItem, ShellNavItem]
  right: [ShellNavItem, ShellNavItem]
  exactRoot: string
  onQuickActions: () => void
  badges?: Record<string, number>
  className?: string
}) {
  const isActive = useIsActive()
  return (
    <nav
      aria-label={label}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] print:hidden',
        className,
      )}
    >
      <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-stretch">
        {left.map((item) => (
          <TabLink key={item.to} item={item} active={isActive(item, exactRoot)} badge={badges[item.to]} />
        ))}
        <div className="flex items-start justify-center">
          <button
            type="button"
            aria-label="Quick actions"
            aria-haspopup="dialog"
            onClick={onQuickActions}
            className="-mt-5 inline-flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-[0_6px_16px_-6px_rgb(28_25_23/0.45)] ring-4 ring-page transition-transform active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        {right.map((item) => (
          <TabLink key={item.to} item={item} active={isActive(item, exactRoot)} badge={badges[item.to]} />
        ))}
      </div>
    </nav>
  )
}

/* ───────── Quick actions ───────── */

export function QuickActionList({ actions, onPick }: { actions: QuickAction[]; onPick?: () => void }) {
  return (
    <ul className="-mx-2 flex flex-col" aria-label="Quick actions list">
      {actions.map((a) => (
        <li key={a.label}>
          <Link
            to={a.to}
            onClick={onPick}
            className="flex min-h-15 items-center gap-3.5 rounded-xl px-2 py-2.5 hover:bg-surface-2 active:bg-surface-2"
          >
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink [&_svg]:size-5">
              {a.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink">{a.label}</span>
              <span className="block text-[13px] text-muted">{a.hint}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function QuickActionsSheet({
  open,
  onClose,
  actions,
}: {
  open: boolean
  onClose: () => void
  actions: QuickAction[]
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Quick actions">
      <QuickActionList actions={actions} onPick={onClose} />
    </Sheet>
  )
}
