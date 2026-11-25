import { useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, MoneyInput, Select, Textarea } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { formatINR, parseRupeesToPaise } from '@/lib/money'
import {
  getErrorMessage,
  useApproveCheckin,
  useBedBoard,
  useCheckinDetail,
  useCreateDiscountRequest,
  useDiscountRequestsList,
  type BoardBed,
  type OnboardingApproved,
  type OnboardingRequestDetail,
} from './useCheckins'

function getTodayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function paiseToRupeeInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return ''
  if (paise % 100 === 0) return String(paise / 100)
  return (paise / 100).toFixed(2)
}

function tryParsePaise(value: string): number | null {
  try {
    const p = parseRupeesToPaise(value)
    return p >= 0 ? p : null
  } catch {
    return null
  }
}

function buildWhatsappFallback(detail: OnboardingRequestDetail): string {
  const digits = detail.phone.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `91${digits}` : digits
  const msg = `Welcome to ${detail.property_name}, ${detail.full_name}! Your check-in is approved.`
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`
}

export interface ApproveSheetProps {
  open: boolean
  onClose: () => void
  detail: OnboardingRequestDetail
  onApproved: () => void
}

export function ApproveSheet({ open, onClose, detail, onApproved }: ApproveSheetProps) {
  const { showToast } = useToast()
  const todayIST = useMemo(() => getTodayIST(), [])

  const [selectedBedId, setSelectedBedId] = useState('')
  const [stayType, setStayType] = useState<'monthly' | 'short_term'>('monthly')
  const [rentOverride, setRentOverride] = useState<string | null>(null)
  const [depositInput, setDepositInput] = useState(() => paiseToRupeeInput(detail.suggested.deposit_paise))
  const [maintenanceInput, setMaintenanceInput] = useState(() =>
    paiseToRupeeInput(detail.suggested.maintenance_charge_paise),
  )
  const [checkInDate, setCheckInDate] = useState(todayIST)
  const [checkoutDate, setCheckoutDate] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [approvedResult, setApprovedResult] = useState<OnboardingApproved | null>(null)

  const boardQuery = useBedBoard(open ? detail.property_id : undefined)
  const suggestedQuery = useCheckinDetail(open && selectedBedId ? detail.id : undefined, {
    bedId: selectedBedId || undefined,
    stayType,
  })
  const activeSuggested = suggestedQuery.data?.suggested ?? detail.suggested

  const vacantRooms = useMemo(() => {
    const rooms = boardQuery.data?.rooms ?? []
    return rooms
      .map((room) => ({
        ...room,
        beds: room.beds.filter((b) => b.status === 'vacant' && b.is_active),
      }))
      .filter((room) => room.beds.length > 0)
  }, [boardQuery.data])

  const selectedBed: BoardBed | null = useMemo(() => {
    for (const room of vacantRooms) {
      const found = room.beds.find((b) => b.id === selectedBedId)
      if (found) return found
    }
    return null
  }, [vacantRooms, selectedBedId])

  const defaultRentInput =
    stayType === 'short_term'
      ? paiseToRupeeInput(activeSuggested.rent_paise)
      : selectedBed
        ? paiseToRupeeInput(activeSuggested.rent_paise ?? selectedBed.base_rent_paise)
        : ''
  const rentInput = rentOverride ?? defaultRentInput

  const rentPaise = tryParsePaise(rentInput)
  const depositPaise = tryParsePaise(depositInput)
  const maintenancePaise = tryParsePaise(maintenanceInput)

  const isBelowFloor =
    stayType === 'monthly' &&
    selectedBed !== null &&
    rentPaise !== null &&
    rentPaise < selectedBed.base_rent_paise

  const discountQuery = useDiscountRequestsList(open && isBelowFloor)
  const createDiscount = useCreateDiscountRequest()
  const approveMutation = useApproveCheckin(detail.id, detail.property_id)

  const matchingDiscounts = useMemo(() => {
    if (!isBelowFloor || !selectedBed || rentPaise === null) return []
    return (discountQuery.data ?? []).filter(
      (d) => d.bed_id === selectedBed.id && d.requested_rent_paise === rentPaise,
    )
  }, [discountQuery.data, isBelowFloor, selectedBed, rentPaise])

  const approvedDiscount = matchingDiscounts.find((d) => d.status === 'approved') ?? null
  const pendingDiscount = matchingDiscounts.find((d) => d.status === 'pending') ?? null

  const canComputeProRata =
    stayType === 'monthly' &&
    checkInDate === todayIST &&
    activeSuggested.first_month_rent_paise !== null &&
    rentPaise !== null &&
    activeSuggested.rent_paise !== null &&
    rentPaise === activeSuggested.rent_paise

  const proRataPaise = canComputeProRata ? activeSuggested.first_month_rent_paise : null
  const totalTodayPaise =
    proRataPaise !== null && depositPaise !== null && maintenancePaise !== null
      ? depositPaise + maintenancePaise + proRataPaise
      : null

  function handleBedChange(bedId: string) {
    setSelectedBedId(bedId)
    setRentOverride(null)
    setFormError(null)
  }

  function handleStayTypeChange(next: 'monthly' | 'short_term') {
    setStayType(next)
    setRentOverride(null)
    setFormError(null)
  }

  async function handleRequestDiscount() {
    setFormError(null)
    if (!selectedBed || rentPaise === null) return
    const reason = discountReason.trim()
    if (!reason) {
      setFormError('Please enter a reason for the discount request.')
      return
    }
    try {
      await createDiscount.mutateAsync({
        bed_id: selectedBed.id,
        requested_rent_paise: rentPaise,
        reason,
      })
      setDiscountReason('')
      showToast('Discount requested from owner', 'success')
      void discountQuery.refetch()
    } catch (err) {
      setFormError(getErrorMessage(err, 'Unable to request discount.'))
    }
  }

  async function handleApprove() {
    setFormError(null)
    if (!selectedBedId) {
      setFormError('Please select a vacant bed.')
      return
    }
    if (rentPaise === null || depositPaise === null || maintenancePaise === null) {
      setFormError('Please enter valid rupee amounts.')
      return
    }
    if (!checkInDate) {
      setFormError('Please choose a check-in date.')
      return
    }
    if (stayType === 'short_term' && !checkoutDate) {
      setFormError('Please choose a check-out date for short stay.')
      return
    }
    try {
      const res = await approveMutation.mutateAsync({
        bed_id: selectedBedId,
        stay_type: stayType,
        rent_paise: rentPaise,
        deposit_paise: depositPaise,
        maintenance_charge_paise: maintenancePaise,
        check_in_date: checkInDate,
        expected_vacate_date: stayType === 'short_term' ? checkoutDate : null,
        discount_request_id: approvedDiscount?.id ?? null,
      })
      showToast('Check-in approved', 'success')
      setApprovedResult(res)
    } catch (err) {
      setFormError(getErrorMessage(err, 'Unable to approve check-in.'))
    }
  }

  const whatsappUrl = approvedResult?.whatsapp_url || buildWhatsappFallback(detail)

  if (approvedResult) {
    return (
      <Sheet
        open={open}
        onClose={() => {
          onApproved()
          onClose()
        }}
        title="Check-in approved"
        description={`${detail.full_name} · ${selectedBed?.label ?? ''}`}
        footer={
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onApproved()
              onClose()
            }}
          >
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-4 py-2">
          <Notice tone="success">
            Resident checked in and joining invoices created.
          </Notice>
          <Button asChild variant="brand" block size="lg">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              Share welcome / deposit invoice on WhatsApp
            </a>
          </Button>
        </div>
      </Sheet>
    )
  }

  const showRequestDiscount = isBelowFloor && !approvedDiscount && !pendingDiscount
  const showWaitingDiscount = isBelowFloor && !approvedDiscount && Boolean(pendingDiscount)

  const footerButton = showRequestDiscount ? (
    <Button
      type="button"
      variant="brand"
      size="lg"
      disabled={createDiscount.isPending}
      onClick={() => void handleRequestDiscount()}
    >
      {createDiscount.isPending ? 'Requesting…' : 'Request discount from owner'}
    </Button>
  ) : showWaitingDiscount ? (
    <Button type="button" variant="secondary" size="lg" disabled>
      Waiting for owner approval
    </Button>
  ) : (
    <Button
      type="button"
      variant="brand"
      size="lg"
      disabled={approveMutation.isPending || !selectedBedId}
      onClick={() => void handleApprove()}
    >
      {approveMutation.isPending ? 'Approving…' : 'Confirm approve'}
    </Button>
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Approve check-in"
      description={`${detail.full_name} · ${detail.property_name}`}
      footer={footerButton}
    >
      <div className="flex flex-col gap-4 py-1">
        {formError && <Notice role="alert">{formError}</Notice>}

        <Field id="approve-bed" label="Vacant bed">
          <Select
            id="approve-bed"
            value={selectedBedId}
            disabled={boardQuery.isLoading}
            onChange={(e) => handleBedChange(e.target.value)}
          >
            <option value="">
              {boardQuery.isLoading
                ? 'Loading vacant beds…'
                : vacantRooms.length === 0
                  ? 'No vacant beds available'
                  : 'Select a vacant bed…'}
            </option>
            {vacantRooms.map((room) => (
              <optgroup
                key={room.id}
                label={`Room ${room.label} (${room.sharing}-sharing${room.is_ac ? ' · AC' : ''})`}
              >
                {room.beds.map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.label} — {formatINR(bed.base_rent_paise)}/mo
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13.5px] font-medium text-ink">Stay type</span>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Stay type">
            <Chip
              pressed={stayType === 'monthly'}
              className="h-11 justify-center"
              onClick={() => handleStayTypeChange('monthly')}
            >
              Monthly
            </Chip>
            <Chip
              pressed={stayType === 'short_term'}
              className="h-11 justify-center"
              onClick={() => handleStayTypeChange('short_term')}
            >
              Short stay
            </Chip>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="approve-rent"
            label={stayType === 'monthly' ? 'Monthly rent' : 'Daily rate'}
            hint={
              stayType === 'monthly' && selectedBed
                ? `Floor price: ${formatINR(selectedBed.base_rent_paise)}`
                : undefined
            }
          >
            <MoneyInput
              id="approve-rent"
              value={rentInput}
              onChange={(e) => setRentOverride(e.target.value)}
            />
          </Field>

          <Field id="approve-checkin-date" label="Check-in date">
            <Input
              id="approve-checkin-date"
              type="date"
              value={checkInDate}
              className="tabular-nums"
              onChange={(e) => setCheckInDate(e.target.value)}
            />
          </Field>
        </div>

        {stayType === 'short_term' && (
          <Field id="approve-checkout-date" label="Check-out date *">
            <Input
              id="approve-checkout-date"
              type="date"
              value={checkoutDate}
              className="tabular-nums"
              onChange={(e) => setCheckoutDate(e.target.value)}
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field id="approve-deposit" label="Security deposit">
            <MoneyInput
              id="approve-deposit"
              value={depositInput}
              onChange={(e) => setDepositInput(e.target.value)}
            />
          </Field>

          <Field id="approve-maintenance" label="Maintenance charge">
            <MoneyInput
              id="approve-maintenance"
              value={maintenanceInput}
              onChange={(e) => setMaintenanceInput(e.target.value)}
            />
          </Field>
        </div>

        {isBelowFloor && approvedDiscount && (
          <Notice tone="success">
            Owner approved discount (<Money paise={approvedDiscount.requested_rent_paise} />).
          </Notice>
        )}

        {showWaitingDiscount && (
          <Notice tone="warning">
            <div className="flex items-center justify-between gap-2">
              <span>Waiting for owner approval</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={discountQuery.isFetching}
                onClick={() => void discountQuery.refetch()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={discountQuery.isFetching ? 'animate-spin' : undefined}
                />
                Refresh
              </Button>
            </div>
          </Notice>
        )}

        {showRequestDiscount && (
          <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-3">
            <p className="text-[13px] font-medium text-ink">
              Rent is below the bed&apos;s floor price ({formatINR(selectedBed.base_rent_paise)}). Request owner approval:
            </p>
            <Field id="discount-reason" label="Reason for discount">
              <Textarea
                id="discount-reason"
                rows={2}
                placeholder="e.g. Long stay commitment or referral"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
              />
            </Field>
          </div>
        )}

        <section
          aria-label="Pays today summary"
          data-testid="pays-today-summary"
          className="rounded-card border border-line bg-surface-2 p-3.5"
        >
          <h3 className="text-[13px] font-semibold text-ink">Resident pays today</h3>
          <dl className="mt-2 flex flex-col gap-1.5 text-[13.5px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">Security deposit</dt>
              <dd className="font-medium text-ink">
                {depositPaise !== null ? <Money paise={depositPaise} /> : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">Maintenance charge</dt>
              <dd className="font-medium text-ink">
                {maintenancePaise !== null ? <Money paise={maintenancePaise} /> : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">
                {stayType === 'monthly' ? 'First month pro-rata' : 'Stay charges'}
              </dt>
              <dd className="font-medium text-ink" data-testid="prorata-amount">
                {proRataPaise !== null ? (
                  <Money paise={proRataPaise} />
                ) : (
                  <span className="text-muted">calculated on approval</span>
                )}
              </dd>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2 text-[14.5px] font-semibold">
              <dt className="text-ink">Total due today</dt>
              <dd className="text-ink" data-testid="total-today">
                {totalTodayPaise !== null ? (
                  <Money paise={totalTodayPaise} />
                ) : (
                  <span className="text-[13px] font-medium text-muted">calculated on approval</span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </Sheet>
  )
}
