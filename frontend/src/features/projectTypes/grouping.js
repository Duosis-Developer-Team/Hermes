/**
 * =============================================================================
 * HERMES - Projeleri ture gore gruplama (efor girisi proje adimi)
 * =============================================================================
 * Saf fonksiyon: turlu gruplar ada gore (Turkce sirali), tursuz projeler
 * EN SONDA tek grup. Grup ici proje sirasi korunur. Hic turlu proje yoksa
 * tek grup doner — arayuz baslik cizmez (eski gorunum aynen kalir).
 * =============================================================================
 */
export const UNTYPED = '__untyped__'

export function groupProjectsByType(projects, untypedLabel) {
    const groups = new Map()
    for (const p of projects || []) {
        const key = p.project_type_id || UNTYPED
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                name: p.project_type_id ? (p.project_type_name || '') : untypedLabel,
                color: p.project_type_id ? p.project_type_color : null,
                projects: [],
            })
        }
        groups.get(key).projects.push(p)
    }
    const typed = [...groups.values()]
        .filter((g) => g.key !== UNTYPED)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    const rest = groups.get(UNTYPED)
    return rest ? [...typed, rest] : typed
}
