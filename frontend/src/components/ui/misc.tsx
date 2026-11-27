import type * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { Tone } from './badge'

/* ───────── Avatar ───────── */

export function initials(name: string): string {
  const cleaned = name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_SIZES = {
  sm: 'size-8 text-[11.5px]',
  md: 'size-10 text-[13px]',
  lg: 'size-13 text-[17px]',
} as const

/** Initials in a warm neutral circle. Decorative: the name is always shown next to it. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: keyof typeof AVATAR_SIZES
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-surface-3 font-semibold tracking-[0.01em] text-neutral-ink',
        AVATAR_SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

/* ───────── Brand mark ───────── */

export function BrandMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-brand font-bold tracking-[-0.03em] text-on-brand',
        size === 'sm' && 'size-7 rounded-lg text-[14px]',
        size === 'md' && 'size-9 rounded-[10px] text-[17px]',
        size === 'lg' && 'size-11 rounded-xl text-[20px]',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11L12 4l8 7" />
        <path d="M6.5 9.5V20h11V9.5" />
        <path d="M10 20v-6h4v6" />
      </svg>
    </span>
  )
}

/* ───────── Stat tile ───────── */

export function StatTile({
  label,
  value,
  foot,
  icon,
  highlight = false,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  foot?: React.ReactNode
  icon?: React.ReactNode
  /** Marigold tint for the single number that matters most, e.g. cash in hand. */
  highlight?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        '@container flex min-w-0 flex-col gap-1 rounded-card border px-4 py-3 shadow-xs sm:px-[18px] sm:py-4',
        highlight
          ? 'border-[color-mix(in_oklab,var(--brand)_45%,var(--line))] bg-brand-soft'
          : 'border-line bg-surface',
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-[12.5px] font-medium [&_svg]:size-3.5',
          highlight ? 'text-brand-ink' : 'text-muted',
        )}
      >
        {icon}
        {label}
      </span>
      <span className="whitespace-nowrap text-[clamp(15px,14cqi,24px)] font-bold leading-tight tracking-[-0.02em] text-ink tabular-nums [overflow-wrap:anywhere]">
        {value}
      </span>
      {foot && <span className="text-[12px] text-muted">{foot}</span>}
    </div>
  )
}

/* ───────── List row ───────── */

export function ListRow({
  leading,
  title,
  meta,
  trailing,
  className,
}: {
  leading?: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-15 items-center gap-3 px-4 py-3 sm:px-5', className)}>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-medium text-ink">{title}</div>
        {meta && <div className="truncate text-[12.5px] text-muted">{meta}</div>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  )
}

/** Classes for a row that is itself a link or button: pressed and hover states. */
export const ROW_LINK = 'block transition-colors hover:bg-surface-2 active:bg-surface-2'

/* ───────── Headers ───────── */

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: { to: string; label: string }
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="-ml-1 mb-1 inline-flex min-h-11 items-center gap-0.5 pr-2 text-[13.5px] font-medium text-muted hover:text-ink active:opacity-70"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        {eyebrow && !back && <div className="mb-1 text-[13px] text-muted">{eyebrow}</div>}
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ───────── Empty state ───────── */

/** One plain line, plus an optional action. No illustration. */
export function EmptyState({
  children,
  action,
  className,
}: {
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-start gap-3 px-4 py-6 sm:px-5', className)}>
      <p className="text-[14px] text-muted">{children}</p>
      {action}
    </div>
  )
}

/* ───────── Notice (inline alert) ───────── */

const NOTICE_TONES: Record<Exclude<Tone, 'neutral' | 'brand'>, { cls: string; icon: React.ReactNode }> = {
  danger: {
    cls: 'bg-danger-soft text-danger-ink border-[color-mix(in_oklab,var(--danger)_22%,transparent)]',
    icon: <AlertCircle aria-hidden="true" />,
  },
  warning: {
    cls: 'bg-warning-soft text-warning-ink border-[color-mix(in_oklab,var(--warning)_25%,transparent)]',
    icon: <AlertTriangle aria-hidden="true" />,
  },
  success: {
    cls: 'bg-success-soft text-success-ink border-transparent',
    icon: <CheckCircle2 aria-hidden="true" />,
  },
  info: {
    cls: 'bg-info-soft text-info-ink border-transparent',
    icon: <Info aria-hidden="true" />,
  },
}

export function Notice({
  tone = 'danger',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { tone?: keyof typeof NOTICE_TONES }) {
  const spec = NOTICE_TONES[tone]
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-control border px-3.5 py-3 text-[14px] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
        spec.cls,
        className,
      )}
      {...props}
    >
      {spec.icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/* ───────── Skeleton ───────── */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-lg bg-surface-2 animate-[pulse-soft_1.6s_ease-in-out_infinite]', className)}
    />
  )
}

/** Accessible loading block: skeleton lines with a screen-reader label. */
export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-2.5 p-4 sm:p-5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i % 2 ? 'w-2/3' : 'w-5/6')} />
      ))}
    </div>
  )
}
