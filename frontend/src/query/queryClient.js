/**
 * =============================================================================
 * HERMES - Merkezi QueryClient (Sprint 1, CTO paketi §8)
 * =============================================================================
 * Uygulamanin TEK QueryClient'i. Ayarlar main.jsx'ten tasindi; test
 * wrapper'i (src/test/) kendi izole client'ini ayni fabrikadan uretir.
 */
import { QueryClient } from '@tanstack/react-query'

export const makeQueryClient = (overrides = {}) =>
    new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 5 * 60 * 1000, // 5 dakika
                retry: 1,
                refetchOnWindowFocus: false,
                ...overrides.queries,
            },
            ...(overrides.mutations
                ? { mutations: overrides.mutations }
                : {}),
        },
    })

export const queryClient = makeQueryClient()
