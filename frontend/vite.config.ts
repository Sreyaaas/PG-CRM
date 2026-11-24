import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './src/pwa-config.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
