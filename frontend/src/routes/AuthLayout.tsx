import type { ReactNode } from 'react'
import { BrandMark } from '@/components/ui/misc'

/**
 * Full-page layout for sign-in, sign-up and the org picker: brand mark top-left, a big two-line
 * heading and the form underneath, in a 400px column centred on larger screens.
 */
export function AuthLayout({
  title,
  description,
  aside,
  footer,
  children,
}: {
  /** Two lines: [first, second]. Rendered as one heading so its accessible name reads naturally. */
  title: [string, string]
  description?: ReactNode
  aside?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-page pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-ink">
      <header className="safe-x flex h-16 items-center justify-between gap-3 sm:px-8">
        <span className="flex items-center gap-2.5">
          <BrandMark size="md" />
          <span className="text-[16px] font-bold tracking-[-0.02em]">PG-CRM</span>
        </span>
        {aside}
      </header>

      <main className="flex w-full flex-1 flex-col items-center pl-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))] sm:justify-center">
        <div className="w-full max-w-[400px] pb-10 pt-6 sm:pb-[10dvh] sm:pt-0">
          <h1 className="text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[40px]">
            <span className="block">{title[0]}</span> <span className="block">{title[1]}</span>
          </h1>
          {description && <p className="mt-3 text-[15px] text-muted">{description}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 border-t border-line pt-5 text-[14px] text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
