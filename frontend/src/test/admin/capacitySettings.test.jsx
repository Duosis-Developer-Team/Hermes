/**
 * =============================================================================
 * PM rework P0 / D1 — kapasite ayarlari sayfasi
 * =============================================================================
 *   1. Varsayilan yokken bunu SOYLER (sessiz 8h/Pzt-Cum sanilmasin).
 *   2. Kaydet, normalize edilmis govdeyle updateSettings cagirir.
 *   3. Tatil listesi render edilir; silme deleteHoliday'i cagirir.
 *   4. Override listesi kisi adiyla gosterilir; bos alan "default" etiketi.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../services/api', () => ({
    authService: {
        lookupUsers: vi.fn(() => Promise.resolve([
            { id: 'u1', full_name: 'Arca N.', email: 'arca@x.com' },
        ])),
    },
    capacityService: {
        getSettings: vi.fn(() => Promise.resolve({
            daily_expected_hours: '8.00', working_days: [1, 2, 3, 4, 5], is_default: true,
        })),
        updateSettings: vi.fn((v) => Promise.resolve({ ...v, is_default: false })),
        listHolidays: vi.fn(() => Promise.resolve([
            { id: 'h1', holiday_date: '2026-10-29', name: 'Cumhuriyet Bayrami' },
        ])),
        addHoliday: vi.fn(), deleteHoliday: vi.fn(() => Promise.resolve()),
        listOverrides: vi.fn(() => Promise.resolve([
            { user_id: 'u1', daily_expected_hours: '6.00', working_days: null },
        ])),
        upsertOverride: vi.fn(), deleteOverride: vi.fn(),
    },
}))

import CapacitySettingsPage from '../../pages/admin/CapacitySettingsPage'
import { capacityService } from '../../services/api'
import { renderWithProviders } from '../utils'

describe('kapasite ayarlari', () => {
    beforeEach(() => { capacityService.updateSettings.mockClear(); capacityService.deleteHoliday.mockClear() })

    it('varsayilan yokken bunu soyler ve kaydet normalize govde gonderir', async () => {
        renderWithProviders(<CapacitySettingsPage />)
        expect(await screen.findByText(/built-in default/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(capacityService.updateSettings).toHaveBeenCalledTimes(1))
        expect(capacityService.updateSettings).toHaveBeenCalledWith({
            daily_expected_hours: 8, working_days: [1, 2, 3, 4, 5],
        })
    })

    it('tatiller listelenir ve silinir', async () => {
        renderWithProviders(<CapacitySettingsPage />)
        expect(await screen.findByText('Cumhuriyet Bayrami')).toBeInTheDocument()
        const row = screen.getByText('Cumhuriyet Bayrami').closest('tr')
        fireEvent.click(row.querySelector('button[aria-label="Delete"]'))
        fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
        await waitFor(() => expect(capacityService.deleteHoliday).toHaveBeenCalledWith('h1'))
    })

    it('override kisi adiyla ve bos alan "default" etiketiyle gosterilir', async () => {
        renderWithProviders(<CapacitySettingsPage />)
        expect(await screen.findByText('Arca N.')).toBeInTheDocument()
        expect(screen.getByText('6h')).toBeInTheDocument()
        expect(screen.getAllByText('default').length).toBeGreaterThan(0)
    })
})
