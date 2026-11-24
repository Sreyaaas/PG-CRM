import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

export interface MoneyProps {
  paise: number
  className?: string
}

export function Money({ paise, className }: MoneyProps) {
  return <span className={cn('tabular-nums', className)}>{formatINR(paise)}</span>
}
