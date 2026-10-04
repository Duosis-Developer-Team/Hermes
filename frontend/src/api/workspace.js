/**
 * =============================================================================
 * HERMES - Workspace (tenant) adresleme yardimcilari
 * =============================================================================
 * Host disindaki tenant'lar `?workspace=<slug>` ile adreslenir (sunucu bunu
 * YALNIZCA `HERMES_ALLOW_WORKSPACE_PATH` acikken dikkate alir). Parametre
 * adres cubugundan okunur ve httpClient her istege tasir.
 *
 * Kaybolmamasi gereken IKI gecis var — ikisinde de kaybolunca giris
 * sessizce HOST'un tenant'ina (Duosis) dusuyordu:
 *   1. Oturumsuz kullanicinin korunan sayfadan `/login`e yonlendirilmesi.
 *   2. Microsoft'a gidip `/auth/callback`e donus (redirect_uri sabittir;
 *      parametre OAuth `state` icinde tasinir).
 *
 * Slug'in tasinmasi YETKI VERMEZ: sunucu yine gecerli kimlik + o tenant'ta
 * AKTIF uyelik ister. Bu yuzden burada yalnizca bicim dogrulanir.
 * =============================================================================
 */

// Sunucudaki SLUG_RE ile ayni kume: kucuk harf, rakam, tire.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const STATE_PREFIX = 'ws:'

/** Gecerli bir workspace slug'i mi? */
export const isWorkspaceSlug = (value) =>
    typeof value === 'string' && SLUG_RE.test(value)

/** `location.search` icinden workspace slug'ini okur (gecersizse null). */
export const readWorkspace = (search) => {
    try {
        const ws = new URLSearchParams(search || '').get('workspace')
        return isWorkspaceSlug(ws) ? ws : null
    } catch {
        return null
    }
}

/** Giris sayfasi adresi — mevcut workspace KORUNARAK. */
export const loginPathFor = (search) => {
    const ws = readWorkspace(search)
    return ws ? `/login?workspace=${encodeURIComponent(ws)}` : '/login'
}

/*
 * `state` bicimi: `;` ile ayrilmis parcalar. Eski bicim (`ws:<slug>`)
 * AYNEN gecerlidir; "Oturumu acik tut" secimi ayri bir `rm:1` parcasi
 * olarak eklenir (ornek: `ws:acme;rm:1` ya da yalniz `rm:1`). Slug
 * kumesi `;` icermedigi icin ayrac belirsizlik yaratmaz.
 */
const PART_SEP = ';'
const REMEMBER_PART = 'rm:1'

const stateParts = (state) =>
    (typeof state === 'string' ? state.split(PART_SEP) : [])

/**
 * OAuth `state` degeri. Ne workspace ne de "acik tut" varsa null —
 * parametre hic eklenmez (Duosis'in authorize adresi birebir ayni kalir).
 */
export const encodeSsoState = (workspace, { remember = false } = {}) => {
    const parts = []
    if (isWorkspaceSlug(workspace)) parts.push(`${STATE_PREFIX}${workspace}`)
    if (remember === true) parts.push(REMEMBER_PART)
    return parts.length ? parts.join(PART_SEP) : null
}

/** Callback'te donen `state`ten workspace'i cozer (gecersizse null). */
export const decodeSsoState = (state) => {
    const part = stateParts(state).find((p) => p.startsWith(STATE_PREFIX))
    if (!part) return null
    const ws = part.slice(STATE_PREFIX.length)
    return isWorkspaceSlug(ws) ? ws : null
}

/** Callback'te donen `state`te "Oturumu acik tut" secili miydi? */
export const decodeSsoRemember = (state) =>
    stateParts(state).includes(REMEMBER_PART)

/**
 * Microsoft authorize adresi. Mevcut bicim AYNEN korunur (redirect_uri
 * token exchange'de ayni degerle gonderilir); workspace ya da "acik tut"
 * varsa yalnizca `state` eklenir.
 */
export const buildMicrosoftAuthorizeUrl = ({
    tenantId, clientId, origin, workspace = null, remember = false,
}) => {
    const redirectUri = origin + '/auth/callback'
    let url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=User.Read&prompt=select_account`
    const state = encodeSsoState(workspace, { remember })
    if (state) url += `&state=${encodeURIComponent(state)}`
    return url
}
