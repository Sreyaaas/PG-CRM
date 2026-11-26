import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

const TRIGGER = 72 // px pulled (after resistance) that refreshes
const MAX = 110

/**
 * Native-feeling pull-to-refresh for touch screens: pull down at the top of the page to refetch every query.
 * Does nothing with a mouse, inside an open sheet, or when the page isn't scrolled to the top.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  // Optional: shells also render without a query client (style guide, some tests); then there's nothing to refresh.
  const queryClient = useContext(QueryClientContext)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const start = useRef<number | null>(null)
  const pullRef = useRef(0)

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (!queryClient || refreshing || window.scrollY > 0 || e.touches.length !== 1) return
      // Never hijack drags inside dialogs/sheets or horizontal scrollers.
      if ((e.target as Element | null)?.closest?.('[role="dialog"], [data-no-ptr]')) return
      start.current = e.touches[0].clientY
      setDragging(true)
    }
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return
      const dy = e.touches[0].clientY - start.current
      if (dy <= 0 || window.scrollY > 0) {
        start.current = dy <= 0 ? start.current : null
        pullRef.current = 0
        setPull(0)
        return
      }
      const eased = Math.min(MAX, dy * 0.5)
      pullRef.current = eased
      setPull(eased)
    }
    const onEnd = () => {
      setDragging(false)
      if (start.current === null) {
        setPull(0)
        return
      }
      start.current = null
      if (pullRef.current >= TRIGGER && queryClient) {
        setRefreshing(true)
        setPull(TRIGGER * 0.75)
        navigator.vibrate?.(8)
        void queryClient.invalidateQueries().finally(() => {
          setRefreshing(false)
          setPull(0)
        })
      } else {
        setPull(0)
      }
      pullRef.current = 0
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [queryClient, refreshing])

  const progress = Math.min(1, pull / TRIGGER)
  const visible = pull > 4 || refreshing

  return (
    <>
      <div
        aria-hidden={!visible}
        className="pointer-events-none fixed inset-x-0 top-[calc(var(--topbar-h)+env(safe-area-inset-top))] z-20 flex justify-center"
        style={{ transform: `translateY(${pull - 40}px)`, opacity: visible ? 1 : 0, transition: dragging ? 'none' : 'transform 200ms ease, opacity 200ms ease' }}
      >
        <span className="flex size-9 items-center justify-center rounded-full border border-line bg-surface shadow-sm" role={refreshing ? 'status' : undefined}>
          <RefreshCw
            aria-hidden="true"
            className={cn('size-4 text-ink', refreshing && 'animate-spin', progress >= 1 && !refreshing && 'text-brand-ink')}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
          {refreshing && <span className="sr-only">Refreshing</span>}
        </span>
      </div>
      {children}
    </>
  )
}
