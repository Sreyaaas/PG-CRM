import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Label, control, hint and error. The error renders inside the same wrapper as the control,
 * with role="alert" so screen readers announce it.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12.5px] text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-danger-ink">
          {error}
        </p>
      )}
    </div>
  )
}

/** A group of fields with a small heading, used for sections inside a form. */
export function FieldGroup({
  legend,
  children,
  className,
}: {
  legend: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4', className)}>
      <legend className="px-1 text-[13px] font-semibold text-ink">{legend}</legend>
      {children}
    </fieldset>
  )
}
