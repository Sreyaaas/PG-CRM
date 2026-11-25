import { useCallback, useEffect, useState } from 'react'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return mediaStandalone || iosStandalone
}

export function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  const isAppleMobile = /iphone|ipad|ipod/i.test(ua)
  const isIpadDesktopMode = /macintosh/i.test(ua) && (window.navigator.maxTouchPoints ?? 0) > 1
  return isAppleMobile || isIpadDesktopMode
}

export function resetInstallPromptForTest(): void {
  deferredPrompt = null
  notify()
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(() => Boolean(deferredPrompt))
  const [standalone, setStandalone] = useState(() => isStandaloneMode())
  const [ios, setIos] = useState(() => isIosSafari())

  useEffect(() => {
    const sync = () => {
      setCanInstall(Boolean(deferredPrompt))
      setStandalone(isStandaloneMode())
      setIos(isIosSafari())
    }
    sync()
    listeners.add(sync)

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      deferredPrompt = event as BeforeInstallPromptEvent
      sync()
    }
    const onInstalled = () => {
      deferredPrompt = null
      sync()
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      listeners.delete(sync)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      deferredPrompt = null
      notify()
      return true
    }
    return false
  }, [])

  return {
    isStandalone: standalone,
    isIos: ios,
    canInstall,
    promptInstall,
  }
}
