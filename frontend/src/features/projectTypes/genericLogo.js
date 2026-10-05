/**
 * =============================================================================
 * HERMES - Jenerik proje logosu: tur rengi + glif → SVG
 * =============================================================================
 * Cerceve onaylanan ikon sistemiyle birebir: 256 px karo (r=62), iki tonlu
 * degrade, sol ust isik, ince beyaz ic kenar; uzerinde beyaz glif.
 * Cikti bir data: URI'dir — <img> ile cizilir (innerHTML yok, ayni logo
 * karosu bileseniyle gosterilir). Ayni girdi icin sonuc onbellektedir.
 * =============================================================================
 */
import { LOGO_GLYPHS } from './glyphs'
import { toneOf } from './palette'

const cache = new Map()

export function genericLogoSvg(glyph, color) {
    const body = LOGO_GLYPHS[glyph]
    if (!body) return null
    const { from, to } = toneOf(color)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
        + '<defs>'
        + `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
        + '<radialGradient id="h" cx=".18" cy=".1" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient>'
        + '</defs>'
        + '<rect width="256" height="256" rx="62" fill="url(#g)"/>'
        + '<rect width="256" height="256" rx="62" fill="url(#h)"/>'
        + '<rect x="2" y="2" width="252" height="252" rx="60" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="3"/>'
        + body.split('{{C2}}').join(to)
        + '</svg>'
}

/** <img src> icin data: URI (null: bilinmeyen glif). */
export function genericLogoUrl(glyph, color) {
    const key = `${glyph}|${color || ''}`
    if (!cache.has(key)) {
        const svg = genericLogoSvg(glyph, color)
        cache.set(key, svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null)
    }
    return cache.get(key)
}
