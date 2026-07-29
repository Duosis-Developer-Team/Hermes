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

    /**
     * RBAC R3: efektif izin listesi (/api/v1/auth/rbac/me).
     * TEK yetki kaynağı budur — is_admin yalnızca geçiş-dönemi rozeti.
     * null = henüz yüklenmedi (fail-closed: can() false döner).
     */
    permissions: null,

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
            permissions: null,
        })
    },

    /** RBAC izinlerini yükler (boot'ta /rbac/me yanıtından). */
    setPermissions: (permissions) => {
        set({ permissions: permissions || [] })
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

    /**
     * Kullanıcı admin mi? (GEÇİŞ DÖNEMİ — yeni kod can() kullanmalı.
     * Backend is_admin'i system-admin rolünden türettiği için doğru
     * kalır; ama granüler yetkiler için tek doğru soru can()'dır.)
     */
    isAdmin: () => {
        const { user } = get()
        return user?.is_admin === true
    },

    /** Verilen izinlerin TÜMÜ var mı? (fail-closed: yüklenmediyse false) */
    can: (...codes) => {
        const { permissions } = get()
        if (!permissions) return false
        return codes.every((c) => permissions.includes(c))
    },

    /** Verilen izinlerden EN AZ BİRİ var mı? */
    canAny: (...codes) => {
        const { permissions } = get()
        if (!permissions) return false
        return codes.some((c) => permissions.includes(c))
    },
}))

export default useAuthStore
