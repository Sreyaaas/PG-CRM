import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void): () => void {
  const mql = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined
  mql?.addEventListener?.('change', onChange)
  return () => mql?.removeEventListener?.('change', onChange)
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' ? (window.matchMedia?.(QUERY)?.matches ?? false) : false
}

/** True on laptops and desktops (>= 1024px, Tailwind `lg`). Phones and environments without matchMedia get false. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
