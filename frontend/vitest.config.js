/**
 * HERMES - Vitest yapilandirmasi (Sprint 1 §4).
 * Deterministiklik: sabit TZ/locale (setup dosyasinda). jsx testleri
 * jsdom'da, node testleri (portal gercek-durum kilitleri gibi dosya
 * okuyanlar) node ortaminda kosar.
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    test: {
        environmentMatchGlobs: [
            ['**/*.test.jsx', 'jsdom'],
            ['**/*.test.js', 'node'],
        ],
        setupFiles: ['./src/test/setup.js'],
        globals: true,
    },
})
