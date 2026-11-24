import type { VitePWAOptions } from 'vite-plugin-pwa'

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  includeAssets: ['pwa-192x192.png', 'pwa-512x512.png'],
  manifest: {
    name: 'PG-CRM',
    short_name: 'PG-CRM',
    description: 'Operating system for multi-building PG owners',
    theme_color: '#0f172a',
    background_color: '#ffffff',
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
    ],
  },
}
