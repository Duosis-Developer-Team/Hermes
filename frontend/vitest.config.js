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
        // 45000 → 60000 (2026-08-05, OLCUMLE): Explorer varsayilan
        // gorunum olunca Tasks sayfasi her mount'ta agac + Kanban
        // ciziyor. En agir CRUD govdesi bu makinede 13,5 sn'den
        // 14,0 sn'ye cikti (+%4) — kucuk bir fark, ama o govde CI
        // kosucusunda ZATEN ~43 sn'deydi ve 45 sn tavanini asti
        // (run 30954235783). Yani tavan gercek bir kusuru degil,
        // makine hizini olcuyordu.
        //
        // Once render maliyetini dusurmeyi denedim (Explorer memo +
        // kararli prop referanslari); olculebilir kazanc CIKMADI —
        // maliyet agacta degil, testin kendi modal etkilesiminde.
        // Memoizasyon yine de korundu (§15 sozlesmesi).
        //
        // Sinir SONLUDUR: gercek bir hang, cozulmeyen mock veya hic
        // render olmayan icerik yine timeout ile KIRMIZI kalir;
        // yalnizca kirmiziya donme suresi uzar.
        testTimeout: 60000,
    },
})
