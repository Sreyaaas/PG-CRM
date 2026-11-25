import { useState, type FormEvent, type ReactNode } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { useLocation, useParams } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Utr } from '@/components/Utr'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, MoneyInput, Select, Textarea } from '@/components/ui/input'
import { LoadingRows, Notice, PageHeader, StatTile } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { getErrorMessage, useResidentQuery } from '@/features/residents/api'
import { parseRupeesToPaise } from '@/lib/money'
import {
  useSettleMutation,
  useSettlementPreviewQuery,
  type SettlementCreate,
  type SettlementCreated,
} from './api'

type RefundMethod = 'cash' | 'upi' | 'bank_transfer'

const METHOD_LABELS: Record<RefundMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
}

function Row({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <div className="text-[14px] text-ink">{label}</div>
        {note && <div className="text-[12.5px] text-muted">{note}</div>}
      </div>
      <div className="shrink-0 text-[14.5px] font-semibold text-ink tabular-nums">{value}</div>
    </div>
  )
}

export function SettlementPage() {
  const { residentId, stayId } = useParams<{ residentId: string; stayId: string }>()
  const { pathname } = useLocation()
  const { membership } = useAuth()
  const { showToast } = useToast()
  const isOwner = membership?.role === 'owner' || pathname.startsWith('/owner')
  const base = isOwner ? '/owner' : '/caretaker'

  const residentQuery = useResidentQuery(residentId)
  const previewQuery = useSettlementPreviewQuery(stayId)
  const settle = useSettleMutation(stayId)
  const preview = previewQuery.data
  const stay = residentQuery.data?.past_stays.find((s) => s.id === stayId)

  const [otherAmount, setOtherAmount] = useState('')
  const [otherNote, setOtherNote] = useState('')
  const [method, setMethod] = useState<'' | RefundMethod>('')
  const [utr, setUtr] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<SettlementCreated | null>(null)

  const needsUtr = method === 'upi' || method === 'bank_transfer'
  const utrDigits = utr.replace(/\s+/g, '')

  function validate(): SettlementCreate | null {
    const next: Record<string, string> = {}
    let paise = 0
    if (otherAmount.trim()) {
      try {
        paise = parseRupeesToPaise(otherAmount)
      } catch {
        next.other = 'Enter a valid amount.'
      }
    }
    const note = otherNote.trim()
    if (paise > 0 && note.length < 3) next.note = 'Add a note explaining the deduction.'
    if (needsUtr && !/^\d{12}$/.test(utrDigits)) next.utr = 'Enter the 12-digit UTR.'
    setErrors(next)
    if (Object.keys(next).length > 0) return null
    return {
      other_deductions_paise: paise,
      other_deductions_note: paise > 0 ? note : null,
      refund_method: method || null,
      refund_utr: needsUtr ? utrDigits : null,
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const body = validate()
    if (!body) return
    try {
      setCreated(await settle.mutateAsync(body))
      showToast('Settlement recorded', 'success')
    } catch (err) {
      const message = getErrorMessage(err, 'Unable to record the settlement.')
      setFormError(message)
      showToast(message, 'error')
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      showToast('Link copied', 'success')
    } catch {
      showToast('Unable to copy the link.', 'error')
    }
  }

  const name = residentQuery.data?.full_name

  return (
    <div className="flex max-w-2xl flex-col gap-5 pb-8">
      <PageHeader
        back={{ to: `${base}/residents/${residentId}`, label: 'Resident' }}
        title={isOwner ? 'Settle deposit' : 'Settlement'}
        description={
          name ? (
            <span>
              {name}
              {stay?.actual_vacate_date && (
                <>
                  {' · left '}
                  <DateText value={stay.actual_vacate_date} />
                </>
              )}
            </span>
          ) : undefined
        }
      />

      {previewQuery.isError && (
        <Notice role="alert">{getErrorMessage(previewQuery.error, 'Unable to load the settlement.')}</Notice>
      )}
      {previewQuery.isLoading && (
        <Card>
          <LoadingRows label="Loading settlement…" rows={4} />
        </Card>
      )}

      {created && (
        <Card aria-label="Settlement recorded">
          <CardHeader title="Settlement recorded" />
          <CardBody className="flex flex-col gap-4">
            <StatTile
              label={created.net_refund_paise < 0 ? 'Resident still owes' : 'Net refund'}
              value={<Money paise={Math.abs(created.net_refund_paise)} />}
              highlight
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="brand" size="lg">
                <a href={created.whatsapp_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" />
                  Share on WhatsApp
                </a>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => void copyLink(created.settlement_url)}
              >
                <Copy aria-hidden="true" />
                Copy link
              </Button>
            </div>
            <a
              href={created.settlement_url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[13px] text-brand-ink underline"
            >
              {created.settlement_url}
            </a>
          </CardBody>
        </Card>
      )}

      {preview && !created && (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <Card aria-label="Settlement preview" className="overflow-hidden">
            <CardHeader title="Settlement" />
            <div className="divide-y divide-line">
              <Row label="Deposit held" value={<Money paise={preview.deposit_held_paise} />} />
              <Row
                label="Exit deduction"
                note="The resident accepted this at onboarding."
                value={<Money paise={preview.exit_deduction_paise} />}
              />
              <Row label="Pending dues" value={<Money paise={preview.pending_dues_paise} />} />
              <Row
                label={preview.suggested_net_refund_paise < 0 ? 'Resident owes' : 'Refund before other deductions'}
                value={<Money paise={Math.abs(preview.suggested_net_refund_paise)} />}
              />
            </div>
          </Card>

          {!isOwner ? (
            <Notice tone="info">Only the owner can record the settlement.</Notice>
          ) : (
            <Card aria-label="Record settlement">
              <CardHeader title="Other deductions and refund" />
              <CardBody className="flex flex-col gap-4">
                {formError && <Notice role="alert">{formError}</Notice>}
                <Field id="other-deductions" label="Other deductions (optional)" error={errors.other}>
                  <MoneyInput
                    id="other-deductions"
                    inputMode="decimal"
                    value={otherAmount}
                    onChange={(e) => setOtherAmount(e.target.value)}
                  />
                </Field>
                <Field id="other-deductions-note" label="Reason for deduction" error={errors.note}>
                  <Textarea
                    id="other-deductions-note"
                    rows={2}
                    maxLength={500}
                    placeholder="Broken cupboard door"
                    value={otherNote}
                    onChange={(e) => setOtherNote(e.target.value)}
                  />
                </Field>
                <Field id="refund-method" label="Refund method">
                  <Select
                    id="refund-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as '' | RefundMethod)}
                  >
                    <option value="">Not refunded yet</option>
                    {(Object.keys(METHOD_LABELS) as RefundMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {needsUtr && (
                  <Field
                    id="refund-utr"
                    label="Refund UTR"
                    hint={utrDigits ? <Utr value={utrDigits} /> : undefined}
                    error={errors.utr}
                  >
                    <Input
                      id="refund-utr"
                      inputMode="numeric"
                      autoComplete="off"
                      className="tabular-nums"
                      value={utr}
                      onChange={(e) => setUtr(e.target.value)}
                    />
                  </Field>
                )}
                <Button type="submit" variant="brand" size="lg" block disabled={settle.isPending}>
                  {settle.isPending ? 'Recording…' : 'Confirm settlement'}
                </Button>
              </CardBody>
            </Card>
          )}
        </form>
      )}
    </div>
  )
}
