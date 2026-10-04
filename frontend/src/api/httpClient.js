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

/*
 * =============================================================================
 * Kayan oturum — yenileme cerezi (HttpOnly, yalnizca /api/v1/auth yolunda)
 * =============================================================================
 * Erisim cerezi kisa omurludur (60 dk). Bir tenant istegi 401 alirsa
 * POST /api/v1/auth/session/refresh cagrilir; sunucu yenileme cerezini
 * dogrulayip IKI cerezi de yeniden yazar, istek bir kez tekrarlanir.
 *
 *   - TEK UCUS: ayni anda 401 alan N istek tek bir yenileme bekler
 *     (aksi halde N yenileme N kez cerez yazar, gereksiz yuk olur).
 *   - Yenileme ucu interceptor'suz AYRI bir istemciyle cagrilir; kendi
 *     401'i asla yeniden yenileme tetiklemez.
 *   - Giris / cikis / yenileme uclarinin 401'i yenilemeye GIRMEZ.
 *   - Platform konsolu ayri istemci kullanir (api/platformApi.js); bu
 *     mekanizma ona hic dokunmaz.
 * Token JS'e hic acilmaz — yalnizca cerezler gider gelir.
 */
export const SESSION_REFRESH_PATH = '/api/v1/auth/session/refresh'
const NO_REFRESH_PATHS = [
    SESSION_REFRESH_PATH,
    '/api/v1/auth/token',
    '/api/v1/auth/microsoft',
    '/api/v1/auth/logout',
]
const RETRIED = '__hermesSessionRetried'

/** Yenileme ucunun interceptor'suz istemcisi (testler adapter'ini degistirir). */
export const sessionRefreshClient = axios.create({
    baseURL: API_URLS.auth,
    timeout: 30000,
    withCredentials: true,
})

let refreshInFlight = null
let lastRefreshAt = Date.now()

/** Son basarili yenileme zamani (gorunurluk tetikli proaktif yenileme icin). */
export const getLastSessionRefreshAt = () => lastRefreshAt

/**
 * Oturumu yeniler. Ayni anda gelen cagrilar AYNI promise'i paylasir.
 * Basarisizlikta reddeder (sunucu cerezleri zaten sildi).
 */
export const refreshSession = () => {
    if (!refreshInFlight) {
        refreshInFlight = sessionRefreshClient
            .post(SESSION_REFRESH_PATH)
            .then((response) => {
                lastRefreshAt = Date.now()
                return response.data
            })
            .finally(() => {
                refreshInFlight = null
            })
    }
    return refreshInFlight
}

const canRefreshFor = (config) => {
    const url = config?.url || ''
    return !NO_REFRESH_PATHS.some((p) => url.includes(p))
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
        async (error) => {
            const config = error.config
            if (
                error.response?.status === 401
                && config
                && !config[RETRIED]
                && canRefreshFor(config)
            ) {
                // Erisim cerezi (60 dk) dustu: yenileme cereziyle oturumu
                // kaydir ve istegi BIR KEZ tekrarla. Ikinci 401'de
                // RETRIED isareti donguyu keser ve asagidaki cikisa duser.
                config[RETRIED] = true
                try {
                    await refreshSession()
                } catch {
                    useAuthStore.getState().logout()
                    error.normalized = toApiError(error)
                    return Promise.reject(error)
                }
                return client(config)
            }
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
