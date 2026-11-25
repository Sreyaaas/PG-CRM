import { useEffect, useState, type ReactNode } from 'react'
import { IndianRupee, Plus, Wallet } from 'lucide-react'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { Utr } from '@/components/Utr'
import { CaretakerShell } from '@/components/shells/CaretakerShell'
import { OwnerShell } from '@/components/shells/OwnerShell'
import { CARETAKER_QUICK_ACTIONS, OWNER_QUICK_ACTIONS } from '@/components/shells/navConfig'
import { QuickActionList } from '@/components/shells/ShellParts'
import { Badge, Chip, TONES } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardList } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, MoneyInput, Select, Textarea } from '@/components/ui/input'
import {
  Avatar,
  BrandMark,
  EmptyState,
  ListRow,
  Notice,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatTile,
} from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'

const COLOR_TOKENS: { group: string; tokens: string[] }[] = [
  { group: 'Surfaces', tokens: ['page', 'surface', 'surface-2', 'surface-3', 'line', 'line-strong'] },
  { group: 'Text', tokens: ['ink', 'on-ink', 'muted', 'subtle'] },
  { group: 'Brand', tokens: ['brand', 'on-brand', 'brand-soft', 'brand-ink'] },
  {
    group: 'Status',
    tokens: [
      'danger',
      'danger-soft',
      'danger-ink',
      'warning',
      'warning-soft',
      'warning-ink',
      'success',
      'success-soft',
      'success-ink',
      'info',
      'info-soft',
      'info-ink',
    ],
  },
]

const TYPE_SCALE = [
  { name: 'Display', cls: 'text-[32px] font-bold leading-[1.08] tracking-[-0.03em]', spec: '32 / bold / -0.03em' },
  { name: 'Heading 1', cls: 'text-[24px] font-bold leading-tight tracking-[-0.02em]', spec: '24 / bold / -0.02em' },
  { name: 'Heading 2', cls: 'text-[17px] font-semibold tracking-[-0.015em]', spec: '17 / semibold' },
  { name: 'Card title', cls: 'text-[15px] font-semibold', spec: '15 / semibold' },
  { name: 'Body', cls: 'text-[15px]', spec: '15 / regular' },
  { name: 'Small', cls: 'text-[13px] text-muted', spec: '13 / muted' },
  { name: 'Caption', cls: 'text-[12px] text-muted', spec: '12 / muted' },
]

const RADII = [
  { name: 'radius-card', cls: 'rounded-card', value: '14px' },
  { name: 'radius-control', cls: 'rounded-control', value: '10px' },
  { name: 'radius-chip', cls: 'rounded-chip', value: '8px' },
]

const SHADOWS = [
  { name: 'shadow-xs', cls: 'shadow-xs' },
  { name: 'shadow-sm', cls: 'shadow-sm' },
  { name: 'shadow-lg', cls: 'shadow-lg' },
]

type Theme = 'light' | 'dark'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="size-9 shrink-0 rounded-control border border-line"
        style={{ background: `var(--${token})` }}
      />
      <code className="truncate text-[12.5px] text-ink">--{token}</code>
    </div>
  )
}

export function DevUiPage() {
  const [shell, setShell] = useState<'owner' | 'caretaker'>('owner')
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  const [sheetOpen, setSheetOpen] = useState(false)
  const [chip, setChip] = useState('All')
  const { showToast } = useToast()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const content = (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Marigold design system"
        title="UI style guide"
        description="Tokens, components and both role shells. Every amount, date and UTR uses tabular-nums."
        actions={
          <>
            <div role="group" aria-label="Theme" className="inline-flex gap-1">
              <Chip pressed={theme === 'light'} onClick={() => setTheme('light')}>
                Light
              </Chip>
              <Chip pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
                Dark
              </Chip>
            </div>
            <div role="group" aria-label="Shell" className="inline-flex gap-1">
              <Chip pressed={shell === 'owner'} onClick={() => setShell('owner')}>
                Owner shell
              </Chip>
              <Chip pressed={shell === 'caretaker'} onClick={() => setShell('caretaker')}>
                Caretaker shell
              </Chip>
            </div>
          </>
        }
      />

      <Section id="ui-colours" title="Colours">
        <Card>
          <CardBody className="flex flex-col gap-5">
            {COLOR_TOKENS.map((g) => (
              <div key={g.group} className="flex flex-col gap-2.5">
                <h3 className="text-[13px] font-medium text-muted">{g.group}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {g.tokens.map((t) => (
                    <Swatch key={t} token={t} />
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </Section>

      <Section id="ui-type" title="Type scale">
        <Card className="overflow-hidden">
          <CardList>
            {TYPE_SCALE.map((t) => (
              <li key={t.name} className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
                <span className={`min-w-0 truncate ${t.cls}`}>{t.name}</span>
                <code className="shrink-0 text-[12px] text-muted">{t.spec}</code>
              </li>
            ))}
          </CardList>
        </Card>
      </Section>

      <Section id="ui-radii" title="Radii and shadows">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {RADII.map((r) => (
            <div key={r.name} className={`flex h-20 flex-col justify-end border border-line-strong bg-surface p-3 ${r.cls}`}>
              <code className="text-[12px] text-ink">{r.name}</code>
              <span className="text-[12px] text-muted tabular-nums">{r.value}</span>
            </div>
          ))}
          {SHADOWS.map((s) => (
            <div key={s.name} className={`flex h-20 items-end rounded-card bg-surface p-3 ${s.cls}`}>
              <code className="text-[12px] text-ink">{s.name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section id="ui-buttons" title="Buttons">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary</Button>
              <Button variant="brand">
                <Plus aria-hidden="true" />
                Brand
              </Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary">
                Small
              </Button>
              <Button size="md" variant="secondary">
                Medium 44px
              </Button>
              <Button size="lg" variant="secondary">
                Large
              </Button>
              <Button size="icon" variant="secondary" aria-label="Icon button">
                <IndianRupee aria-hidden="true" />
              </Button>
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section id="ui-forms" title="Form fields">
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field id="dev-name" label="Full name" hint="As on their ID">
              <Input id="dev-name" placeholder="Meera Nair" autoComplete="off" />
            </Field>
            <Field id="dev-phone" label="Mobile number" error="Enter a valid 10-digit Indian mobile number">
              <Input id="dev-phone" type="tel" inputMode="numeric" defaultValue="12345" aria-invalid className="tabular-nums" />
            </Field>
            <Field id="dev-rent" label="Monthly rent">
              <MoneyInput id="dev-rent" defaultValue="6000" />
            </Field>
            <Field id="dev-select" label="Building">
              <Select id="dev-select" defaultValue="a">
                <option value="a">Sunrise Block A</option>
                <option value="b">Lakeview Block B</option>
              </Select>
            </Field>
            <Field id="dev-notes" label="Notes" className="sm:col-span-2">
              <Textarea id="dev-notes" rows={2} />
            </Field>
            <Checkbox label="AC room" defaultChecked />
          </CardBody>
        </Card>
      </Section>

      <Section id="ui-badges" title="Badges and chips">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <Badge key={t} tone={t}>
                  Tone {t}
                </Badge>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-muted">Beds</h3>
              <div className="flex flex-wrap gap-2">
                <StatusBadge kind="bed" value="vacant" />
                <StatusBadge kind="bed" value="reserved" />
                <StatusBadge kind="bed" value="occupied" />
                <StatusBadge kind="bed" value="on_notice" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-muted">Payments</h3>
              <div className="flex flex-wrap gap-2">
                <StatusBadge kind="payment" value="recorded" />
                <StatusBadge kind="payment" value="provisional" />
                <StatusBadge kind="payment" value="verified" />
                <StatusBadge kind="payment" value="flagged" />
                <StatusBadge kind="payment" value="void" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-muted">Expenses</h3>
              <div className="flex flex-wrap gap-2">
                <StatusBadge kind="expense" value="flagged & not reviewed" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter chips">
              {['All', 'Due', 'Paid'].map((c) => (
                <Chip key={c} pressed={chip === c} onClick={() => setChip(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section id="ui-data" title="Stat tiles and numbers">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile label="Cash in hand" icon={<Wallet />} value={<Money paise={1250000} />} highlight foot="Today" />
          <StatTile label="Rent received" value={<Money paise={10000000} />} />
          <StatTile label="Beds" value={42} foot="6 free" />
          <StatTile label="Fractional" value={<Money paise={12345} />} />
        </div>
        <Card className="overflow-hidden">
          <dl className="divide-y divide-line">
            <div className="flex items-center justify-between px-4 py-3 text-[14px] sm:px-5">
              <dt className="text-muted">Monthly rent (1050000p)</dt>
              <dd className="font-medium">
                <Money paise={1050000} />
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-[14px] sm:px-5">
              <dt className="text-muted">UTR</dt>
              <dd>
                <Utr value="412345678901" />
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-[14px] sm:px-5">
              <dt className="text-muted">Date (IST)</dt>
              <dd>
                <DateText value="2026-11-24T12:00:00Z" />
              </dd>
            </div>
          </dl>
        </Card>
      </Section>

      <Section id="ui-lists" title="Cards, list rows and states">
        <Card className="overflow-hidden">
          <CardHeader
            title="Residents"
            description="Card header with an action"
            action={
              <Button size="sm" variant="ghost">
                View all
              </Button>
            }
          />
          <CardList>
            <li>
              <ListRow
                leading={<Avatar name="Ravi Kumar" />}
                title="Ravi Kumar"
                meta="Room 204 · Bed A"
                trailing={<Money paise={600000} className="text-[14px] font-semibold" />}
              />
            </li>
            <li>
              <ListRow leading={<Avatar name="Sita Devi" />} title="Sita Devi" meta="Room 101 · Bed C" />
            </li>
          </CardList>
          <EmptyState action={<Button size="sm" variant="secondary">Add resident</Button>}>
            Empty state: one plain line and an optional action.
          </EmptyState>
        </Card>
        <SectionHeader title="Section header" description="With a description" action={<Button size="sm" variant="ghost">Action</Button>} />
        <div className="flex flex-col gap-2">
          <Notice tone="danger">Danger notice</Notice>
          <Notice tone="warning">Warning notice</Notice>
          <Notice tone="success">Success notice</Notice>
          <Notice tone="info">Info notice</Notice>
        </div>
        <Card>
          <CardBody className="flex flex-col gap-2.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardBody>
        </Card>
        <div className="flex flex-wrap items-center gap-3">
          <BrandMark size="sm" />
          <BrandMark />
          <BrandMark size="lg" />
          <Avatar name="Meera Nair" size="sm" />
          <Avatar name="Meera Nair" />
          <Avatar name="Meera Nair" size="lg" />
        </div>
      </Section>

      <Section id="ui-overlays" title="Sheet and toast">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open sheet
          </Button>
          <Button variant="secondary" onClick={() => showToast('Payment saved', 'success')}>
            Show toast
          </Button>
        </div>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Example sheet"
          description="Bottom sheet on phones, dialog on larger screens"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSheetOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setSheetOpen(false)}>Save</Button>
            </>
          }
        >
          <p className="text-[14px] text-muted">Esc, the backdrop or Close dismisses it. Focus stays inside.</p>
        </Sheet>
      </Section>

      <Section id="ui-quick" title="Quick-action sheets">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader title="Owner quick actions" />
            <CardBody>
              <QuickActionList actions={OWNER_QUICK_ACTIONS} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Caretaker quick actions" />
            <CardBody>
              <QuickActionList actions={CARETAKER_QUICK_ACTIONS} />
            </CardBody>
          </Card>
        </div>
      </Section>
    </div>
  )

  if (shell === 'caretaker') {
    return (
      <CaretakerShell orgName="Meera PGs (Preview)" userName="Raju Caretaker">
        {content}
      </CaretakerShell>
    )
  }

  return (
    <OwnerShell orgName="Meera PGs (Preview)" userName="Meera Owner" badges={{ '/owner/approvals': 3 }}>
      {content}
    </OwnerShell>
  )
}
