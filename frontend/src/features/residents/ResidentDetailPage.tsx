import { ProfileEditSheet } from './ProfileEditSheet'
import { useState, type ReactNode } from 'react'
import { Check, ExternalLink, MessageCircle, Pencil, Phone, X, ZoomIn } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge, type BedBadgeValue } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { useLedgerQuery } from '@/features/dues/api'
import { useReminders } from '@/features/dues/reminders'
import { useOrgId, usePropertyQuery } from '@/features/properties/api'
import {
  getErrorMessage,
  useCheckInMutation,
  useResidentQuery,
  type Stay,
} from './api'
import {
  CorrectDatesSheet,
  GiveNoticeSheet,
  MoveOutSheet,
  WithdrawNoticeSheet,
} from './StayActionSheets'

const ID_DOC_LABELS: Record<string, string> = {
  aadhaar: 'Aadhaar',
  pan: 'PAN',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  passport: 'Passport',
}

const OCCUPATION_LABELS: Record<string, string> = {
  working: 'Working professional',
  student: 'Student',
  other: 'Other',
}

const FOOD_LABELS: Record<string, string> = {
  veg: 'Vegetarian',
  non_veg: 'Non-vegetarian',
  egg: 'Eggetarian',
}

const POLICE_LABELS: Record<string, string> = {
  pending: 'Pending',
  submitted: 'Submitted',
  verified: 'Verified',
}

function buildWhatsappUrl(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${e164}`
}

function stayStatusBadge(status: Stay['status']) {
  if (status === 'vacated') {
    return <Badge tone="neutral">Vacated</Badge>
  }
  const value: BedBadgeValue = status === 'active' ? 'occupied' : status
  return <StatusBadge kind="bed" value={value} />
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[12.5px] font-medium text-muted">{label}</dt>
      <dd className="text-[14px] text-ink sm:text-right">{value}</dd>
    </div>
  )
}

export function ResidentDetailPage() {
  const [editingProfile, setEditingProfile] = useState(false)
  const { residentId } = useParams<{ residentId: string }>()
  const { pathname } = useLocation()
  const { membership } = useAuth()
  const { showToast } = useToast()

  const isOwner = membership?.role === 'owner' || pathname.startsWith('/owner')
  const bedsPath = isOwner ? '/owner/beds' : '/caretaker/beds'

  const query = useResidentQuery(residentId)
  const resident = query.data
  const propertyQuery = usePropertyQuery(resident?.property_id)
  const checkInMutation = useCheckInMutation(residentId)
  const ledger = useLedgerQuery(residentId)
  const reminders = useReminders(useOrgId())
  const reminderUrl = ledger.data && ledger.data.outstanding_paise > 0 ? ledger.data.whatsapp_url : null
  const reminded = residentId ? reminders.isRemindedToday(residentId) : false

  const [noticeOpen, setNoticeOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [moveOutOpen, setMoveOutOpen] = useState(false)
  const [correctStay, setCorrectStay] = useState<Stay | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [zoomPhoto, setZoomPhoto] = useState<{ url: string; label: string } | null>(null)

  async function handleMarkArrived(stayId: string) {
    setActionError(null)
    try {
      await checkInMutation.mutateAsync(stayId)
      showToast('Resident marked as arrived', 'success')
    } catch (err) {
      setActionError(getErrorMessage(err, 'Unable to check in resident.'))
    }
  }

  const currentStay = resident?.current_stay ?? null
  const photos = [
    resident?.selfie_url ? { url: resident.selfie_url, label: 'Live selfie' } : null,
    resident?.id_doc_url
      ? {
          url: resident.id_doc_url,
          label: `${(resident.id_doc_type && ID_DOC_LABELS[resident.id_doc_type]) || 'ID'} photo`,
        }
      : null,
  ].filter((p): p is { url: string; label: string } => p !== null)

  return (
    <div className="flex max-w-2xl flex-col gap-5 pb-8">
      <PageHeader
        back={{
          to: isOwner && resident?.property_id ? `/owner/properties/${resident.property_id}/beds` : bedsPath,
          label: 'Bed board',
        }}
        title={resident ? resident.full_name : 'Resident'}
        description={
          resident ? (
            <span className="tabular-nums">
              {propertyQuery.data?.name ? `${propertyQuery.data.name} · ` : ''}
              {resident.phone}
            </span>
          ) : undefined
        }
        actions={
          resident && (
            <>
              <Button asChild variant="secondary">
                <Link to={`${isOwner ? '/owner' : '/caretaker'}/residents/${resident.id}/ledger`}>Payment history</Link>
              </Button>
              <Button asChild variant="secondary">
                <a href={`tel:${resident.phone}`}>
                  <Phone aria-hidden="true" />
                  Call
                </a>
              </Button>
              {reminderUrl && residentId && (
                <Button type="button" variant="secondary" onClick={() => reminders.send(residentId, reminderUrl)}>
                  {reminded ? <Check aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
                  {reminded ? 'Reminded today' : 'Send reminder'}
                </Button>
              )}
              <Button asChild variant="secondary">
                <a href={buildWhatsappUrl(resident.phone)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" />
                  WhatsApp
                </a>
              </Button>
            </>
          )
        }
      />

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading resident details…" rows={5} />
        </Card>
      )}

      {query.isError && (
        <Notice role="alert">{getErrorMessage(query.error, 'Unable to load resident.')}</Notice>
      )}

      {resident && (
        <>
          {actionError && <Notice role="alert">{actionError}</Notice>}

          <Card aria-label="Current stay">
            <CardHeader
              title="Current stay"
              action={currentStay ? stayStatusBadge(currentStay.status) : undefined}
            />
            {!currentStay ? (
              <EmptyState>No active stay.</EmptyState>
            ) : (
              <CardBody className="flex flex-col gap-4">
                <dl className="divide-y divide-line">
                  <DetailRow
                    label="Bed"
                    value={
                      <span className="font-semibold tabular-nums">
                        Room {currentStay.room_label} · {currentStay.bed_label}
                      </span>
                    }
                  />
                  <DetailRow
                    label="Stay type"
                    value={currentStay.stay_type === 'short_term' ? 'Short stay' : 'Monthly'}
                  />
                  <DetailRow
                    label={currentStay.stay_type === 'short_term' ? 'Daily rate' : 'Monthly rent'}
                    value={<Money paise={currentStay.rent_paise} />}
                  />
                  <DetailRow label="Deposit" value={<Money paise={currentStay.deposit_paise} />} />
                  <DetailRow label="Check-in" value={<DateText value={currentStay.check_in_date} />} />
                  {currentStay.notice_given_on && (
                    <DetailRow
                      label="Notice given"
                      value={<DateText value={currentStay.notice_given_on} />}
                    />
                  )}
                  {currentStay.expected_vacate_date && (
                    <DetailRow
                      label={currentStay.stay_type === 'short_term' ? 'Expected check-out' : 'Last day'}
                      value={<DateText value={currentStay.expected_vacate_date} />}
                    />
                  )}
                </dl>

                <div className="flex flex-wrap gap-2 pt-1">
                  {currentStay.status === 'reserved' && (
                    <Button
                      type="button"
                      variant="brand"
                      disabled={checkInMutation.isPending}
                      onClick={() => void handleMarkArrived(currentStay.id)}
                    >
                      {checkInMutation.isPending ? 'Marking arrived…' : 'Mark arrived'}
                    </Button>
                  )}

                  {currentStay.status === 'active' && currentStay.stay_type === 'monthly' && (
                    <Button type="button" variant="secondary" onClick={() => setNoticeOpen(true)}>
                      Give notice
                    </Button>
                  )}

                  {currentStay.status === 'on_notice' && (
                    <Button type="button" variant="secondary" onClick={() => setWithdrawOpen(true)}>
                      Withdraw notice
                    </Button>
                  )}

                  <Button type="button" variant="danger" onClick={() => setMoveOutOpen(true)}>
                    Move out today
                  </Button>

                  {isOwner && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCorrectStay(currentStay)}
                    >
                      Correct dates
                    </Button>
                  )}
                </div>
              </CardBody>
            )}
          </Card>

          {photos.length > 0 && (
            <section aria-label="ID photos" className="grid grid-cols-2 gap-3">
              {photos.map((photo) => (
                <button
                  key={photo.label}
                  type="button"
                  onClick={() => setZoomPhoto(photo)}
                  className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface text-left shadow-sm transition-colors hover:bg-surface-2"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
                    <img src={photo.url} alt={photo.label} className="h-full w-full object-cover" />
                    <span className="absolute right-2 bottom-2 inline-flex size-8 items-center justify-center rounded-full bg-surface/90 text-ink shadow-xs">
                      <ZoomIn className="size-4" aria-hidden="true" />
                    </span>
                  </div>
                  <span className="px-3 py-2 text-[12.5px] font-medium text-ink">{photo.label}</span>
                </button>
              ))}
            </section>
          )}

          <Card aria-label="Resident details">
            <CardHeader
              title="Resident details"
              action={
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingProfile(true)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              }
            />
            <CardBody className="py-1">
              <dl className="divide-y divide-line">
                <DetailRow label="Phone" value={<span className="tabular-nums">{resident.phone}</span>} />
                {resident.email && <DetailRow label="Email" value={resident.email} />}
                {resident.date_of_birth && (
                  <DetailRow label="Date of birth" value={<DateText value={resident.date_of_birth} />} />
                )}
                {resident.permanent_address && (
                  <DetailRow label="Permanent address" value={resident.permanent_address} />
                )}
                {resident.occupation && (
                  <DetailRow
                    label="Occupation"
                    value={OCCUPATION_LABELS[resident.occupation] ?? resident.occupation}
                  />
                )}
                {resident.employer_or_college && (
                  <DetailRow label="Employer / College" value={resident.employer_or_college} />
                )}
                {resident.emergency_contact_name && (
                  <DetailRow
                    label="Emergency contact"
                    value={
                      resident.emergency_contact_relation
                        ? `${resident.emergency_contact_name} (${resident.emergency_contact_relation})`
                        : resident.emergency_contact_name
                    }
                  />
                )}
                {resident.emergency_contact_phone && (
                  <DetailRow
                    label="Emergency phone"
                    value={<span className="tabular-nums">{resident.emergency_contact_phone}</span>}
                  />
                )}
                {resident.id_doc_type && (
                  <DetailRow
                    label="ID document"
                    value={`${ID_DOC_LABELS[resident.id_doc_type] ?? resident.id_doc_type}${resident.id_doc_number ? ` · ${resident.id_doc_number}` : ''}`}
                  />
                )}
                {resident.is_foreign_national && (
                  <>
                    <DetailRow label="Passport number" value={resident.passport_number ?? '—'} />
                    <DetailRow label="Visa number" value={resident.visa_number ?? '—'} />
                    {resident.visa_expiry && (
                      <DetailRow label="Visa expiry" value={<DateText value={resident.visa_expiry} />} />
                    )}
                  </>
                )}
                {resident.food_preference && (
                  <DetailRow
                    label="Food preference"
                    value={FOOD_LABELS[resident.food_preference] ?? resident.food_preference}
                  />
                )}
                {resident.vehicle_number && (
                  <DetailRow label="Vehicle number" value={resident.vehicle_number} />
                )}
                <DetailRow
                  label="Police verification"
                  value={
                    <span>
                      {POLICE_LABELS[resident.police_verification_status] ?? resident.police_verification_status}
                      {resident.police_verification_date && (
                        <>
                          {' · '}
                          <DateText value={resident.police_verification_date} />
                        </>
                      )}
                    </span>
                  }
                />
              </dl>
            </CardBody>
          </Card>

          <ProfileEditSheet resident={resident} open={editingProfile} onClose={() => setEditingProfile(false)} />

          <Card aria-label="Stay history">
            <CardHeader title="Stay history" />
            {resident.past_stays.length === 0 ? (
              <EmptyState>No past stays.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {resident.past_stays.map((stay) => (
                  <li key={stay.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[14.5px] font-semibold text-ink tabular-nums">
                        Room {stay.room_label} · {stay.bed_label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-ink">
                          <Money paise={stay.rent_paise} />
                        </span>
                        {stayStatusBadge(stay.status)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                      <span>
                        <DateText value={stay.check_in_date} />
                        {' → '}
                        {stay.actual_vacate_date ? <DateText value={stay.actual_vacate_date} /> : '—'}
                      </span>
                      <div className="flex items-center gap-2">
                        {stay.status === 'vacated' && (
                          <Button asChild variant="secondary" size="sm">
                            <Link
                              to={`${isOwner ? '/owner' : '/caretaker'}/residents/${resident.id}/settlement/${stay.id}`}
                            >
                              {isOwner ? 'Return deposit' : 'Move-out bill'}
                            </Link>
                          </Button>
                        )}
                        {isOwner && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setCorrectStay(stay)}
                          >
                            Correct dates
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {currentStay && (
            <>
              <GiveNoticeSheet
                key={`notice-${currentStay.id}-${noticeOpen}`}
                open={noticeOpen}
                onClose={() => setNoticeOpen(false)}
                stay={currentStay}
                residentId={resident.id}
                deadlineDay={propertyQuery.data?.notice_deadline_day}
                isOwner={isOwner}
                isPropertyLoading={propertyQuery.isLoading}
              />
              <WithdrawNoticeSheet
                key={`withdraw-${currentStay.id}-${withdrawOpen}`}
                open={withdrawOpen}
                onClose={() => setWithdrawOpen(false)}
                stay={currentStay}
                residentId={resident.id}
              />
              <MoveOutSheet
                key={`moveout-${currentStay.id}-${moveOutOpen}`}
                open={moveOutOpen}
                onClose={() => setMoveOutOpen(false)}
                stay={currentStay}
                residentId={resident.id}
                isOwner={isOwner}
              />
            </>
          )}

          {correctStay && isOwner && (
            <CorrectDatesSheet
              key={`correct-${correctStay.id}-${correctStay.updated_at}`}
              open
              onClose={() => setCorrectStay(null)}
              stay={correctStay}
              residentId={resident.id}
            />
          )}

          {zoomPhoto && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={zoomPhoto.label}
              className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-overlay p-4"
              onClick={() => setZoomPhoto(null)}
            >
              <div className="mb-3 flex w-full max-w-lg items-center justify-between text-on-ink">
                <span className="text-[14px] font-semibold text-white">{zoomPhoto.label}</span>
                <button
                  type="button"
                  aria-label="Close photo"
                  onClick={() => setZoomPhoto(null)}
                  className="inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <img
                src={zoomPhoto.url}
                alt={zoomPhoto.label}
                className="max-h-[80dvh] max-w-full rounded-card object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
