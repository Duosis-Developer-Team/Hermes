/**
 * =============================================================================
 * HERMES - Profil fotografi dizini (Zustand)
 * =============================================================================
 * Kullanici id → foto etag'i. Kabuk (MainLayout) auth dizinini (`/users/
 * lookup`: has_photo + photo_etag) TEK sorguyla okuyup buraya yazar;
 * `Avatar` yalnizca bu depoyu okur. Boylece:
 *   - her avatar ayri istek atmaz (tarayici ETag + max-age ile onbellekler),
 *   - saglayicisiz render edilen bilesenler (components/tasks testleri)
 *     useQuery'ye bagimli olmaz.
 * Foto kaynagi: Microsoft girisinde Graph'tan alinan kucuk kopya (auth).
 * =============================================================================
 */
import { create } from 'zustand'

export const userPhotoUrl = (id, etag) =>
    `/api/v1/auth/users/${encodeURIComponent(id)}/photo?v=${encodeURIComponent(etag)}`

export const useUserPhotoStore = create((set) => ({
    etags: {},
    /** Dizin satirlarindan (id, has_photo, photo_etag) indeksi kurar. */
    setFromUsers: (users) => {
        const etags = {}
        for (const u of users || []) {
            if (u?.id && u.has_photo && u.photo_etag) etags[u.id] = u.photo_etag
        }
        set({ etags })
    },
}))
