import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // We ship our own public/manifest.webmanifest
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Never cache API responses in the SW — the app layer handles
        // offline reads via localStorage
        runtimeCaching: [],
      },
    }),
  ],
  // amazon-cognito-identity-js expects Node's `global`
  define: { global: 'globalThis' },
  server: {
    // Local dev talks to the deployed API through the real CloudFront distro
    proxy: {
      '/api': { target: 'https://fit.zackwithers.com', changeOrigin: true },
    },
  },
})
