import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // amazon-cognito-identity-js expects Node's `global`
  define: { global: 'globalThis' },
  server: {
    // Local dev talks to the deployed API through the real CloudFront distro
    proxy: {
      '/api': { target: 'https://fit.zackwithers.com', changeOrigin: true },
    },
  },
})
