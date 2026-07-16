import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Auth service API proxy
      '/api/v1/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      // Core service API proxy
      '/api/v1/core': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        secure: false,
      },
      // Reports service API proxy
      '/api/v1/reports': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        secure: false,
      },
      // Public API (external integrations) — served by core-service
      '/api/public': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        secure: false,
      },
    }
  }
})
