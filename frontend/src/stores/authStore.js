/**
 * =============================================================================
 * HERMES PLATFORM - Auth Store (Zustand)
 * =============================================================================
 * Kullanıcı kimlik doğrulama durumunu yöneten global store.
 * JWT token ve kullanıcı bilgileri burada saklanır.
 * =============================================================================
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Auth Store
 * 
 * Saklanan veriler:
 * - token: JWT access token
 * - user: Giriş yapmış kullanıcı bilgileri
 * - isAuthenticated: Kullanıcı giriş yapmış mı?
 */
export const useAuthStore = create(
    persist(
        (set, get) => ({
            // =======================================================================
            // State
            // =======================================================================

            token: null,
            user: null,
            isAuthenticated: false,

            // =======================================================================
            // Actions
            // =======================================================================

            /**
             * Giriş yap
             * @param {string} token - JWT access token
             * @param {object} user - Kullanıcı bilgileri
             */
            login: (token, user) => {
                set({
                    token,
                    user,
                    isAuthenticated: true,
                })
            },

            /**
             * Çıkış yap
             */
            logout: () => {
                set({
                    token: null,
                    user: null,
                    isAuthenticated: false,
                })
            },

            /**
             * Kullanıcı bilgilerini güncelle
             * @param {object} userData - Güncellenecek kullanıcı bilgileri
             */
            updateUser: (userData) => {
                set((state) => ({
                    user: { ...state.user, ...userData },
                }))
            },

            // =======================================================================
            // Getters
            // =======================================================================

            /**
             * Kullanıcı admin mi?
             */
            isAdmin: () => {
                const { user } = get()
                return user?.is_admin === true
            },

            /**
             * Token'ı Authorization header formatında döner
             */
            getAuthHeader: () => {
                const { token } = get()
                return token ? { Authorization: `Bearer ${token}` } : {}
            },
        }),
        {
            name: 'hermes-auth', // localStorage key
            partialize: (state) => ({
                token: state.token,
                user: state.user,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
)

export default useAuthStore
