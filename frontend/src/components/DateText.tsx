import { cn } from '@/lib/utils'

const IST_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

export function formatDateIST(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return IST_DATE_FORMATTER.format(date)
}

export interface DateTextProps {
  value: string | Date
  className?: string
}

export function DateText({ value, className }: DateTextProps) {
  const iso = typeof value === 'string' ? value : value.toISOString()
  return (
    <time dateTime={iso} className={cn('tabular-nums', className)}>
      {formatDateIST(value)}
    </time>
  )
}
