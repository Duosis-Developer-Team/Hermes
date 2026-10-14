/**
 * =============================================================================
 * HERMES - Musteri logosu dizini (Zustand)
 * =============================================================================
 * Musteri id → logo etag'i. Kabuk (MainLayout) musteri listesini (has_logo
 * + logo_etag) TEK sorguyla okuyup buraya yazar; `CustomerLogo` yalnizca
 * bu depoyu okur (userPhotoStore ile ayni desen):
 *   - her logo ayri istek atmaz (tarayici ETag + max-age ile onbellekler),
 *   - saglayicisiz render edilen kartlar (components/tasks, time-entry
 *     testleri) useQuery'ye bagimli olmaz.
 * Logo yuklenince/kaldirilinca `setOne` aninda gunceller (liste yeniden
 * gelene kadar beklenmez).
 *
 * Proje logolari (29.09) AYNI depoda ayri haritada: `projects` (proje id →
 * etag), `setFromProjects` / `setProject`. BrandLogos ikisini birlikte okur.
 *
 * Jenerik proje logolari (05.10): `generic` (proje id → { glyph, color }).
 * Renk projenin TURUNDEN gelir; tur rengi degisince proje listesi yeniden
 * gelir ve tum jenerik logolar yeni renge gecer. Yuklenmis logo onceliklidir.
 * =============================================================================
 */
import { create } from 'zustand'

export const customerLogoUrl = (id, etag) =>
    `/api/v1/core/customers/${encodeURIComponent(id)}/logo?v=${encodeURIComponent(etag)}`

export const projectLogoUrl = (id, etag) =>
    `/api/v1/core/projects/${encodeURIComponent(id)}/logo?v=${encodeURIComponent(etag)}`

const indexOf = (rows) => {
    const out = {}
    for (const r of rows || []) {
        if (r?.id && r.has_logo && r.logo_etag) out[r.id] = r.logo_etag
    }
    return out
}

const genericOf = (rows) => {
    const out = {}
    for (const r of rows || []) {
        if (r?.id && r.logo_glyph) out[r.id] = { glyph: r.logo_glyph, color: r.project_type_color || null }
    }
    return out
}

export const useCustomerLogoStore = create((set) => ({
    etags: {},
    projects: {},
    generic: {},
    setFromProjects: (projects) => set({ projects: indexOf(projects), generic: genericOf(projects) }),
    /** Tek projenin jenerik logosu (kaydedince aninda; liste beklenmez). */
    setProjectGeneric: (id, glyph, color) => set((s) => {
        const generic = { ...s.generic }
        if (glyph) generic[id] = { glyph, color: color || null }
        else delete generic[id]
        return { generic }
    }),
    setProject: (id, etag) => set((s) => {
        const projects = { ...s.projects }
        if (etag) projects[id] = etag
        else delete projects[id]
        return { projects }
    }),
    /** Musteri satirlarindan (id, has_logo, logo_etag) indeksi kurar. */
    setFromCustomers: (customers) => set({ etags: indexOf(customers) }),
    /** Tek musteri: etag null ise logo kaldirildi. */
    setOne: (id, etag) => set((s) => {
        const etags = { ...s.etags }
        if (etag) etags[id] = etag
        else delete etags[id]
        return { etags }
    }),
}))
