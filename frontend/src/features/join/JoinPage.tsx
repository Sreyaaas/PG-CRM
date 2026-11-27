import { useEffect, useState, type ChangeEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Camera, CheckCircle2, Upload } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { LoadingRows, Notice } from '@/components/ui/misc'
import { requestPublicUpload, submitOnboarding, uploadToPresignedUrl, useJoinInfoQuery } from './api'
import { compressImage } from './imageCompress'
import {
  buildSubmitPayload,
  clearJoinDraft,
  ID_DOC_OPTIONS,
  JOIN_STEPS,
  loadJoinDraft,
  OCCUPATION_OPTIONS,
  ordinal,
  saveJoinDraft,
  validateStep,
  type JoinFormState,
  type JoinStep,
} from './joinForm'

type UploadKind = 'kyc_id' | 'selfie'

export function JoinPage() {
  const { slug = '' } = useParams()
  return <JoinFlow key={slug} slug={slug} />
}

function JoinFlow({ slug }: { slug: string }) {
  const infoQuery = useJoinInfoQuery(slug)
  const [form, setForm] = useState<JoinFormState>(() => loadJoinDraft(slug))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Record<UploadKind, boolean>>({
    kyc_id: false,
    selfie: false,
  })
  const [uploadErrors, setUploadErrors] = useState<Record<UploadKind, string | null>>({
    kyc_id: null,
    selfie: null,
  })

  useEffect(() => {
    if (!slug || submittedRequestId) return
    saveJoinDraft(slug, form)
  }, [slug, form, submittedRequestId])

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!infoQuery.data) throw new Error('Property details not loaded')
      const payload = buildSubmitPayload(form, infoQuery.data.exit_deduction_paise)
      return submitOnboarding(slug, payload)
    },
    onSuccess: (res) => {
      clearJoinDraft(slug)
      setSubmitError(null)
      setSubmittedRequestId(res.request_id)
    },
    onError: (err) => {
      setSubmitError(err instanceof ApiError ? err.message : 'Unable to submit. Please try again.')
    },
  })

  function updateField<K extends keyof JoinFormState>(key: K, value: JoinFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handlePhotoChange(kind: UploadKind, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !slug) return

    setUploadErrors((prev) => ({ ...prev, [kind]: null }))
    setUploading((prev) => ({ ...prev, [kind]: true }))

    try {
      const compressed = await compressImage(file)
      const ticket = await requestPublicUpload(slug, {
        kind,
        content_type: compressed.contentType,
        size_bytes: compressed.sizeBytes,
      })
      await uploadToPresignedUrl(ticket.upload_url, compressed.blob, compressed.contentType)
      updateField(kind === 'kyc_id' ? 'id_doc_path' : 'selfie_path', ticket.object_key)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Upload failed. Please try again.'
      setUploadErrors((prev) => ({ ...prev, [kind]: msg }))
    } finally {
      setUploading((prev) => ({ ...prev, [kind]: false }))
    }
  }

  function handleNext() {
    const stepErrors = validateStep(form.step, form)
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors)
      return
    }
    setErrors({})
    setSubmitError(null)
    const nextStep = Math.min(JOIN_STEPS.length - 1, form.step + 1) as JoinStep
    updateField('step', nextStep)
    if (!navigator.userAgent.includes('jsdom')) {
      window.scrollTo?.({ top: 0, behavior: 'smooth' })
    }
  }

  function handleBack() {
    setErrors({})
    setSubmitError(null)
    const prevStep = Math.max(0, form.step - 1) as JoinStep
    updateField('step', prevStep)
  }

  function handleSubmit() {
    const stepErrors = validateStep(3, form)
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors)
      return
    }
    setErrors({})
    setSubmitError(null)
    submitMutation.mutate()
  }

  if (infoQuery.isLoading) {
    return (
      <main className="min-h-dvh bg-page px-4 py-6">
        <div className="mx-auto max-w-lg">
          <Card>
            <LoadingRows label="Loading property details…" />
          </Card>
        </div>
      </main>
    )
  }

  if (infoQuery.isError || !infoQuery.data) {
    const isNotFound = infoQuery.error instanceof ApiError && infoQuery.error.status === 404
    return (
      <main className="min-h-dvh bg-page px-4 py-8">
        <div className="mx-auto max-w-lg">
          <Card>
            <CardBody className="flex flex-col gap-3 py-8 text-center">
              <h1 className="text-[18px] font-semibold text-ink">
                {isNotFound
                  ? 'This QR code is not active. Please ask the reception.'
                  : 'Unable to load check-in form'}
              </h1>
              {!isNotFound && infoQuery.error instanceof ApiError && (
                <p className="text-[14px] text-muted">{infoQuery.error.message}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </main>
    )
  }

  const info = infoQuery.data

  if (submittedRequestId) {
    const shortId = submittedRequestId.slice(0, 8)
    return (
      <main className="min-h-dvh bg-page px-4 py-8">
        <div className="mx-auto max-w-lg">
          <Card>
            <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-ink">
                <CheckCircle2 aria-hidden="true" className="size-7" />
              </div>
              <div className="flex flex-col gap-1">
                <h1 className="text-[20px] font-bold text-ink">
                  Done! Show this screen to the caretaker.
                </h1>
                <p className="text-[14px] text-muted">
                  {info.property_name} · {info.organization_name}
                </p>
              </div>
              <div className="w-full rounded-control border border-line bg-surface-2 px-4 py-3">
                <p className="text-[12px] font-medium uppercase tracking-wider text-muted">
                  Request ID
                </p>
                <p
                  data-testid="request-id"
                  className="mt-1 font-mono text-[22px] font-bold tracking-wider text-ink tabular-nums"
                >
                  {shortId}
                </p>
              </div>
              <Button asChild variant="secondary" block>
                <Link to="/">Back to app</Link>
              </Button>
            </CardBody>
          </Card>
        </div>
      </main>
    )
  }

  const currentStep = JOIN_STEPS[form.step]
  const progressPct = Math.round(((form.step + 1) / JOIN_STEPS.length) * 100)

  return (
    <main className="min-h-dvh bg-page px-4 py-6">
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-[12.5px] font-medium text-muted">{info.organization_name}</p>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">
            {info.property_name}
          </h1>
          {info.locality && <p className="text-[13.5px] text-muted">{info.locality}</p>}
        </header>

        <div aria-label="Form progress" className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[13px] font-medium text-muted">
            <span>
              Step {form.step + 1} of {JOIN_STEPS.length}: {currentStep.title}
            </span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <Card>
          <CardHeader title={currentStep.title} />
          <CardBody className="flex flex-col gap-4">
            {form.step === 0 && (
              <>
                <Field id="join-full-name" label="Full name *" error={errors.full_name}>
                  <Input
                    id="join-full-name"
                    autoComplete="name"
                    value={form.full_name}
                    aria-invalid={Boolean(errors.full_name)}
                    onChange={(e) => updateField('full_name', e.target.value)}
                  />
                </Field>

                <Field
                  id="join-phone"
                  label="Mobile number *"
                  hint="10 digits, starting with 6–9"
                  error={errors.phone}
                >
                  <Input
                    id="join-phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    autoComplete="tel-national"
                    value={form.phone}
                    aria-invalid={Boolean(errors.phone)}
                    onChange={(e) => updateField('phone', e.target.value)}
                  />
                </Field>

                <Field id="join-email" label="Email" error={errors.email}>
                  <Input
                    id="join-email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    aria-invalid={Boolean(errors.email)}
                    onChange={(e) => updateField('email', e.target.value)}
                  />
                </Field>

                <Field id="join-dob" label="Date of birth" error={errors.date_of_birth}>
                  <Input
                    id="join-dob"
                    type="date"
                    autoComplete="bday"
                    value={form.date_of_birth}
                    onChange={(e) => updateField('date_of_birth', e.target.value)}
                  />
                </Field>

                <Field
                  id="join-address"
                  label="Permanent address *"
                  error={errors.permanent_address}
                >
                  <Textarea
                    id="join-address"
                    autoComplete="street-address"
                    value={form.permanent_address}
                    aria-invalid={Boolean(errors.permanent_address)}
                    onChange={(e) => updateField('permanent_address', e.target.value)}
                  />
                </Field>

                <Field id="join-occupation" label="Occupation *" error={errors.occupation}>
                  <Select
                    id="join-occupation"
                    value={form.occupation}
                    onChange={(e) =>
                      updateField('occupation', e.target.value as JoinFormState['occupation'])
                    }
                  >
                    {OCCUPATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field id="join-employer" label="Company or college">
                  <Input
                    id="join-employer"
                    value={form.employer_or_college}
                    onChange={(e) => updateField('employer_or_college', e.target.value)}
                  />
                </Field>
              </>
            )}

            {form.step === 1 && (
              <>
                <Field
                  id="join-emergency-name"
                  label="Emergency contact name *"
                  error={errors.emergency_contact_name}
                >
                  <Input
                    id="join-emergency-name"
                    value={form.emergency_contact_name}
                    aria-invalid={Boolean(errors.emergency_contact_name)}
                    onChange={(e) => updateField('emergency_contact_name', e.target.value)}
                  />
                </Field>

                <Field
                  id="join-emergency-phone"
                  label="Emergency contact phone *"
                  error={errors.emergency_contact_phone}
                >
                  <Input
                    id="join-emergency-phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={15}
                    value={form.emergency_contact_phone}
                    aria-invalid={Boolean(errors.emergency_contact_phone)}
                    onChange={(e) => updateField('emergency_contact_phone', e.target.value)}
                  />
                </Field>
              </>
            )}

            {form.step === 2 && (
              <>
                <Field id="join-id-type" label="ID type *" error={errors.id_doc_type}>
                  <Select
                    id="join-id-type"
                    value={form.id_doc_type}
                    onChange={(e) =>
                      updateField('id_doc_type', e.target.value as JoinFormState['id_doc_type'])
                    }
                  >
                    {ID_DOC_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field id="join-id-number" label="ID number *" error={errors.id_doc_number}>
                  <Input
                    id="join-id-number"
                    value={form.id_doc_number}
                    aria-invalid={Boolean(errors.id_doc_number)}
                    onChange={(e) => updateField('id_doc_number', e.target.value)}
                  />
                </Field>

                <Field
                  id="join-id-photo"
                  label="Photo of ID *"
                  hint="Take a clear photo or choose from your gallery"
                  error={uploadErrors.kyc_id || errors.id_doc_path}
                >
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="join-id-photo"
                      className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink shadow-xs hover:bg-surface-2"
                    >
                      <Upload aria-hidden="true" className="size-4" />
                      <span>
                        {uploading.kyc_id
                          ? 'Uploading ID photo…'
                          : form.id_doc_path
                            ? 'ID photo uploaded (tap to replace)'
                            : 'Upload ID photo'}
                      </span>
                    </label>
                    <input
                      id="join-id-photo"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={uploading.kyc_id}
                      onChange={(e) => void handlePhotoChange('kyc_id', e)}
                    />
                  </div>
                </Field>

                <Field
                  id="join-selfie"
                  label="Live selfie *"
                  hint="Camera only — take a live photo of your face"
                  error={uploadErrors.selfie || errors.selfie_path}
                >
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="join-selfie"
                      className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink shadow-xs hover:bg-surface-2"
                    >
                      <Camera aria-hidden="true" className="size-4" />
                      <span>
                        {uploading.selfie
                          ? 'Uploading selfie…'
                          : form.selfie_path
                            ? 'Live selfie uploaded (tap to retake)'
                            : 'Take live selfie'}
                      </span>
                    </label>
                    <input
                      id="join-selfie"
                      type="file"
                      accept="image/*"
                      capture="user"
                      className="sr-only"
                      disabled={uploading.selfie}
                      onChange={(e) => void handlePhotoChange('selfie', e)}
                    />
                  </div>
                </Field>

                <div className="border-t border-line pt-2">
                  <Checkbox
                    id="join-foreign-national"
                    label="Foreign national?"
                    checked={form.is_foreign_national}
                    onChange={(e) => updateField('is_foreign_national', e.target.checked)}
                  />
                </div>

                {form.is_foreign_national && (
                  <div className="flex flex-col gap-4 rounded-control border border-line bg-surface-2 p-3">
                    <Field
                      id="join-passport-number"
                      label="Passport number *"
                      error={errors.passport_number}
                    >
                      <Input
                        id="join-passport-number"
                        value={form.passport_number}
                        aria-invalid={Boolean(errors.passport_number)}
                        onChange={(e) => updateField('passport_number', e.target.value)}
                      />
                    </Field>

                    <Field id="join-visa-number" label="Visa number *" error={errors.visa_number}>
                      <Input
                        id="join-visa-number"
                        value={form.visa_number}
                        aria-invalid={Boolean(errors.visa_number)}
                        onChange={(e) => updateField('visa_number', e.target.value)}
                      />
                    </Field>

                    <Field id="join-visa-expiry" label="Visa expiry *" error={errors.visa_expiry}>
                      <Input
                        id="join-visa-expiry"
                        type="date"
                        value={form.visa_expiry}
                        aria-invalid={Boolean(errors.visa_expiry)}
                        onChange={(e) => updateField('visa_expiry', e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </>
            )}

            {form.step === 3 && (
              <>
                <dl className="divide-y divide-line rounded-control border border-line bg-surface-2 px-3">
                  <div className="flex items-center justify-between gap-4 py-2.5 text-[14px]">
                    <dt className="text-muted">Security deposit (refundable)</dt>
                    <dd className="font-semibold text-ink">
                      <Money paise={info.security_deposit_paise} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5 text-[14px]">
                    <dt className="text-muted">Maintenance charge (one-time, not refundable)</dt>
                    <dd className="font-semibold text-ink">
                      <Money paise={info.maintenance_charge_paise} />
                    </dd>
                  </div>
                  {info.short_term_daily_rate_paise != null && (
                    <div className="flex items-center justify-between gap-4 py-2.5 text-[14px]">
                      <dt className="text-muted">Daily rate (short stay)</dt>
                      <dd className="font-semibold text-ink">
                        <Money paise={info.short_term_daily_rate_paise} />
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-ink">
                  <p>
                    Rent is due by the {ordinal(info.rent_due_day)} of every month; your first month
                    is charged only for the days you stay.
                  </p>
                  <p>
                    To leave at the end of a month, tell us on or before the{' '}
                    {ordinal(info.notice_deadline_day)} of that month; otherwise you pay the next
                    month too.
                  </p>
                  <p className="font-medium">
                    <Money paise={info.exit_deduction_paise} /> will be deducted from your deposit
                    at move-out for maintenance/painting.
                  </p>
                </div>

                {info.house_rules && (
                  <div className="rounded-control border border-line bg-surface-2 p-3">
                    <h2 className="text-[13px] font-semibold text-ink">House rules</h2>
                    <p className="mt-1 whitespace-pre-line text-[13.5px] text-muted">
                      {info.house_rules}
                    </p>
                  </div>
                )}

                <Field id="join-accept-rules" label="" error={errors.accepted_rules}>
                  <Checkbox
                    id="join-accept-rules"
                    label="I accept the house rules and this exit deduction"
                    checked={form.accepted_rules}
                    onChange={(e) => updateField('accepted_rules', e.target.checked)}
                  />
                </Field>
              </>
            )}

            {submitError && <Notice role="alert">{submitError}</Notice>}

            <div className="flex items-center justify-between gap-3 pt-2">
              {form.step > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleBack}
                  disabled={submitMutation.isPending}
                >
                  Back
                </Button>
              ) : (
                <span />
              )}

              {form.step < JOIN_STEPS.length - 1 ? (
                <Button
                  type="button"
                  variant="brand"
                  onClick={handleNext}
                  disabled={uploading.kyc_id || uploading.selfie}
                >
                  Next
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="brand"
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending ? 'Submitting…' : 'Submit'}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </main>
  )
}
