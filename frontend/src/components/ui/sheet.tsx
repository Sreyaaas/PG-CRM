import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let openSheets = 0

/**
 * Bottom sheet on phones (< 640px), centred dialog on larger screens.
 * Focus is trapped inside while open, Esc and a backdrop tap close it, the page behind does not
 * scroll, and focus returns to the opener on close. Rendered only while open.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  ariaLabel,
  footer,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Accessible name when it should differ from the visible title. */
  ariaLabel?: string
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    openSheets += 1
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstItem || !panel.contains(active))) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && (active === lastItem || !panel.contains(active))) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      openSheets -= 1
      if (openSheets === 0) document.body.style.overflow = prevOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        aria-hidden="true"
        data-testid="sheet-backdrop"
        className="anim-fade absolute inset-0 bg-overlay"
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          'anim-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface text-ink shadow-lg outline-none',
          'rounded-t-[20px] border border-b-0 border-line',
          'sm:max-h-[85dvh] sm:max-w-[440px] sm:rounded-2xl sm:border-b',
          className,
        )}
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-2 sm:px-5 sm:pt-4">
          <div className="min-w-0 pt-2">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13.5px] text-muted">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onCloseRef.current()}
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-2"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5',
            footer ? 'pb-4' : 'pb-[max(16px,env(safe-area-inset-bottom))] sm:pb-5',
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 gap-2 border-t border-line px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-5 sm:pb-4 [&>*]:flex-1">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
