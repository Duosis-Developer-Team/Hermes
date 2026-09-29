/**
 * =============================================================================
 * HERMES - Eski surum parcasi (stale chunk) korumasi
 * =============================================================================
 * Sayfa acikken yeni surum deploy edilirse eski `index.html` artik
 * sunucuda olmayan hash'li parcalari ister; tembel yuklenen ilk sayfa
 * (orn. cikis sonrasi giris ekrani) "Failed to fetch dynamically imported
 * module" ile patlar ve hata ekrani gorunurdu (masaustu, 30.09).
 *
 * Cozum: bu hata sinifi taninir ve sayfa BIR KEZ yenilenir (yeni
 * index.html → yeni parcalar). Dongu kilidi: 30 sn icinde ikinci yenileme
 * yapilmaz, o durumda normal hata ekrani gorunur.
 * =============================================================================
 */

const RELOAD_KEY = 'hermes.staleChunkReload'
const RELOAD_WINDOW_MS = 30_000

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .* failed|ChunkLoadError/i

export function isChunkLoadError(error) {
    if (!error) return false
    if (error.name === 'ChunkLoadError') return true
    return CHUNK_ERROR.test(String(error.message || error))
}

// Bu sayfa omrunde yenileme zaten planlandi mi (React hata sonrasi render'i
// ikinci kez dener; ikinci cagri da "yenileniyor" demeli).
let scheduled = false

/** Sayfayi bir kez yeniler; ONCEKI sayfa omrunde son 30 sn icinde denendiyse false. */
export function reloadForNewVersion(win = window) {
    if (scheduled) return true
    try {
        const last = Number(win.sessionStorage.getItem(RELOAD_KEY) || 0)
        if (Date.now() - last < RELOAD_WINDOW_MS) return false
        win.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {
        // Depolama kapali: dongu kilidi yok → yine de tek deneme.
    }
    scheduled = true
    win.location.reload()
    return true
}

/** Yalniz testler icin: modul durumunu sifirlar. */
export function resetStaleChunkGuardForTests() {
    scheduled = false
}

/** Vite'in on-yukleme hatasi (modulepreload / CSS) icin kuresel dinleyici. */
export function installStaleChunkGuard(win = window) {
    win.addEventListener('vite:preloadError', (event) => {
        if (reloadForNewVersion(win)) event.preventDefault()
    })
}
