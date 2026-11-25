import * as React from 'react'
import { cn } from '@/lib/utils'

const CONTROL = [
  'w-full min-w-0 rounded-control border border-line-strong bg-surface text-[16px] text-ink shadow-xs',
  'placeholder:text-subtle transition-[border-color,box-shadow] duration-100',
  'hover:border-[color-mix(in_oklab,var(--ink)_28%,var(--line))]',
  'focus:border-brand focus:outline-none focus:ring-3 focus:ring-[color-mix(in_oklab,var(--brand)_28%,transparent)]',
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
  'aria-invalid:border-danger',
].join(' ')

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-11 px-3', className)} {...props} />
})

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(CONTROL, 'min-h-20 resize-y px-3 py-2.5 leading-normal', className)}
        {...props}
      />
    )
  },
)

export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(CONTROL, 'h-11 appearance-none pl-3 pr-10', className)} {...props}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  )
})

/**
 * Input with a leading ₹ sign. Keeps inputMode="numeric" (asserted by the FE-10/FE-11 tests);
 * callers may pass inputMode="decimal" where paise matter.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function MoneyInput({ className, ...props }, ref) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[16px] text-muted">
          ₹
        </span>
        <Input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="next"
          className={cn('pl-7 tabular-nums', className)}
          {...props}
        />
      </div>
    )
  },
)

/** A 44px-tall checkbox row. */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<'input'>, 'type'> & { label: React.ReactNode }
>(function Checkbox({ label, className, ...props }, ref) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-medium text-ink', className)}>
      <input ref={ref} type="checkbox" className="size-5 shrink-0 rounded" {...props} />
      <span>{label}</span>
    </label>
  )
})
