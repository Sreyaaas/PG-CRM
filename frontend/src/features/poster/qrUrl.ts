/** Public check-in URL encoded in the Reception QR: `${VITE_PUBLIC_APP_URL}/join/<qr_slug>`. */
export function joinUrl(qrSlug: string): string {
  const base = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, '')
  return `${base}/join/${qrSlug}`
}
