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

export const useCustomerLogoStore = create((set) => ({
    etags: {},
    projects: {},
    setFromProjects: (projects) => set({ projects: indexOf(projects) }),
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
