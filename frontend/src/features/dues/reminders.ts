import { useCallback, useState } from 'react'

/** Today's date in India (the app's calendar), as YYYY-MM-DD. */
function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

function storageKey(orgId: string, residentId: string): string {
  return `pgcrm_reminded:${orgId}:${residentId}`
}

function readLastReminded(orgId: string, residentId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(orgId, residentId))
  } catch {
    return null
  }
}

/**
 * "Last reminded" is tracked on this device only (localStorage per resident) so the same resident
 * is not nudged twice in a day. The message text and link always come from the API.
 */
export function useReminders(orgId: string) {
  const [, setVersion] = useState(0)

  const isRemindedToday = (residentId: string): boolean => readLastReminded(orgId, residentId) === todayIst()

  /** Opens the API's wa.me link in a new tab and records the reminder. */
  const send = useCallback(
    (residentId: string, whatsappUrl: string) => {
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer')
      try {
        window.localStorage.setItem(storageKey(orgId, residentId), todayIst())
      } catch {
        // Storage can be blocked; the reminder still opened.
      }
      setVersion((v) => v + 1)
    },
    [orgId],
  )

  return { isRemindedToday, send }
}
