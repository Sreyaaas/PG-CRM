import { useState } from 'react'
import { DateText } from '@/components/DateText'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import {
  computeNoticeLastDay,
  formatNoticeRuleSummary,
  getErrorMessage,
  getTodayIST,
  useCorrectStayMutation,
  useGiveNoticeMutation,
  useMoveOutMutation,
  useWithdrawNoticeMutation,
  type Stay,
} from './api'

export function GiveNoticeSheet({
  open,
  onClose,
  stay,
  residentId,
  deadlineDay,
  isOwner,
  isPropertyLoading,
}: {
  open: boolean
  onClose: () => void
  stay: Stay
  residentId: string
  deadlineDay: number | undefined
  isOwner: boolean
  isPropertyLoading: boolean
}) {
  const { showToast } = useToast()
  const todayIST = getTodayIST()
  const effectiveDeadline = deadlineDay ?? 5
  const computedLastDay = computeNoticeLastDay(todayIST, effectiveDeadline)

  const [noticeGivenOn, setNoticeGivenOn] = useState(todayIST)
  const [expectedVacateDate, setExpectedVacateDate] = useState(computedLastDay)
  const [error, setError] = useState<string | null>(null)

  const mutation = useGiveNoticeMutation(residentId)

  function handleNoticeDateChange(nextDate: string) {
    setNoticeGivenOn(nextDate)
    if (nextDate && deadlineDay !== undefined) {
      setExpectedVacateDate(computeNoticeLastDay(nextDate, deadlineDay))
    }
  }

  async function handleConfirm() {
    setError(null)
    try {
      const updated = await mutation.mutateAsync({
        stayId: stay.id,
        body: isOwner
          ? {
              notice_given_on: noticeGivenOn || null,
              expected_vacate_date: expectedVacateDate || null,
            }
          : undefined,
      })
      const apiLastDay = updated.expected_vacate_date
      showToast(
        apiLastDay ? `Notice recorded · last day ${apiLastDay}` : 'Notice recorded',
        'success',
      )
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to record notice.'))
    }
  }

  const ruleText =
    deadlineDay !== undefined
      ? formatNoticeRuleSummary(
          isOwner && noticeGivenOn ? noticeGivenOn : todayIST,
          deadlineDay,
          isOwner && expectedVacateDate ? expectedVacateDate : computedLastDay,
        )
      : null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Give notice"
      description={`${stay.resident_name} · Room ${stay.room_label} · ${stay.bed_label}`}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={mutation.isPending || (!isOwner && isPropertyLoading)}
            onClick={() => void handleConfirm()}
          >
            {mutation.isPending ? 'Saving…' : 'Confirm notice'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        {error && <Notice role="alert">{error}</Notice>}

        {isPropertyLoading && deadlineDay === undefined ? (
          <p className="text-[14px] text-muted">Checking property notice rule…</p>
        ) : (
          <Notice tone="info">
            <div className="flex flex-col gap-1">
              {ruleText && <p>{ruleText}</p>}
              <p className="font-semibold">
                Last day:{' '}
                <DateText value={isOwner && expectedVacateDate ? expectedVacateDate : computedLastDay} />
              </p>
            </div>
          </Notice>
        )}

        {isOwner && (
          <div className="flex flex-col gap-3">
            <Field id="notice-given-on" label="Notice given on">
              <Input
                id="notice-given-on"
                type="date"
                value={noticeGivenOn}
                className="tabular-nums"
                onChange={(e) => handleNoticeDateChange(e.target.value)}
              />
            </Field>
            <Field
              id="notice-last-day"
              label="Last day (expected vacate date)"
              hint="Override to waive a month or set an agreed vacate date."
            >
              <Input
                id="notice-last-day"
                type="date"
                value={expectedVacateDate}
                className="tabular-nums"
                onChange={(e) => setExpectedVacateDate(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </Sheet>
  )
}

export function WithdrawNoticeSheet({
  open,
  onClose,
  stay,
  residentId,
}: {
  open: boolean
  onClose: () => void
  stay: Stay
  residentId: string
}) {
  const { showToast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const mutation = useWithdrawNoticeMutation(residentId)

  async function handleConfirm() {
    setError(null)
    try {
      await mutation.mutateAsync(stay.id)
      showToast('Notice withdrawn', 'success')
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to withdraw notice.'))
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Withdraw notice"
      description={`${stay.resident_name} · Room ${stay.room_label} · ${stay.bed_label}`}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={mutation.isPending}
            onClick={() => void handleConfirm()}
          >
            {mutation.isPending ? 'Withdrawing…' : 'Confirm withdraw'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-1">
        {error && <Notice role="alert">{error}</Notice>}
        <p className="text-[14px] text-ink">
          Return {stay.resident_name} to active status on bed {stay.bed_label} and clear the expected vacate date?
        </p>
      </div>
    </Sheet>
  )
}

export function MoveOutSheet({
  open,
  onClose,
  stay,
  residentId,
  isOwner,
}: {
  open: boolean
  onClose: () => void
  stay: Stay
  residentId: string
  isOwner: boolean
}) {
  const { showToast } = useToast()
  const todayIST = getTodayIST()
  const [vacateDate, setVacateDate] = useState(todayIST)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMoveOutMutation(residentId)

  async function handleConfirm() {
    setError(null)
    const targetDate = isOwner ? vacateDate : todayIST
    if (!targetDate) {
      setError('Please choose a move-out date.')
      return
    }
    try {
      await mutation.mutateAsync({ stayId: stay.id, actual_vacate_date: targetDate })
      showToast(`Moved out · bed ${stay.bed_label} is now vacant`, 'success')
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to record move-out.'))
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Move out today"
      description={`${stay.resident_name} · Room ${stay.room_label} · ${stay.bed_label}`}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={mutation.isPending}
            onClick={() => void handleConfirm()}
          >
            {mutation.isPending ? 'Moving out…' : 'Confirm move-out'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        {error && <Notice role="alert">{error}</Notice>}
        <Notice tone="warning">
          This marks the stay as vacated on{' '}
          <DateText value={isOwner && vacateDate ? vacateDate : todayIST} /> and makes bed{' '}
          <span className="font-semibold">{stay.bed_label}</span> vacant immediately.
        </Notice>
        {isOwner && (
          <Field id="move-out-date" label="Move-out date">
            <Input
              id="move-out-date"
              type="date"
              value={vacateDate}
              className="tabular-nums"
              onChange={(e) => setVacateDate(e.target.value)}
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}

export function CorrectDatesSheet({
  open,
  onClose,
  stay,
  residentId,
}: {
  open: boolean
  onClose: () => void
  stay: Stay
  residentId: string
}) {
  const { showToast } = useToast()
  const [checkInDate, setCheckInDate] = useState(stay.check_in_date)
  const [actualVacateDate, setActualVacateDate] = useState(stay.actual_vacate_date ?? '')
  const [error, setError] = useState<string | null>(null)
  const mutation = useCorrectStayMutation(residentId)

  async function handleSave() {
    setError(null)
    const body: { check_in_date?: string; actual_vacate_date?: string } = {}
    if (checkInDate && checkInDate !== stay.check_in_date) {
      body.check_in_date = checkInDate
    }
    if (stay.status === 'vacated' && actualVacateDate && actualVacateDate !== (stay.actual_vacate_date ?? '')) {
      body.actual_vacate_date = actualVacateDate
    }
    if (Object.keys(body).length === 0) {
      onClose()
      return
    }
    try {
      await mutation.mutateAsync({ stayId: stay.id, body })
      showToast('Stay dates updated', 'success')
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to update dates.'))
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Correct dates"
      description={`${stay.resident_name} · Room ${stay.room_label} · ${stay.bed_label}`}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={mutation.isPending}
            onClick={() => void handleSave()}
          >
            {mutation.isPending ? 'Saving…' : 'Save dates'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        {error && <Notice role="alert">{error}</Notice>}
        <Field id="correct-checkin-date" label="Check-in date">
          <Input
            id="correct-checkin-date"
            type="date"
            value={checkInDate}
            className="tabular-nums"
            onChange={(e) => setCheckInDate(e.target.value)}
          />
        </Field>
        {stay.status === 'vacated' && (
          <Field id="correct-vacate-date" label="Move-out date">
            <Input
              id="correct-vacate-date"
              type="date"
              value={actualVacateDate}
              className="tabular-nums"
              onChange={(e) => setActualVacateDate(e.target.value)}
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}
