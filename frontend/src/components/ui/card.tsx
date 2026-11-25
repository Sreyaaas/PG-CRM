import type * as React from 'react'
import { cn } from '@/lib/utils'

/** White surface, 14px radius, hairline border and a barely-there shadow. */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('min-w-0 rounded-card border border-line bg-surface shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
  as: Heading = 'h2',
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <div
      className={cn(
        'flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</Heading>
        {description && <p className="truncate text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-4 sm:p-5', className)} {...props} />
}

/** Children separated by hairlines, for rows inside a card. */
export function CardList({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul className={cn('divide-y divide-line', className)} {...props} />
}
