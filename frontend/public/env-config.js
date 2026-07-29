/**
 * =============================================================================
 * HERMES - Runtime yapilandirma yer tutucusu
 * =============================================================================
 * `index.html` bu dosyayi KOSULSUZ yukler. Amaci, imaj icinde her zaman
 * GERCEK bir dosya bulunmasini saglamaktir: aksi halde her sayfa
 * acilisinda bir 404 olusur (nginx bu yolu bilerek SPA fallback'ine
 * dusurmez — bkz. `nginx.conf`, `location = /env-config.js`).
 *
 * BU DOSYA DEGER TASIMAZ. Icinde client ID, tenant ID, URL veya baska
 * bir ortam degeri BULUNMAZ; repoya secret yazilmaz.
 *
 * Sozlesme:
 *   - Deploy sirasinda bu dosyanin uzerine gercek degerleri yazan bir
 *     surum konursa (configMap/entrypoint), o surum `window._env_`
 *     nesnesini kendisi doldurur.
 *   - Boyle bir surum YOKKEN (bugunku durum) burasi yalnizca nesnenin
 *     VAR OLMASINI garanti eder.
 *
 * `= window._env_ || {}` bilincli bir tercihtir: bu betikten ONCE bir
 * yapilandirma enjekte edilmisse onu EZMEZ.
 *
 * Anahtarlar bilerek TANIMLANMAZ. Tuketici taraf
 * (`src/pages/LoginPage.jsx`) su zinciri kullanir:
 *
 *   window._env_?.VITE_AZURE_TENANT_ID || import.meta.env.VITE_AZURE_TENANT_ID
 *
 * Anahtari bos string ile tanimlamak da ayni sonucu verirdi, ama
 * tanimsiz birakmak "burada bir deger yok" bilgisini daha durust
 * tasir ve build-time fallback'i (Dockerfile ARG/ENV → Vite) oldugu
 * gibi korur.
 * =============================================================================
 */
window._env_ = window._env_ || {}
