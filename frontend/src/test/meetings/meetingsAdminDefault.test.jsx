/**
 * Toplantilar (CTO 05.10): meetings.admin yetkili kisi acilista KENDI
 * takvimini gorur (herkesin toplantisi tek ekranda karisikti); secimi
 * temizlerse "herkes" gorunumu yine mumkun.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'

const { meetingService, authService, workLogService } = vi.hoisted(() => ({
    meetingService: {
        list: vi.fn().mockResolvedValue([]),
        syncMe: vi.fn().mockResolvedValue({ ok: false }),
        syncUser: vi.fn().mockResolvedValue({ ok: false }),
    },
    authService: { lookupUsers: vi.fn().mockResolvedValue([{ id: 'u2', full_name: 'Bob', email: 'b@x.com' }]) },
    workLogService: { getMyLogs: vi.fn().mockResolvedValue([]), create: vi.fn() },
}))
vi.mock('../../services/api', () => ({ meetingService, authService, workLogService }))
vi.mock('../../components/modals/LogTimeModal', () => ({ default: () => null }))
vi.mock('../../components/modals/MeetingReviewModal', () => ({ default: () => null }))

import MeetingsPage from '../../pages/MeetingsPage'

afterEach(() => { resetAuthStore(); vi.clearAllMocks() })

describe('MeetingsPage admin default', () => {
    it('admin acilista yalniz kendi takvimini ister', async () => {
        useAuthStore.setState({
            user: { id: 'me', full_name: 'Admin Me' }, isAuthenticated: true,
            permissions: ['meetings.admin'],
        })
        renderWithProviders(<MeetingsPage />)
        await waitFor(() => expect(meetingService.list).toHaveBeenCalled())
        expect(meetingService.list.mock.calls[0][0]).toMatchObject({ user_ids: 'me' })
        // Kendi takvimi = token kapsamli sync (baskasinin adina degil).
        await waitFor(() => expect(meetingService.syncMe).toHaveBeenCalled())
        expect(meetingService.syncUser).not.toHaveBeenCalled()
    })
})
