import { useState } from 'react'
import { X, ZoomIn } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'
import { LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { ApproveSheet } from './ApproveSheet'
import { getErrorMessage, useCheckinDetail, useRejectCheckin } from './useCheckins'

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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[12.5px] font-medium text-muted">{label}</dt>
      <dd className="text-[14px] text-ink sm:text-right">{value}</dd>
    </div>
  )
}

export function CheckInDetailPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const listPath = pathname.startsWith('/owner') ? '/owner/check-ins' : '/caretaker/check-ins'
  const query = useCheckinDetail(requestId)
  const rejectMutation = useRejectCheckin(requestId ?? '')

  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [zoomPhoto, setZoomPhoto] = useState<{ url: string; label: string } | null>(null)

  const detail = query.data

  async function handleConfirmReject() {
    setRejectError(null)
    const note = rejectNote.trim()
    if (!note) {
      setRejectError('Please enter a reason for rejecting.')
      return
    }
    try {
      await rejectMutation.mutateAsync(note)
      showToast('Check-in rejected', 'default')
      navigate(listPath, { replace: true })
    } catch (err) {
      setRejectError(getErrorMessage(err, 'Unable to reject check-in.'))
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PageHeader
        back={{ to: listPath, label: 'Check-ins' }}
        title={detail ? detail.full_name : 'Check-in request'}
        description={detail ? `${detail.property_name} · ${detail.phone}` : undefined}
      />

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading check-in details…" rows={5} />
        </Card>
      )}

      {query.isError && (
        <Notice role="alert">{getErrorMessage(query.error, 'Unable to load check-in request.')}</Notice>
      )}

      {detail && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {detail.is_foreign_national && <Badge tone="warning">Foreign national</Badge>}
            {detail.status !== 'pending' && (
              <Badge tone={detail.status === 'approved' ? 'success' : 'danger'}>
                {detail.status === 'approved' ? 'Approved' : 'Rejected'}
              </Badge>
            )}
          </div>

          <section aria-label="Submitted photos" className="grid grid-cols-2 gap-3">
            {[
              { url: detail.selfie_url, label: 'Live selfie' },
              { url: detail.id_doc_url, label: `${ID_DOC_LABELS[detail.id_doc_type] ?? detail.id_doc_type} photo` },
            ].map((photo) => (
              <button
                key={photo.label}
                type="button"
                onClick={() => setZoomPhoto(photo)}
                className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface text-left shadow-sm transition-colors hover:bg-surface-2"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
                  <img
                    src={photo.url}
                    alt={photo.label}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute right-2 bottom-2 inline-flex size-8 items-center justify-center rounded-full bg-surface/90 text-ink shadow-xs">
                    <ZoomIn className="size-4" aria-hidden="true" />
                  </span>
                </div>
                <span className="px-3 py-2 text-[12.5px] font-medium text-ink">{photo.label}</span>
              </button>
            ))}
          </section>

          <Card>
            <CardHeader title="Resident details" />
            <CardBody className="py-1">
              <dl className="divide-y divide-line">
                <DetailRow label="Full name" value={detail.full_name} />
                <DetailRow label="Phone" value={<span className="tabular-nums">{detail.phone}</span>} />
                {detail.email && <DetailRow label="Email" value={detail.email} />}
                {detail.date_of_birth && (
                  <DetailRow label="Date of birth" value={<DateText value={detail.date_of_birth} />} />
                )}
                <DetailRow label="Permanent address" value={detail.permanent_address} />
                <DetailRow
                  label="Occupation"
                  value={OCCUPATION_LABELS[detail.occupation] ?? detail.occupation}
                />
                {detail.employer_or_college && (
                  <DetailRow label="Employer / College" value={detail.employer_or_college} />
                )}
                <DetailRow label="Emergency contact" value={detail.emergency_contact_name} />
                <DetailRow
                  label="Emergency phone"
                  value={<span className="tabular-nums">{detail.emergency_contact_phone}</span>}
                />
                <DetailRow
                  label="ID document"
                  value={`${ID_DOC_LABELS[detail.id_doc_type] ?? detail.id_doc_type} · ${detail.id_doc_number}`}
                />
                {detail.is_foreign_national && (
                  <>
                    <DetailRow label="Passport number" value={detail.passport_number ?? '—'} />
                    <DetailRow label="Visa number" value={detail.visa_number ?? '—'} />
                    {detail.visa_expiry && (
                      <DetailRow label="Visa expiry" value={<DateText value={detail.visa_expiry} />} />
                    )}
                  </>
                )}
                <DetailRow
                  label="Accepted exit deduction"
                  value={<Money paise={detail.accepted_exit_deduction_paise} />}
                />
                <DetailRow label="Submitted" value={<DateText value={detail.created_at} />} />
              </dl>
            </CardBody>
          </Card>

          {detail.status === 'pending' && (
            <div className="flex flex-col gap-3">
              {rejectOpen ? (
                <Card>
                  <CardHeader title="Reject check-in" />
                  <CardBody className="flex flex-col gap-3">
                    {rejectError && <Notice role="alert">{rejectError}</Notice>}
                    <Field id="reject-note" label="Reason / note">
                      <Textarea
                        id="reject-note"
                        rows={2}
                        placeholder="e.g. Blurry ID photo, please re-submit"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={rejectMutation.isPending}
                        onClick={() => {
                          setRejectOpen(false)
                          setRejectError(null)
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={rejectMutation.isPending}
                        onClick={() => void handleConfirmReject()}
                      >
                        {rejectMutation.isPending ? 'Rejecting…' : 'Confirm reject'}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              ) : (
                <div className="flex flex-col gap-2.5 sm:flex-row-reverse">
                  <Button
                    type="button"
                    variant="brand"
                    size="lg"
                    className="w-full sm:flex-1"
                    onClick={() => setApproveOpen(true)}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={() => setRejectOpen(true)}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          )}

          <ApproveSheet
            open={approveOpen}
            onClose={() => setApproveOpen(false)}
            detail={detail}
            onApproved={() => navigate(listPath, { replace: true })}
          />

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
