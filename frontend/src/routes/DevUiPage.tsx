import { useState } from 'react'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Utr } from '@/components/Utr'
import { CaretakerShell } from '@/components/shells/CaretakerShell'
import { OwnerShell } from '@/components/shells/OwnerShell'
import { Button } from '@/components/ui/button'

export function DevUiPage() {
  const [shell, setShell] = useState<'owner' | 'caretaker'>('owner')

  const content = (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-950">UI Design Base</h1>
          <p className="text-sm text-slate-500">
            Formatters, tabular-nums components, status badges, and role shells.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={shell === 'owner' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShell('owner')}
          >
            Owner shell
          </Button>
          <Button
            type="button"
            variant={shell === 'caretaker' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShell('caretaker')}
          >
            Caretaker shell
          </Button>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Money, UTR & Date (tabular-nums)</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">Monthly rent (1050000p)</dt>
            <dd className="font-medium text-slate-950">
              <Money paise={1050000} />
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">Deposit (10000000p)</dt>
            <dd className="font-medium text-slate-950">
              <Money paise={10000000} />
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">Fractional (12345p)</dt>
            <dd className="font-medium text-slate-950">
              <Money paise={12345} />
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">UTR</dt>
            <dd className="text-slate-950">
              <Utr value="412345678901" />
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">Date (IST)</dt>
            <dd className="text-slate-950">
              <DateText value="2026-11-24T12:00:00Z" />
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Status Badges</h2>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Beds</div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge kind="bed" value="vacant" />
            <StatusBadge kind="bed" value="reserved" />
            <StatusBadge kind="bed" value="occupied" />
            <StatusBadge kind="bed" value="on_notice" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Payments</div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge kind="payment" value="recorded" />
            <StatusBadge kind="payment" value="provisional" />
            <StatusBadge kind="payment" value="verified" />
            <StatusBadge kind="payment" value="flagged" />
            <StatusBadge kind="payment" value="void" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Expenses</div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge kind="expense" value="flagged & not reviewed" />
          </div>
        </div>
      </section>
    </div>
  )

  if (shell === 'caretaker') {
    return (
      <CaretakerShell
        orgName="Meera PGs (Preview)"
        userName="Raju (Caretaker)"
        primaryAction={
          <Button type="button" className="w-full h-12 text-base font-medium bg-slate-900 hover:bg-slate-800 text-white">
            Log Payment
          </Button>
        }
      >
        {content}
      </CaretakerShell>
    )
  }

  return (
    <OwnerShell orgName="Meera PGs (Preview)" userName="Meera (Owner)">
      {content}
    </OwnerShell>
  )
}
