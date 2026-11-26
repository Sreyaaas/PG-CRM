import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'default' | 'error' | 'success'

export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextToastId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'default') => {
      const id = nextToastId++
      // A short tap on Android when something saves; iOS and desktops ignore it.
      if (variant === 'success') navigator.vibrate?.(12)
      // Several requests can fail at once (e.g. every query on a page gets a 401); show each message once.
      setToasts((prev) =>
        prev.some((t) => t.message === message && t.variant === variant) ? prev : [...prev, { id, message, variant }],
      )
      window.setTimeout(() => {
        dismiss(id)
      }, 5000)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-[60] mx-auto flex max-w-md flex-col gap-2 safe-x print:hidden"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.variant === 'error' ? 'alert' : 'status'}
            className="anim-pop pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface py-2 pl-3.5 pr-1 text-[14px] text-ink shadow-lg"
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-2.5 [&_svg]:size-4',
                toast.variant === 'error' && 'text-danger',
                toast.variant === 'success' && 'text-success',
                toast.variant === 'default' && 'text-muted',
              )}
            >
              {toast.variant === 'error' ? <AlertCircle /> : toast.variant === 'success' ? <CheckCircle2 /> : <Info />}
            </span>
            <span className="min-w-0 flex-1 py-2">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-2"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}
