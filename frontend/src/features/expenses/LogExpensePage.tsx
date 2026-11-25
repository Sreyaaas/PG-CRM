import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Brush,
  Building2,
  Camera,
  Droplets,
  Ellipsis,
  Flame,
  Image as ImageIcon,
  MapPin,
  ShieldCheck,
  ShoppingBasket,
  Users,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/badge'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input, MoneyInput, Select, Textarea } from '@/components/ui/input'
import { Notice, PageHeader } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { compressImage } from '@/features/join/imageCompress'
import { usePropertiesQuery } from '@/features/properties/api'
import { formatINR, parseRupeesToPaise } from '@/lib/money'
import { cn } from '@/lib/utils'
import { isNetworkError } from '@/offline/retryQueue'
import { retryQueue } from '@/offline/transport'
import { uploadExpenseProof, useCreateExpense, type ExpenseCategory, type ExpenseCreate } from './api'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  LOCATION_REQUIRED,
  expenseSchema,
  istDate,
  type ExpenseFormValues,
} from './expenseForm'

const CATEGORY_ICONS: Record<ExpenseCategory, ReactNode> = {
  water_tanker: <Droplets />,
  electricity_bescom: <Zap />,
  groceries: <ShoppingBasket />,
  gas_lpg: <Flame />,
  maintenance_repairs: <Wrench />,
  cleaning: <Brush />,
  internet: <Wifi />,
  staff_salary: <Users />,
  security: <ShieldCheck />,
  lease_rent: <Building2 />,
  other: <Ellipsis />,
}

interface Coords {
  lat: number
  lng: number
}

function getLocation(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      reject(new Error('unsupported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  })
}

/** Remembers the Idempotency-Key per exact request body so a retry reuses it and an edit gets a fresh one. */
function useIdempotencyKey() {
  const ref = useRef<{ signature: string; key: string } | null>(null)
  return (signature: string) => {
    if (!ref.current || ref.current.signature !== signature) {
      ref.current = { signature, key: crypto.randomUUID() }
    }
    return ref.current.key
  }
}

export function LogExpensePage() {
  const { membership } = useAuth()
  const isOwner = membership?.role === 'owner'
  const orgId = membership?.org_id ?? ''
  const base = isOwner ? '/owner/expenses' : '/caretaker/expenses'
  const navigate = useNavigate()
  const { showToast } = useToast()
  const propertiesQuery = usePropertiesQuery()
  const properties = Array.isArray(propertiesQuery.data) ? propertiesQuery.data : []
  const createExpense = useCreateExpense()
  const keyFor = useIdempotencyKey()

  const [photo, setPhoto] = useState<{ file: File; capturedAt: Date; proofPath?: string } | null>(null)
  const [coords, setCoords] = useState<Coords | null>(null)
  const [locating, setLocating] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [locationError, setLocationError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      property_id: '',
      category: 'water_tanker',
      amount: '',
      quantity: '',
      unit: 'tanker',
      expense_date: istDate(),
      vendor_name: '',
      notes: '',
      bill_mode: 'has_bill',
      paid_from: isOwner ? 'owner_direct' : 'caretaker_cash',
    },
  })

  const onlyPropertyId = properties.length === 1 ? properties[0].id : ''
  useEffect(() => {
    if (onlyPropertyId) setValue('property_id', onlyPropertyId)
  }, [onlyPropertyId, setValue])

  const category = watch('category') as ExpenseCategory
  const billMode = watch('bill_mode')
  const noBill = billMode === 'no_bill'
  const categories = CATEGORY_ORDER.filter((c) => isOwner || c !== 'lease_rent')
  const minDate = isOwner ? undefined : istDate(-3)

  const locate = async () => {
    setLocating(true)
    setLocationError('')
    try {
      const c = await getLocation()
      setCoords(c)
      return c
    } catch {
      setCoords(null)
      setLocationError(LOCATION_REQUIRED)
      return null
    } finally {
      setLocating(false)
    }
  }

  const onPhoto = (file: File | undefined) => {
    if (!file) return
    setPhotoError('')
    setPhoto({ file, capturedAt: new Date() })
    // The live photo and the place it was taken belong together: ask for the location right away.
    if (noBill) void locate()
  }

  const setMode = (mode: 'has_bill' | 'no_bill') => {
    if (mode === billMode) return
    setValue('bill_mode', mode)
    // A photo from the other mode may not be allowed here (gallery vs camera): start again.
    setPhoto(null)
    setCoords(null)
    setPhotoError('')
    setLocationError('')
  }

  const onSubmit = async (values: ExpenseFormValues) => {
    const pid = values.property_id
    if (!photo) {
      setPhotoError(noBill ? 'Take a photo with the camera' : 'Add a photo of the bill')
      return
    }
    let where = coords
    if (noBill && !where) {
      where = await locate()
      if (!where) return
    }

    setSubmitting(true)
    const qty = values.category === 'water_tanker' && values.quantity ? Number(values.quantity) : null
    const draft: Omit<ExpenseCreate, 'proof_path'> = {
      property_id: pid,
      category: values.category as ExpenseCategory,
      amount_paise: parseRupeesToPaise(values.amount),
      quantity: qty,
      unit: qty ? values.unit || null : null,
      expense_date: values.expense_date,
      vendor_name: values.vendor_name || null,
      notes: values.notes || null,
      bill_mode: values.bill_mode,
      proof_captured_at: noBill ? photo.capturedAt.toISOString() : null,
      proof_lat: noBill && where ? where.lat : null,
      proof_lng: noBill && where ? where.lng : null,
      paid_from: values.paid_from,
    }
    let proofPath = photo.proofPath
    let body: ExpenseCreate | null = proofPath ? { ...draft, proof_path: proofPath } : null
    let compressed: Awaited<ReturnType<typeof compressImage>> | null = null
    try {
      if (!proofPath) {
        compressed = await compressImage(photo.file)
        proofPath = await uploadExpenseProof(orgId, pid, compressed.blob, compressed.contentType, compressed.sizeBytes)
        // Keep the uploaded key so a retry after a failed save does not upload twice.
        setPhoto((p) => (p ? { ...p, proofPath } : p))
        body = { ...draft, proof_path: proofPath }
      }
      await createExpense.mutateAsync({ body: body!, idempotencyKey: keyFor(JSON.stringify(body)) })
      showToast('Expense logged', 'success')
      navigate(base)
    } catch (caught) {
      let err: unknown = caught
      if (isNetworkError(err)) {
        // No connection: keep it on this phone. If the photo already reached storage, reuse it and the same key;
        // otherwise the queue uploads the photo first when the phone is back online.
        try {
          const label = `${values.category.replace('_', ' ')} expense ${formatINR(draft.amount_paise)}`
          const result = body
            ? await retryQueue.submit({ kind: 'expense', label, body: { ...body }, idempotencyKey: keyFor(JSON.stringify(body)) })
            : await retryQueue.submit({
                kind: 'expense',
                label,
                body: { ...draft },
                photo: await (async () => {
                  const c = compressed ?? (await compressImage(photo.file))
                  return { blob: c.blob, contentType: c.contentType, propertyId: pid }
                })(),
              })
          showToast(
            result.status === 'sent' ? 'Expense logged' : 'No connection. Saved on this phone and will sync when online.',
            result.status === 'sent' ? 'success' : 'default',
          )
          navigate(base)
          return
        } catch (queueErr) {
          err = queueErr
        }
      }
      showToast(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not save the expense', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} aria-label="Log expense" className="flex flex-col gap-5" noValidate>
      <PageHeader title="Log expense" back={{ to: base, label: 'Expenses' }} />

      {properties.length > 1 && (
        <Field id="exp-property" label="Building" error={errors.property_id?.message}>
          <Select id="exp-property" {...register('property_id')}>
            <option value="">Choose a building</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <FieldGroup legend="Category">
        <div role="radiogroup" aria-label="Category" className="grid grid-cols-3 gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => setValue('category', c, { shouldValidate: true })}
              className={cn(
                'flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-control border px-1 text-[12.5px] font-medium transition-colors active:scale-[0.98] [&_svg]:size-6',
                category === c
                  ? 'border-[color-mix(in_oklab,var(--brand)_45%,var(--line))] bg-brand-soft text-brand-ink'
                  : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
              )}
            >
              {CATEGORY_ICONS[c]}
              <span>{CATEGORY_LABELS[c]}</span>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup legend="Details">
        <Field id="exp-amount" label="Amount" error={errors.amount?.message}>
          <MoneyInput id="exp-amount" inputMode="decimal" placeholder="0" {...register('amount')} />
        </Field>

        {category === 'water_tanker' && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="exp-qty" label="Quantity" error={errors.quantity?.message}>
              <Input id="exp-qty" inputMode="decimal" placeholder="3" className="tabular-nums" {...register('quantity')} />
            </Field>
            <Field id="exp-unit" label="Unit" error={errors.unit?.message}>
              <Input id="exp-unit" {...register('unit')} />
            </Field>
          </div>
        )}

        <Field
          id="exp-date"
          label="Date"
          hint={isOwner ? undefined : 'Today or up to 3 days ago'}
          error={errors.expense_date?.message}
        >
          <Input id="exp-date" type="date" min={minDate} max={istDate()} className="tabular-nums" {...register('expense_date')} />
        </Field>

        {isOwner && (
          <Field id="exp-paid" label="Paid from">
            <Select id="exp-paid" {...register('paid_from')}>
              <option value="owner_direct">Paid by owner</option>
              <option value="caretaker_cash">Caretaker cash</option>
            </Select>
          </Field>
        )}

        <Field id="exp-vendor" label="Vendor (optional)" error={errors.vendor_name?.message}>
          <Input id="exp-vendor" autoComplete="off" {...register('vendor_name')} />
        </Field>

        <Field
          id="exp-notes"
          label={noBill ? 'Note (required)' : 'Notes (optional)'}
          hint={noBill ? 'Say what was bought and why there is no bill' : undefined}
          error={errors.notes?.message}
        >
          <Textarea id="exp-notes" rows={3} {...register('notes')} />
        </Field>
      </FieldGroup>

      <FieldGroup legend="Bill">
        <div role="group" aria-label="Bill" className="grid grid-cols-2 gap-2">
          <Chip pressed={!noBill} className="justify-center" onClick={() => setMode('has_bill')}>
            Has bill
          </Chip>
          <Chip pressed={noBill} className="justify-center" onClick={() => setMode('no_bill')}>
            No bill
          </Chip>
        </div>

        {noBill ? (
          <div className="flex flex-col gap-3">
            <Notice tone="warning">
              Without a bill, take a live photo now. The place and time are saved and the owner reviews it.
            </Notice>
            <Field id="exp-photo-camera" label="Photo (camera only)" error={photoError}>
              <label
                htmlFor="exp-photo-camera"
                className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink shadow-xs hover:bg-surface-2"
              >
                <Camera aria-hidden="true" className="size-4" />
                {photo ? 'Retake photo' : 'Take photo'}
              </label>
              <input
                id="exp-photo-camera"
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => onPhoto(e.target.files?.[0])}
              />
            </Field>
            {photo && <p className="text-[12.5px] text-muted">Photo taken: {photo.file.name}</p>}
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted [&_svg]:size-3.5" role="status">
              <MapPin aria-hidden="true" />
              {locating
                ? 'Getting location…'
                : coords
                  ? 'Location captured'
                  : 'Location is saved when you take the photo'}
            </p>
            {locationError && (
              <p role="alert" className="text-[12.5px] font-medium text-danger-ink">
                {locationError}
              </p>
            )}
          </div>
        ) : (
          <Field id="exp-photo-bill" label="Photo of the bill" hint="Camera or gallery" error={photoError}>
            <label
              htmlFor="exp-photo-bill"
              className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink shadow-xs hover:bg-surface-2"
            >
              <ImageIcon aria-hidden="true" className="size-4" />
              {photo ? 'Change photo' : 'Add photo'}
            </label>
            <input
              id="exp-photo-bill"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => onPhoto(e.target.files?.[0])}
            />
            {photo && <p className="text-[12.5px] text-muted">{photo.file.name}</p>}
          </Field>
        )}
      </FieldGroup>

      <Button type="submit" size="lg" block disabled={submitting}>
        {submitting ? 'Saving…' : 'Save expense'}
      </Button>
    </form>
  )
}
