/**
 * Hermes masaustu — gezinme politikasi (saf fonksiyonlar, testli).
 *
 *   - Secili sunucunun origin'i pencere ICINDE acilir.
 *   - Microsoft giris sayfalari da pencere icinde kalir (SSO tam sayfa
 *     yonlendirmedir: login.microsoftonline.com → <origin>/auth/callback).
 *   - Diger her sey (dokumanlar, Teams toplanti linkleri, dis siteler)
 *     varsayilan tarayicida acilir; pencere yabanci siteye GITMEZ.
 *   - hermes:// derin linkleri sunucu yoluna cevrilir:
 *       hermes://work/TASK-56  →  <origin>/work/TASK-56
 *       hermes://open/<yol>    →  <origin>/<yol>
 */
const AUTH_HOSTS = new Set([
    'login.microsoftonline.com',
    'login.live.com',
    'login.microsoft.com',
    'account.live.com',
    'aadcdn.msauth.net',
    'aadcdn.msftauth.net',
])

function safeUrl(raw) {
    try {
        return new URL(raw)
    } catch {
        return null
    }
}

/** 'internal' | 'auth' | 'external' | 'blocked' */
function classify(rawUrl, serverUrl) {
    const u = safeUrl(rawUrl)
    if (!u) return 'blocked'
    const origin = safeUrl(serverUrl)?.origin
    if (u.origin === origin) return 'internal'
    if (u.protocol === 'https:' && AUTH_HOSTS.has(u.hostname)) return 'auth'
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') return 'external'
    // javascript:, file:, data: vb. — acilmaz.
    return 'blocked'
}

const KEY_RE = /^[A-Za-z]+-\d+$/

/** hermes:// linkini sunucu adresine cevirir; gecersizse null. */
function deepLinkToUrl(rawLink, serverUrl) {
    const u = safeUrl(rawLink)
    if (!u || u.protocol !== 'hermes:') return null
    const base = safeUrl(serverUrl)
    if (!base) return null
    // hermes://work/TASK-56 → host='work', pathname='/TASK-56'
    const segments = [u.hostname, ...u.pathname.split('/')].filter(Boolean).map(decodeURIComponent)
    if (segments[0] === 'work' && segments.length === 2 && KEY_RE.test(segments[1])) {
        return `${base.origin}/work/${segments[1].toUpperCase()}`
    }
    if (segments[0] === 'open') {
        const rest = segments.slice(1)
        // Yol gecisi ve protokol-goreli hileler reddedilir.
        if (rest.some((s) => s === '..' || s === '.' || /[\\/:]/.test(s) || s.includes('..'))) return null
        const target = new URL(`/${rest.map(encodeURIComponent).join('/')}${u.search}`, base.origin)
        return target.origin === base.origin ? target.toString() : null
    }
    return null
}

module.exports = { classify, deepLinkToUrl, AUTH_HOSTS }
