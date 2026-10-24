import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Keep the browser's Host and Origin aligned with the API's device-control
// boundary. The same proxy handles both REST requests and live WebSockets.
const apiProxy = {
  target: 'http://127.0.0.1:8000',
  changeOrigin: false,
  ws: true,
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiProxy,
      '/docs': apiProxy,
      '/openapi.json': apiProxy,
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
