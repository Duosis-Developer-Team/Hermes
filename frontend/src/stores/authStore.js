/**
 * =============================================================================
 * HERMES PLATFORM - Auth Store (Zustand)
 * =============================================================================
 * [KRİTİK-6] localStorage persist kaldırıldı.
 *
 * Önceki mimari (GÜVENSİZ):
 *   JWT token → Zustand persist → localStorage["hermes-auth"]
 *   Risk: Her XSS payload'u localStorage.getItem() ile token'ı çalar.
 *
 * Yeni mimari (GÜVENLİ):
 *   JWT token → HttpOnly cookie (backend /auth/token endpoint'i tarafından set edilir)
 *   Tarayıcı, cookie'yi JS'e hiçbir zaman açıklamaz (httponly=true).
 *   Axios withCredentials:true ile cookie otomatik her istekte gönderilir.
 *
 * Bu store yalnızca UI state'i tutar (kullanıcı bilgisi, oturum durumu).
 * Token bilgisi ASLA frontend state'inde veya localStorage'da saklanmaz.
 * =============================================================================
 */

import { create } from 'zustand'

export const useAuthStore = create((set, get) => ({
    // =========================================================================
    // State — Token YOK, yalnızca kullanıcı bilgisi ve oturum durumu
    // =========================================================================

    /** Veritabanından gelen kullanıcı nesnesi (id, email, is_admin, vb.) */
    user: null,

    /** Kullanıcı aktif oturumda mı? */
    isAuthenticated: false,

    // =========================================================================
    // Actions
    // =========================================================================

    /**
     * Başarılı giriş sonrası çağrılır.
     * Backend cookie'yi zaten set etmiştir; burada yalnızca kullanıcı bilgisi saklanır.
     *
     * @param {object} user - Backend'den dönen kullanıcı nesnesi
     */
    login: (user) => {
        set({
            user,
            isAuthenticated: true,
        })
    },

    /**
     * Oturumu kapatır.
     * Backend /auth/logout endpoint'i cookie'yi siler;
     * bu fonksiyon yalnızca UI state'ini temizler.
     */
    logout: () => {
        set({
            user: null,
            isAuthenticated: false,
        })
    },

    /**
     * Kullanıcı bilgilerini günceller (profil güncellemesi vb.).
     * @param {object} userData - Güncellenecek alanlar
     */
    updateUser: (userData) => {
        set((state) => ({
            user: { ...state.user, ...userData },
        }))
    },

    // =========================================================================
    // Getters
    // =========================================================================

    /** Kullanıcı admin mi? */
    isAdmin: () => {
        const { user } = get()
        return user?.is_admin === true
    },
}))

export default useAuthStore
