/**
 * =============================================================================
 * PM rework P3.1 — ana sayfa blok kompozisyonu (04-roller §3)
 * =============================================================================
 *   1. Efor seridi herkese; "Islerim" yalnizca is modulu erisimi olana.
 *   2. Izni olmayan blok icin uc HIC cagrilmaz.
 *   3. `/` artik Time Entry'ye yonlendirmez: ana sayfa aciliş ekranidir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

const homeService = { myWork: vi.fn() }
const capacityService = { getWeek: vi.fn() }
const taskPermissionService = { getMyPermissions: vi.fn() }
vi.mock('../../services/api', () => ({ homeService, capacityService, taskPermissionService }))

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'
const HomePage = (await import('../../pages/HomePage')).default

const EMPTY = { count: 0, groups: [] }

const signIn = () => useAuthStore.setState({
    user: { id: 'u1', email: 'ada@x.com', full_name: 'Ada Lovelace', is_admin: false },
    isAuthenticated: true,
    permissions: [],
})

beforeEach(() => {
    vi.clearAllMocks()
    resetAuthStore()
    signIn()
    capacityService.getWeek.mockResolvedValue({
        expected_total: '40', logged_total: '8', fill_percent: 20, days: [],
    })
    homeService.myWork.mockResolvedValue({
        today: '2026-09-16', week_start: '2026-09-14', week_end: '2026-09-20',
        overdue: EMPTY, due_today: EMPTY, this_week: EMPTY,
    })
})

describe('ana sayfa', () => {
    it('is erisimi olan kullanici: selamlama + efor seridi + Islerim', async () => {
        taskPermissionService.getMyPermissions.mockResolvedValue({
            is_admin: false, task: { can_access: true }, issue: { can_access: false },
        })
        renderWithProviders(<HomePage />)
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Ada')
        expect(await screen.findByText('8h of 40h logged')).toBeInTheDocument()
        expect(await screen.findByText('My work')).toBeInTheDocument()
        await waitFor(() => expect(homeService.myWork).toHaveBeenCalledTimes(1))
    })

    it('is erisimi olmayan kullanici: Islerim yok, ucu cagrilmaz', async () => {
        taskPermissionService.getMyPermissions.mockResolvedValue({
            is_admin: false, task: { can_access: false }, issue: { can_access: false },
        })
        renderWithProviders(<HomePage />)
        expect(await screen.findByText('8h of 40h logged')).toBeInTheDocument()
        await waitFor(() => expect(taskPermissionService.getMyPermissions).toHaveBeenCalled())
        expect(screen.queryByText('My work')).toBeNull()
        expect(homeService.myWork).not.toHaveBeenCalled()
    })
})
