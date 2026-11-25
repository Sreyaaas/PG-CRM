import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** "Reload to update" toast, shown when a new service worker is waiting. */
export function UpdatePrompt({ onReload, onDismiss }: { onReload: () => void; onDismiss: () => void }) {
  return (
    <div className="safe-x pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottomnav-h,0px)+16px+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md print:hidden">
      <div
        role="status"
        className="anim-pop pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pl-3.5 pr-1 text-[14px] text-ink shadow-lg"
      >
        <RefreshCw className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1">A new version is available.</span>
        <Button type="button" size="sm" variant="brand" onClick={onReload}>
          Reload to update
        </Button>
        <button
          type="button"
          aria-label="Dismiss update notice"
          onClick={onDismiss}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
