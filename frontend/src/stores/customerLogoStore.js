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
 * =============================================================================
 */
import { create } from 'zustand'

export const customerLogoUrl = (id, etag) =>
    `/api/v1/core/customers/${encodeURIComponent(id)}/logo?v=${encodeURIComponent(etag)}`

export const useCustomerLogoStore = create((set) => ({
    etags: {},
    /** Musteri satirlarindan (id, has_logo, logo_etag) indeksi kurar. */
    setFromCustomers: (customers) => {
        const etags = {}
        for (const c of customers || []) {
            if (c?.id && c.has_logo && c.logo_etag) etags[c.id] = c.logo_etag
        }
        set({ etags })
    },
    /** Tek musteri: etag null ise logo kaldirildi. */
    setOne: (id, etag) => set((s) => {
        const etags = { ...s.etags }
        if (etag) etags[id] = etag
        else delete etags[id]
        return { etags }
    }),
}))
