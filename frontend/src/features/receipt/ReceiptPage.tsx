import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Printer, Smartphone } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Utr } from '@/components/Utr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { BrandMark, LoadingRows, Notice } from '@/components/ui/misc'
import { usePublicDocumentQuery, type PublicDocument } from './api'

type Receipt = Extract<PublicDocument, { type: 'payment_receipt' }>
type Invoice = Extract<PublicDocument, { type: 'invoice' }>
type Settlement = Extract<PublicDocument, { type: 'exit_settlement' }>

const METHOD_LABEL: Record<Receipt['method'], string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
}

const KIND_LABEL: Record<Invoice['kind'], string> = {
  rent: 'Rent',
  short_term: 'Short stay',
  deposit: 'Security deposit',
  maintenance_charge: 'Maintenance charge',
  exit_deduction: 'Exit deduction',
  other: 'Other charge',
}

const IST_TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
})

/** The page is for residents holding a private link: keep it out of search engines. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    const previousTitle = document.title
    document.title = 'Receipt'
    return () => {
      meta.remove()
      document.title = previousTitle
    }
  }, [])
}

export function ReceiptPage() {
  const { token = '' } = useParams()
  useNoIndex()
  const query = usePublicDocumentQuery(token)

  let body: ReactNode
  if (query.isLoading) {
    body = (
      <Card>
        <LoadingRows label="Loading…" />
      </Card>
    )
  } else if (query.isError || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    body = (
      <Card>
        <CardBody className="flex flex-col gap-2 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-ink">
            {notFound ? 'This link is invalid or expired.' : 'Unable to load this page'}
          </h1>
          <p className="text-[14px] text-muted">
            {notFound
              ? 'Ask the reception to send you a fresh link.'
              : query.error instanceof ApiError
                ? query.error.message
                : 'Check your connection and try again.'}
          </p>
          {!notFound && (
            <div className="pt-2">
              <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    )
  } else {
    body = <DocumentView doc={query.data} />
  }

  return (
    <main className="min-h-dvh bg-page px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto flex max-w-lg flex-col gap-4 print:max-w-none">{body}</div>
    </main>
  )
}

function DocumentView({ doc }: { doc: PublicDocument }) {
  switch (doc.type) {
    case 'payment_receipt':
      return <ReceiptView doc={doc} />
    case 'invoice':
      return <InvoiceView doc={doc} />
    case 'exit_settlement':
      return <SettlementView doc={doc} />
  }
}

/* ───────── Shared layout ───────── */

function Sheet({
  label,
  title,
  property,
  badge,
  children,
  footer,
}: {
  label: string
  title: string
  property: string
  badge?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <>
      <Card className="overflow-hidden print:rounded-none print:border print:border-black print:shadow-none">
        <article aria-label={label}>
          <header className="flex items-center gap-3 border-b border-line px-4 py-4 sm:px-5">
            <BrandMark size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-muted">{property}</p>
              <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            </div>
            {badge}
          </header>
          {children}
        </article>
      </Card>
      {footer}
      <div className="flex flex-col gap-3 print:hidden">
        <Button type="button" variant="secondary" block onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          Download / Print
        </Button>
      </div>
      <p className="text-center text-[12px] text-muted print:text-black">
        This is a computer-generated document and needs no signature.
      </p>
    </>
  )
}

function Hero({ label, children, tone }: { label: string; children: ReactNode; tone?: 'success' | 'danger' }) {
  return (
    <div className="flex flex-col items-center gap-1 border-b border-line px-4 py-6 text-center sm:px-5">
      <span className="text-[12.5px] font-medium text-muted">{label}</span>
      <span
        className={`text-[34px] font-bold leading-tight tracking-[-0.02em] tabular-nums ${
          tone === 'success' ? 'text-success-ink' : tone === 'danger' ? 'text-danger-ink' : 'text-ink'
        }`}
      >
        {children}
      </span>
    </div>
  )
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line px-4 sm:px-5">{children}</dl>
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 text-[14px]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`min-w-0 break-words text-right text-ink ${strong ? 'font-semibold' : 'font-medium'}`}>
        {children}
      </dd>
    </div>
  )
}

function Period({ start, end }: { start: string; end: string }) {
  return (
    <>
      <DateText value={start} /> to <DateText value={end} />
    </>
  )
}

/* ───────── Payment receipt ───────── */

function ReceiptView({ doc }: { doc: Receipt }) {
  return (
    <Sheet
      label="Payment receipt"
      title="Payment receipt"
      property={doc.property_name}
      badge={<StatusBadge kind="payment" value={doc.status} />}
    >
      <Hero label="Amount received">
        <Money paise={doc.amount_paise} />
      </Hero>
      {doc.status === 'provisional' && (
        <div className="px-4 pt-4 sm:px-5">
          <Notice tone="warning" role="status">
            Payment received; verification pending.
          </Notice>
        </div>
      )}
      <Rows>
        <Row label="Receipt no.">
          <span className="font-mono tabular-nums">{doc.receipt_no}</span>
        </Row>
        <Row label="Resident">{doc.resident_name}</Row>
        <Row label="Method">{METHOD_LABEL[doc.method]}</Row>
        {doc.utr_number && (
          <Row label="UTR">
            <Utr value={doc.utr_number} />
          </Row>
        )}
        <Row label="Date">
          <DateText value={doc.received_at} />{' '}
          <span className="tabular-nums">{IST_TIME.format(new Date(doc.received_at))}</span>
        </Row>
        {doc.invoice_no && (
          <Row label="Invoice">
            <span className="tabular-nums">{doc.invoice_no}</span>
          </Row>
        )}
        {doc.period_start && doc.period_end && (
          <Row label="Period">
            <Period start={doc.period_start} end={doc.period_end} />
          </Row>
        )}
      </Rows>
      <div className="h-2" />
    </Sheet>
  )
}

/* ───────── Invoice with UPI QR ───────── */

function isUpiUri(uri: string | null): uri is string {
  return uri !== null && /^upi:\/\//i.test(uri)
}

function InvoiceView({ doc }: { doc: Invoice }) {
  const isVoid = doc.status === 'void'
  const due = doc.outstanding_paise
  const upiId = doc.fallback_upi_id || doc.upi_vpa
  const uri = isUpiUri(doc.upi_uri) ? doc.upi_uri : null
  const showPay = !isVoid && due > 0 && Boolean(upiId || doc.bank_details || uri)

  return (
    <Sheet
      label="Invoice"
      title={`Invoice ${doc.invoice_no}`}
      property={doc.property_name}
      badge={
        isVoid ? (
          <StatusBadge kind="payment" value="void" />
        ) : due === 0 ? (
          <Badge tone="success">Paid</Badge>
        ) : (
          <Badge tone="warning">Due</Badge>
        )
      }
      footer={
        showPay ? (
          <PayCard uri={uri} upiId={upiId} bankDetails={doc.bank_details} payee={doc.upi_payee_name} />
        ) : null
      }
    >
      <Hero label={isVoid ? 'This invoice is void' : due === 0 ? 'Paid in full' : 'Amount due'}>
        <Money paise={isVoid ? 0 : due} />
      </Hero>
      <Rows>
        <Row label="Resident">{doc.resident_name}</Row>
        <Row label="For">{KIND_LABEL[doc.kind]}</Row>
        {doc.period_start && doc.period_end && (
          <Row label="Period">
            <Period start={doc.period_start} end={doc.period_end} />
          </Row>
        )}
        <Row label="Due date">
          <DateText value={doc.due_date} />
        </Row>
        <Row label="Invoice amount">
          <Money paise={doc.amount_paise} />
        </Row>
        <Row label="Paid so far">
          <Money paise={doc.paid_paise} />
        </Row>
      </Rows>
      <div className="h-2" />
    </Sheet>
  )
}

function PayCard({
  uri,
  upiId,
  bankDetails,
  payee,
}: {
  uri: string | null
  upiId: string | null
  bankDetails: string | null
  payee: string | null
}) {
  return (
    <Card className="print:break-inside-avoid print:rounded-none print:border-black print:shadow-none">
      <CardBody className="flex flex-col gap-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Pay this invoice</h2>
        {uri && <UpiQr uri={uri} />}
        {uri && (
          <Button asChild variant="brand" size="lg" block className="print:hidden">
            <a href={uri}>
              <Smartphone aria-hidden="true" />
              Pay with UPI app
            </a>
          </Button>
        )}
        {uri && (
          <p className="text-center text-[12.5px] text-muted print:hidden">
            The button may not open on some phones. Use the UPI ID or bank details below instead.
          </p>
        )}
        {(upiId || bankDetails) && (
          <div className="flex flex-col divide-y divide-line rounded-control border border-line">
            {upiId && <CopyRow label="UPI ID" value={upiId} sub={payee} />}
            {bankDetails && <CopyRow label="Bank details" value={bankDetails} multiline />}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function UpiQr({ uri }: { uri: string }) {
  const [png, setPng] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 2, width: 512 })
      .then((url) => {
        if (!cancelled) setPng(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [uri])

  return (
    <div className="flex flex-col items-center gap-2">
      {png ? (
        <img
          src={png}
          alt="UPI QR code for this invoice"
          width={256}
          height={256}
          className="size-64 rounded-control border border-line bg-white"
        />
      ) : (
        <div className="size-64 rounded-control border border-line bg-surface-2" aria-hidden="true" />
      )}
      {failed ? (
        <p className="text-center text-[13px] text-danger-ink">Could not draw the QR code. Use the UPI ID below.</p>
      ) : (
        <p className="text-center text-[13px] text-muted">Scan with another phone&apos;s camera / UPI app</p>
      )}
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function CopyRow({
  label,
  value,
  sub,
  multiline,
}: {
  label: string
  value: string
  sub?: string | null
  multiline?: boolean
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function onCopy() {
    const ok = await copyText(value)
    setState(ok ? 'copied' : 'failed')
    window.setTimeout(() => setState('idle'), 2000)
  }

  return (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-muted">{label}</p>
        <p
          className={`break-words text-[15px] font-medium text-ink ${multiline ? 'whitespace-pre-line' : 'tabular-nums'}`}
        >
          {value}
        </p>
        {sub && <p className="text-[12.5px] text-muted">{sub}</p>}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="print:hidden"
        aria-label={`Copy ${label}`}
        onClick={() => void onCopy()}
      >
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </Button>
    </div>
  )
}

/* ───────── Exit settlement ───────── */

function SettlementView({ doc }: { doc: Settlement }) {
  const net = doc.net_refund_paise
  const owes = net < 0
  return (
    <Sheet label="Exit settlement" title="Exit settlement" property={doc.property_name}>
      <Hero label={owes ? 'Amount payable' : 'Net refund'} tone={owes ? 'danger' : 'success'}>
        <Money paise={Math.abs(net)} />
      </Hero>
      <Rows>
        <Row label="Resident">{doc.resident_name}</Row>
        <Row label="Check-in">
          <DateText value={doc.check_in_date} />
        </Row>
        {doc.vacate_date && (
          <Row label="Vacated">
            <DateText value={doc.vacate_date} />
          </Row>
        )}
        <Row label="Security deposit">
          <Money paise={doc.deposit_paise} />
        </Row>
        <Row label="Exit deduction">
          <Money paise={doc.exit_deduction_paise} />
        </Row>
        <Row label="Other deductions">
          <Money paise={doc.other_deductions_paise} />
          {doc.other_deductions_note && (
            <span className="block text-[12.5px] font-normal text-muted">{doc.other_deductions_note}</span>
          )}
        </Row>
        <Row label="Pending dues">
          <Money paise={doc.pending_dues_paise} />
        </Row>
        <Row label={owes ? 'Amount payable' : 'Net refund'} strong>
          <span className={owes ? 'text-danger-ink' : 'text-success-ink'}>
            <Money paise={Math.abs(net)} />
          </span>
        </Row>
        {doc.refund_method && <Row label="Refund method">{METHOD_LABEL[doc.refund_method]}</Row>}
        {doc.refund_utr && (
          <Row label="Refund UTR">
            <Utr value={doc.refund_utr} />
          </Row>
        )}
        <Row label="Settled on">
          <DateText value={doc.settled_at} />
        </Row>
      </Rows>
      <div className="h-2" />
    </Sheet>
  )
}
