/**
 * =============================================================================
 * HERMES - Platform Admin oturum store'u (WS9)
 * =============================================================================
 * Tenant oturumundan TAMAMEN AYRI tutulur ve bu AYRILIK bilinclidir:
 *
 *   - ayri cookie (`hermes_platform_session`, yalnizca /api/platform
 *     yoluna gonderilir) ve ayri JWT audience;
 *   - ayri izin katalogu (`platform.*`);
 *   - ayri store: tenant `useAuthStore`'u ile TEK BIR alan bile
 *     paylasilmaz. Ortak bir store, bir duzlemin state'inin digerine
 *     sizmasi icin en kolay yol olurdu.
 *
 * Bu store da token TUTMAZ — oturum HttpOnly cookie'dedir.
 */
import { create } from 'zustand'

export const usePlatformAuthStore = create((set, get) => ({
    /** Platform operatoru ({id, email, full_name}) */
    admin: null,

    isAuthenticated: false,

    /**
     * Efektif platform izinleri (`platform.*`).
     * null = henuz yuklenmedi → can() fail-closed false doner.
     */
    permissions: null,

    login: (admin, permissions) => {
        set({
            admin,
            permissions: permissions || [],
            isAuthenticated: true,
        })
    },

    logout: () => {
        set({ admin: null, permissions: null, isAuthenticated: false })
    },

    setPermissions: (permissions) => set({ permissions: permissions || [] }),

    /** Verilen platform izinlerinin TUMU var mi? (fail-closed) */
    can: (...codes) => {
        const { permissions } = get()
        if (!permissions) return false
        return codes.every((c) => permissions.includes(c))
    },
}))

export default usePlatformAuthStore
