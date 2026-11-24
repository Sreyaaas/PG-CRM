import type * as React from 'react'
import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

/** Tint backgrounds with a dark shade of the same hue for text (WCAG AA on the tint). */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-neutral-ink border-line',
  brand: 'bg-brand-soft text-brand-ink border-transparent',
  success: 'bg-success-soft text-success-ink border-transparent',
  warning: 'bg-warning-soft text-warning-ink border-transparent',
  danger: 'bg-danger-soft text-danger-ink border-transparent',
  info: 'bg-info-soft text-info-ink border-transparent',
}

export const TONES: Tone[] = ['neutral', 'brand', 'success', 'warning', 'danger', 'info']

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-semibold leading-none',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** A selectable filter chip. Pressed state uses the brand tint. */
export function Chip({
  pressed = false,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'aria-pressed'> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-chip border px-3 text-[13px] font-medium transition-colors pointer-coarse:h-11',
        'active:scale-[0.98]',
        pressed
          ? 'border-[color-mix(in_oklab,var(--brand)_45%,var(--line))] bg-brand-soft text-brand-ink'
          : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
        className,
      )}
      {...props}
    />
  )
}
