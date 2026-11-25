// Vitest has no service worker plugin; this stands in for `virtual:pwa-register/react`.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: async () => {},
  }
}
