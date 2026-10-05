/**
 * =============================================================================
 * HERMES - Proje turu renkleri (TEK kaynak)
 * =============================================================================
 * Yonetici proje turune serbest hex DEGIL, bu ana renklerden birini secer.
 * Her renk jenerik logonun iki tonlu degradesidir (from → to, sol ustten
 * sag alta) ve secicide renk ornegi olarak gosterilir.
 *
 * Anahtarlar sunucudaki sozlukle birebir:
 *   backend/core-service/app/project_type_catalog.py PROJECT_TYPE_COLORS
 * (tests/test_project_types.py parite testi bu dosyayi okur.)
 * =============================================================================
 */

export const PROJECT_TYPE_PALETTE = {
    red: { from: '#F87171', to: '#B91C1C' },
    orange: { from: '#FB923C', to: '#C2410C' },
    amber: { from: '#FBBF24', to: '#C2410C' },
    yellow: { from: '#FDE047', to: '#CA8A04' },
    green: { from: '#4ADE80', to: '#15803D' },
    teal: { from: '#2DD4BF', to: '#0F766E' },
    cyan: { from: '#22D3EE', to: '#0E7490' },
    blue: { from: '#4F8CFF', to: '#1D4ED8' },
    indigo: { from: '#8B7BFF', to: '#4338CA' },
    violet: { from: '#C084FC', to: '#7E22CE' },
    pink: { from: '#F472B6', to: '#BE185D' },
    slate: { from: '#64748B', to: '#1E293B' },
}

export const PROJECT_TYPE_COLOR_KEYS = Object.keys(PROJECT_TYPE_PALETTE)

/** Turu olmayan projenin jenerik logosu: notr gri (secilebilir renk DEGIL). */
export const NEUTRAL_TONE = { from: '#9AA6B8', to: '#4B5567' }

export const toneOf = (color) => PROJECT_TYPE_PALETTE[color] || NEUTRAL_TONE
