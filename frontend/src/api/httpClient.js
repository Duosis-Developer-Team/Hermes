/**
 * =============================================================================
 * HERMES - HTTP istemci fabrikasi (Sprint 1, CTO paketi §10)
 * =============================================================================
 * services/api.js'teki createApiClient buraya tasindi — tek base-URL/
 * cookie/timeout/interceptor kaynagi. [KRİTİK-6] mimarisi AYNEN korunur:
 * token JS'e acilmaz, HttpOnly cookie withCredentials ile gider; 401'de
 * UI state temizlenir.
 *
 * Ek (geriye uyumlu): her reddedilen hataya `err.normalized` alani
 * eklenir (src/api/errors.js modeli). Mevcut catch'lerdeki
 * err.response?.data?.detail kullanimlarini KIRMAZ; yeni kod normalized
 * uzerinden okur ve axios detaylarina bagimliligi azaltir.
 */
import axios from 'axios'
import { useAuthStore } from '../stores/authStore'
import { toApiError } from './errors'

export const API_URLS = {
    auth: import.meta.env.VITE_AUTH_API_URL || '',
    core: import.meta.env.VITE_CORE_API_URL || '',
    reports: import.meta.env.VITE_REPORTS_API_URL || '',
}

export const createApiClient = (baseURL) => {
    const client = axios.create({
        baseURL,
        timeout: 30000,
        withCredentials: true, // HttpOnly cookie otomatik gönderilir
        headers: { 'Content-Type': 'application/json' },
    })

    /*
     * WS12 — WORKSPACE tasima.
     *
     * Tenant, ISTEGIN kendisinden cozulur (Host basligi ya da
     * `?workspace=` parametresi) — tarayicinin adres cubugundan DEGIL.
     * Dolayisiyla kullanici `/?workspace=acme` adresindeyse, bunu her
     * API cagrisina biz tasimaliyiz; aksi halde istek varsayilan host
     * eslesmesine duser ve kullanici YANLIS organizasyona (ya da
     * hicbirine) gider.
     *
     * Sunucu tarafi bu parametreyi YALNIZCA
     * `HERMES_ALLOW_WORKSPACE_PATH` acikken dikkate alir; production'da
     * kapalidir ve adres yine host'tan cozulur. Yani bu satirlar
     * guvenlik sinirini genisletmez, var olan dev/test kolayligini
     * kullanilabilir kilar.
     */
    client.interceptors.request.use((config) => {
        try {
            const ws = new URLSearchParams(window.location.search)
                .get('workspace')
            if (ws) {
                config.params = { workspace: ws, ...(config.params || {}) }
            }
        } catch {
            // Adres okunamiyorsa (test ortami) sessizce gec: istek yine
            // host uzerinden cozulur.
        }
        return config
    })

    client.interceptors.response.use(
        (response) => response,
        (error) => {
            if (error.response?.status === 401) {
                // Cookie backend tarafında geçersiz — yalnız UI state
                // temizlenir; cookie silme /auth/logout'un işi.
                useAuthStore.getState().logout()
            }
            error.normalized = toApiError(error)
            return Promise.reject(error)
        }
    )

    return client
}

export const authClient = createApiClient(API_URLS.auth)
export const coreClient = createApiClient(API_URLS.core)
