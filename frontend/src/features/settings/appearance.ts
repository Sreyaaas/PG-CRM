import { useCallback, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type DensityChoice = 'comfortable' | 'compact'
export type RadiusChoice = 'soft' | 'sharp'

export interface AppearancePrefs {
  theme: ThemeChoice
  density: DensityChoice
  radius: RadiusChoice
}

export const THEME_STORAGE_KEY = 'pgcrm_theme'
export const DENSITY_STORAGE_KEY = 'pgcrm_density'
export const RADIUS_STORAGE_KEY = 'pgcrm_radius'

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
}

export function initAppearance(): AppearancePrefs {
  const prefs = loadAppearance()
  applyAppearance(prefs)
  return prefs
}

export function useAppearance() {
  const [prefs, setPrefs] = useState<AppearancePrefs>(() => loadAppearance())

  const update = useCallback(<K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]) => {
    setPrefs((prev) => {
      const next: AppearancePrefs = { ...prev, [key]: value }
      const storage = getStorage()
      if (storage) {
        if (key === 'theme') storage.setItem(THEME_STORAGE_KEY, value)
        if (key === 'density') storage.setItem(DENSITY_STORAGE_KEY, value)
        if (key === 'radius') storage.setItem(RADIUS_STORAGE_KEY, value)
      }
      applyAppearance(next)
      return next
    })
  }, [])

  return { prefs, update }
}
