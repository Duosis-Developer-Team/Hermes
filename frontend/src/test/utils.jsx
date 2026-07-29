/**
 * HERMES - Test wrapper'lari (Sprint 1 §4): izole QueryClient (retry
 * kapali), MemoryRouter, AntD ConfigProvider, auth store reset helper.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { render } from '@testing-library/react'
import { makeQueryClient } from '../query/queryClient'
import { useAuthStore } from '../stores/authStore'

export const makeTestQueryClient = () =>
    makeQueryClient({ queries: { retry: false, staleTime: 0 } })

export function resetAuthStore() {
    useAuthStore.setState({
        user: null, isAuthenticated: false, permissions: null,
    })
}

export function renderWithProviders(ui, { route = '/', client } = {}) {
    const queryClient = client ?? makeTestQueryClient()
    const result = render(
        <QueryClientProvider client={queryClient}>
            <ConfigProvider>
                <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { ...result, queryClient }
}
