import { useRegisterSW } from 'virtual:pwa-register/react'
import { UpdatePrompt } from './UpdatePrompt'

/** Registers the service worker; shows the update toast when a new version is waiting. */
export function UpdatePromptContainer() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null
  return (
    <UpdatePrompt
      onReload={() => {
        void updateServiceWorker(true)
      }}
      onDismiss={() => setNeedRefresh(false)}
    />
  )
}
