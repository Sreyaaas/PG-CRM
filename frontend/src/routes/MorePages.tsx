import type { ReactNode } from 'react'
import { ChevronRight, FileCheck2, HandCoins, MessageSquareWarning, Receipt, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CARETAKER_NAV, OWNER_NAV } from '@/components/shells/navConfig'
import { Card, CardList } from '@/components/ui/card'
import { ListRow, PageHeader, ROW_LINK } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'

interface MoreLink {
  label: string
  to: string
  icon: ReactNode
}

function MoreList({ links }: { links: MoreLink[] }) {
  return (
    <Card className="overflow-hidden">
      <CardList>
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className={ROW_LINK}>
              <ListRow
                leading={<span className="text-muted [&_svg]:size-5">{l.icon}</span>}
                title={l.label}
                trailing={<ChevronRight className="size-4 text-subtle" aria-hidden="true" />}
              />
            </Link>
          </li>
        ))}
      </CardList>
    </Card>
  )
}

export function OwnerMorePage() {
  const { membership } = useAuth()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="More" description={<>{membership?.organization_name} · Owner workspace</>} />
      <MoreList
        links={[
          OWNER_NAV.beds,
          OWNER_NAV.staff,
          OWNER_NAV.money,
          { label: 'Complaints', to: '/owner/complaints', icon: <MessageSquareWarning /> },
          { label: 'Expenses', to: '/owner/expenses', icon: <Receipt /> },
          { label: 'Reconcile statements', to: '/owner/money/reconcile', icon: <FileCheck2 /> },
          { label: 'Cash in hand', to: '/owner/money/cash', icon: <HandCoins /> },
          { label: 'Settings', to: '/owner/settings', icon: <Settings /> },
        ]}
      />
    </div>
  )
}

export function CaretakerMorePage() {
  const { membership } = useAuth()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="More" description={<>{membership?.organization_name} · Caretaker</>} />
      <MoreList
        links={[
          CARETAKER_NAV.beds,
          CARETAKER_NAV.expenses,
          { label: 'Complaints', to: '/caretaker/complaints', icon: <MessageSquareWarning /> },
          { label: 'My cash', to: '/caretaker/cash', icon: <HandCoins /> },
          { label: 'Settings', to: '/caretaker/settings', icon: <Settings /> },
        ]}
      />
    </div>
  )
}
