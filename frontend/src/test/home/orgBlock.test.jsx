/**
 * =============================================================================
 * PM rework P3.3 — "Organizasyon ozeti" (D6)
 * =============================================================================
 *   1. Donem KPI'lari: toplam efor, faturalanabilir oran, musteri kirilimi.
 *   2. Sinyaller sunucu `level`ine gore: warn one cikar, ok notr.
 *   3. Gecikmis sinyali bu haftaki artisi tasir; kisayollar mevcut
 *      rapor sayfalarina gider; dashboard detay olarak baglidir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'

const homeService = { org: vi.fn() }
vi.mock('../../services/api', () => ({ homeService }))

import { renderWithProviders } from '../utils'
const OrgBlock = (await import('../../features/home/components/OrgBlock')).default

const ORG = {
    period_start: '2026-09-01', period_end: '2026-09-16', total_hours: '18.00', billable_hours: '14.00',
    billable_ratio: 78,
    by_customer: [{ name: 'Vakko', hours: '12.50' }, { name: 'Beymen', hours: '5.50' }],
    signals: [
        { key: 'no_entry_users', value: 0, delta: null, threshold: 1, level: 'ok' },
        { key: 'overdue', value: 5, delta: 2, threshold: 5, level: 'warn' },
        { key: 'unassigned', value: 1, delta: null, threshold: 3, level: 'ok' },
    ],
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('Organizasyon ozeti', () => {
    it('KPI, sinyal seviyeleri ve kisayollar', async () => {
        homeService.org.mockResolvedValue(ORG)
        renderWithProviders(<OrgBlock />)
        expect(await screen.findByText('18h')).toBeInTheDocument()
        expect(screen.getByText('78%')).toBeInTheDocument()
        expect(screen.getByText('14h')).toBeInTheDocument()
        expect(screen.getByText('01 Sep – 16 Sep')).toBeInTheDocument()

        const signals = document.querySelectorAll('.home-org__signal')
        expect([...signals].map((s) => `${s.dataset.signal}:${s.dataset.level}`)).toEqual([
            'no_entry_users:ok', 'overdue:warn', 'unassigned:ok',
        ])
        expect(signals[1].className).toContain('home-org__signal--warn')
        expect(signals[0].className).not.toContain('home-org__signal--warn')
        expect(within(signals[1]).getByText('(+2 this week)')).toBeInTheDocument()

        const customers = document.querySelectorAll('.home-org__customer')
        expect([...customers].map((c) => c.textContent)).toEqual(['Vakko12.5h', 'Beymen5.5h'])

        expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/management/reports')
        expect(screen.getByRole('link', { name: 'Billable Hours' })).toHaveAttribute('href', '/management/billable-hours')
        expect(screen.getByRole('link', { name: 'Contract Status' })).toHaveAttribute('href', '/management/contracts')
        expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
    })

    it('oran yokken tire, efor yokken sessiz satir', async () => {
        homeService.org.mockResolvedValue({ ...ORG, total_hours: '0', billable_hours: '0', billable_ratio: null, by_customer: [] })
        renderWithProviders(<OrgBlock />)
        expect(await screen.findByText('—')).toBeInTheDocument()
        expect(screen.getByText('No effort in this period.')).toBeInTheDocument()
    })
})
