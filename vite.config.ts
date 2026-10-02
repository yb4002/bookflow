import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const apiPort = process.env.API_PORT ?? '8787'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same-origin API in development (the production server serves both).
    proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false } },
  },
})
