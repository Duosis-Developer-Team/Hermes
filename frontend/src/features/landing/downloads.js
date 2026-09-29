/**
 * =============================================================================
 * HERMES - Landing: masaustu indirmeleri (SAF model)
 * =============================================================================
 * Dosyalar frontend nginx'in `/downloads/` yolundan servis edilir (kume ici
 * kalici disk; imaja gomulmez). Hangi surumun, hangi dosyanin oldugu
 * `/downloads/manifest.json`dan okunur — yeni surum = dosyalari ve
 * manifest'i kopyalamak, frontend deploy'u GEREKMEZ:
 *
 *   { "version": "0.1.0", "released": "2026-09-30",
 *     "files": { "mac-arm64": { "file": "...dmg", "size": 127632646 },
 *                "mac-x64":   { ... }, "win-x64": { ... } } }
 *
 * Manifest'te olmayan platform "Yakinda" gosterilir (kirik link YOK).
 * =============================================================================
 */

export const PLATFORMS = ['mac-arm64', 'mac-x64', 'win-x64']
export const DOWNLOADS_BASE = '/downloads/'

/** Manifest'i dogrular; beklenmeyen sekil → bos (hepsi "Yakinda"). */
export function normalizeManifest(raw) {
    const files = {}
    const src = raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object' ? raw.files : {}
    for (const key of PLATFORMS) {
        const f = src[key]
        // Yalniz duz dosya adi: yol, protokol ya da ust dizin kabul edilmez.
        if (f && typeof f.file === 'string' && /^[\w.-]+\.(dmg|exe)$/.test(f.file)) {
            files[key] = { file: f.file, size: Number(f.size) || null, href: `${DOWNLOADS_BASE}${f.file}` }
        }
    }
    return {
        version: typeof raw?.version === 'string' ? raw.version : null,
        released: typeof raw?.released === 'string' ? raw.released : null,
        files,
    }
}

export async function fetchManifest(fetchImpl = fetch) {
    try {
        const res = await fetchImpl(`${DOWNLOADS_BASE}manifest.json`, { cache: 'no-cache' })
        if (!res.ok) return normalizeManifest(null)
        return normalizeManifest(await res.json())
    } catch {
        return normalizeManifest(null)
    }
}

/** Boyut (bayt) → "121" gibi MB metni. */
export function sizeInMb(bytes) {
    const n = Number(bytes)
    return Number.isFinite(n) && n > 0 ? String(Math.round(n / 1048576)) : null
}

/**
 * Ziyaretcinin platformu (onerilen indirme). Mac'te islemci tarayicidan
 * guvenilir okunamaz: Chromium `userAgentData` mimarisini verirse o,
 * yoksa varsayilan Apple Silicon (2020 sonrasi tum Mac'ler).
 */
export async function detectPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
    if (!nav) return null
    const ua = String(nav.userAgent || '')
    const platform = String(nav.userAgentData?.platform || nav.platform || '')
    if (/Windows|Win32|Win64/i.test(platform) || /Windows NT/i.test(ua)) return 'win-x64'
    const isMac = /mac/i.test(platform) || /Macintosh/i.test(ua)
    if (!isMac || /iPhone|iPad/i.test(ua)) return null
    try {
        const hints = await nav.userAgentData?.getHighEntropyValues?.(['architecture'])
        if (hints?.architecture === 'x86') return 'mac-x64'
    } catch {
        // Ipucu yoksa varsayilan kalir.
    }
    return 'mac-arm64'
}
