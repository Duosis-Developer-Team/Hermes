/**
 * =============================================================================
 * HERMES PLATFORM - Theme Store (Zustand)
 * =============================================================================
 * Light / dark mode toggle. Dark is the default (the original Hermes
 * look). The choice is a non-sensitive UI preference, so unlike the
 * auth token it IS persisted in localStorage.
 *
 * The active theme is reflected as data-theme="light|dark" on <html>;
 * all theming is driven from CSS variables keyed off that attribute
 * (see index.css), so toggling is a single attribute write.
 * =============================================================================
 */

import { create } from 'zustand'

const STORAGE_KEY = 'hermes-theme'

function readInitialTheme() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved === 'light' || saved === 'dark') return saved
    } catch {
        /* localStorage unavailable (private mode) — fall through */
    }
    return 'dark' // default: current dark look
}

function applyTheme(theme) {
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme)
    }
}

const initialTheme = readInitialTheme()
// Apply immediately at module load so there's no flash before React mounts.
applyTheme(initialTheme)

export const useThemeStore = create((set, get) => ({
    theme: initialTheme,

    setTheme: (theme) => {
        const next = theme === 'light' ? 'light' : 'dark'
        applyTheme(next)
        try {
            localStorage.setItem(STORAGE_KEY, next)
        } catch {
            /* ignore persistence failure */
        }
        set({ theme: next })
    },

    toggleTheme: () => {
        const next = get().theme === 'light' ? 'dark' : 'light'
        get().setTheme(next)
    },

    isLight: () => get().theme === 'light',
}))

export default useThemeStore
