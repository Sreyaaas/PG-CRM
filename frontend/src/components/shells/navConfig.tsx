import { BedDouble, Building2, CheckCircle2, Home, IndianRupee, Menu, Receipt, Sun, UserCheck, UserPlus, Users } from 'lucide-react'
import type { QuickAction, ShellNavItem } from './ShellParts'

/* Caretaker: Home · Check-ins · [+] · Payments · More */
export const CARETAKER_NAV = {
  home: { label: 'Home', to: '/caretaker', icon: <Home /> },
  beds: { label: 'Bed board', to: '/caretaker/beds', icon: <BedDouble /> },
  checkIns: { label: 'Check-ins', to: '/caretaker/check-ins', icon: <UserCheck /> },
  payments: { label: 'Payments', to: '/caretaker/payments', icon: <IndianRupee /> },
  expenses: { label: 'Expenses', to: '/caretaker/expenses', icon: <Receipt /> },
  more: {
    label: 'More',
    to: '/caretaker/more',
    icon: <Menu />,
    alsoActiveFor: ['/caretaker/beds', '/caretaker/residents', '/caretaker/expenses', '/caretaker/settings', '/caretaker/cash'],
  },
} satisfies Record<string, ShellNavItem>

export const CARETAKER_QUICK_ACTIONS: QuickAction[] = [
  { label: 'Log payment', hint: 'Cash or UPI from a resident', to: '/caretaker/payments', icon: <IndianRupee /> },
  { label: 'Log expense', hint: 'With a bill photo, or flag a no-bill spend', to: '/caretaker/expenses', icon: <Receipt /> },
  { label: 'Approve check-in', hint: 'Residents waiting at the desk', to: '/caretaker/check-ins', icon: <UserCheck /> },
]

/* Owner: Today · Approvals · [+] · Properties · More (the sidebar adds Bed board, Money and Staff) */
export const OWNER_NAV = {
  today: { label: 'Today', to: '/owner', icon: <Sun /> },
  beds: { label: 'Bed board', to: '/owner/beds', icon: <BedDouble /> },
  approvals: { label: 'Approvals', to: '/owner/approvals', icon: <CheckCircle2 /> },
  properties: { label: 'Properties', to: '/owner/properties', icon: <Building2 /> },
  money: { label: 'Money', to: '/owner/money', icon: <IndianRupee /> },
  staff: { label: 'Staff', to: '/owner/staff', icon: <Users /> },
  more: {
    label: 'More',
    to: '/owner/more',
    icon: <Menu />,
    alsoActiveFor: ['/owner/beds', '/owner/residents', '/owner/staff', '/owner/money', '/owner/settings'],
  },
} satisfies Record<string, ShellNavItem>

export const OWNER_QUICK_ACTIONS: QuickAction[] = [
  { label: 'Add property', hint: 'A new building with its billing rules', to: '/owner/properties/new', icon: <Building2 /> },
  { label: 'Add caretaker', hint: 'Give a staff member access to buildings', to: '/owner/staff', icon: <UserPlus /> },
  { label: 'Approvals', hint: 'Discount requests waiting for you', to: '/owner/approvals', icon: <CheckCircle2 /> },
]
