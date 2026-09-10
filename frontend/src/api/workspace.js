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

/** OAuth `state` degeri (workspace yoksa null — parametre eklenmez). */
export const encodeSsoState = (workspace) =>
    isWorkspaceSlug(workspace) ? `${STATE_PREFIX}${workspace}` : null

/** Callback'te donen `state`ten workspace'i cozer (gecersizse null). */
export const decodeSsoState = (state) => {
    if (typeof state !== 'string' || !state.startsWith(STATE_PREFIX)) {
        return null
    }
    const ws = state.slice(STATE_PREFIX.length)
    return isWorkspaceSlug(ws) ? ws : null
}

/**
 * Microsoft authorize adresi. Mevcut bicim AYNEN korunur (redirect_uri
 * token exchange'de ayni degerle gonderilir); workspace varsa yalnizca
 * `state` eklenir.
 */
export const buildMicrosoftAuthorizeUrl = ({
    tenantId, clientId, origin, workspace = null,
}) => {
    const redirectUri = origin + '/auth/callback'
    let url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=User.Read&prompt=select_account`
    const state = encodeSsoState(workspace)
    if (state) url += `&state=${encodeURIComponent(state)}`
    return url
}
