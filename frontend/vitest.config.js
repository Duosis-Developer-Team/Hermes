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
        // Sprint 5C: Tasks entegrasyon testleri GERCEK sayfayi mount eder
        // (board + list + 4 modal + AntD Select portallari). jsdom'da tek
        // kullanici etkilesimi ~1 sn surer; 5 sn'lik varsayilan gercek bir
        // takilmayi degil, sadece agirligi olcuyordu.
        //
        // 20000 → 45000 (CI kosucusu): bu makinede en agir dosya
        // ~7,8 sn/test kosuyor; 2 cekirdekli GitHub runner'inda ayni
        // govdeler 20 sn tavanini asti (run 30476696257, 10 test
        // "Test timed out in 20000ms"). Sinir SONLUDUR — gercek bir hang
        // veya cozulmeyen mock hala timeout ile kirmizi kalir; yalnizca
        // tavan kosucunun gercek hizina gore ayarlandi.
        testTimeout: 45000,
    },
})
