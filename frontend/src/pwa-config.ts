import type { VitePWAOptions } from 'vite-plugin-pwa'

export const pwaOptions: Partial<VitePWAOptions> = {
  // 'prompt': a new version waits until the user taps "Reload to update" (FE-51), so a half-filled form is never wiped.
  registerType: 'prompt',
  includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png', 'favicon.svg'],
  manifest: {
    name: 'NivasOS',
    short_name: 'NivasOS',
    description: 'Operating system for multi-building PG owners',
    theme_color: '#faf7f0',
    background_color: '#faf7f0',
    display: 'standalone',
    start_url: '/',
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    navigateFallbackDenylist: [/^\/api\//, /^\/health$/],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
      },
      {
        // Never cache public pages' data, KYC / onboarding photos or any cross-origin file (signed storage URLs).
        // Functions are inlined into the service worker, so this one may only use globals.
        urlPattern: ({ url }) =>
          url.origin !== (globalThis as unknown as { location: { origin: string } }).location.origin || /\/(public|kyc|onboarding|uploads)\//.test(url.pathname),
        handler: 'NetworkOnly',
      },
    ],
  },
}
