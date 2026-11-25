import { useCallback, useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type DensityChoice = 'comfortable' | 'compact'
export type RadiusChoice = 'soft' | 'sharp'
export type PaletteChoice = 'marigold' | 'neem' | 'lagoon' | 'terracotta' | 'ocean'

/** Accent palettes. `brand` is shown as the swatch; the colours themselves live in index.css. */
export const PALETTES: { value: PaletteChoice; label: string; hint: string; brand: string }[] = [
  { value: 'marigold', label: 'Marigold', hint: 'Warm yellow, the default', brand: '#f5b31f' },
  { value: 'neem', label: 'Neem', hint: 'Deep green, calm and trusted', brand: '#1f7a4d' },
  { value: 'lagoon', label: 'Lagoon', hint: 'Petrol teal, clean and modern', brand: '#0e7680' },
  { value: 'terracotta', label: 'Terracotta', hint: 'Burnt orange, earthy', brand: '#b9471b' },
  { value: 'ocean', label: 'Ocean', hint: 'Clear blue, businesslike', brand: '#2257d6' },
]

export interface AppearancePrefs {
  theme: ThemeChoice
  density: DensityChoice
  radius: RadiusChoice
  palette: PaletteChoice
}

export const THEME_STORAGE_KEY = 'pgcrm_theme'
export const DENSITY_STORAGE_KEY = 'pgcrm_density'
export const RADIUS_STORAGE_KEY = 'pgcrm_radius'
export const PALETTE_STORAGE_KEY = 'pgcrm_palette'

function getStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = getStorage()?.getItem(key)
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

export function loadAppearance(): AppearancePrefs {
  return {
    theme: readChoice(THEME_STORAGE_KEY, ['system', 'light', 'dark'], 'system'),
    density: readChoice(DENSITY_STORAGE_KEY, ['comfortable', 'compact'], 'comfortable'),
    radius: readChoice(RADIUS_STORAGE_KEY, ['soft', 'sharp'], 'soft'),
    palette: readChoice(PALETTE_STORAGE_KEY, ['marigold', 'neem', 'lagoon', 'terracotta', 'ocean'], 'marigold'),
  }
}

export function applyAppearance(prefs: AppearancePrefs): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  if (prefs.theme === 'system') {
    delete root.dataset.theme
  } else {
    root.dataset.theme = prefs.theme
  }

  root.dataset.density = prefs.density
  root.dataset.radius = prefs.radius
  if (prefs.palette === 'marigold') delete root.dataset.palette
  else root.dataset.palette = prefs.palette
}

/** The theme actually showing: an explicit choice, or the phone's setting when on 'system'. */
export function resolvedTheme(theme: ThemeChoice): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}

export function initAppearance(): AppearancePrefs {
  const prefs = loadAppearance()
  applyAppearance(prefs)
  return prefs
}

/* One shared store, so the top-bar toggle and the Settings page always show the same choice. */
let current: AppearancePrefs | null = null
const listeners = new Set<() => void>()

function snapshot(): AppearancePrefs {
  if (!current) current = loadAppearance()
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const STORAGE_KEYS: Record<keyof AppearancePrefs, string> = {
  theme: THEME_STORAGE_KEY,
  density: DENSITY_STORAGE_KEY,
  radius: RADIUS_STORAGE_KEY,
  palette: PALETTE_STORAGE_KEY,
}

export function setAppearance<K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]): void {
  current = { ...snapshot(), [key]: value }
  try {
    getStorage()?.setItem(STORAGE_KEYS[key], value)
  } catch {
    // Private mode or full storage: the choice still applies for this visit.
  }
  applyAppearance(current)
  listeners.forEach((l) => l())
}

/** Test helper: forget the in-memory choice so the next read comes from localStorage again. */
export function resetAppearanceForTest(): void {
  current = null
}

export function useAppearance() {
  const prefs = useSyncExternalStore(subscribe, snapshot, snapshot)
  const update = useCallback(<K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]) => setAppearance(key, value), [])
  return { prefs, update }
}
