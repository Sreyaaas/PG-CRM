import { cn } from '@/lib/utils'

export interface UtrProps {
  value: string
  className?: string
}

export function formatUtr(value: string): string {
  const digits = value.replace(/\s+/g, '')
  return digits.replace(/(.{4})(?=.)/g, '$1 ')
}

export function Utr({ value, className }: UtrProps) {
  return <span className={cn('font-mono tabular-nums', className)}>{formatUtr(value)}</span>
}
