/**
 * =============================================================================
 * Sprint 8 §B — List/Timesheet gorunum degistirici (GERCEK mount)
 * =============================================================================
 * KAPATILAN KUSUR: degistirici, a11y icin gercek <button>'a cevrilmis ama
 * native buton KROMU sifirlanmamisti — iki buyuk acik-gri sistem butonu
 * gibi gorunuyordu. Yeni sozlesme:
 *   - gercek tab semantigi (tablist/tab + aria-selected),
 *   - klavye ile calisir (focus + Enter),
 *   - AntD Button DEGIL, kendi sinifiyla stillenmis seffaf buton.
 * Davranis sozlesmesi AYNI kaldi: onViewModeChange(v) cagrilir, state
 * sahibi TimeEntryPage'dir.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TimeEntryHeader from '../../features/time-entry/components/TimeEntryHeader'

const renderHeader = (props = {}) =>
    render(
        <TimeEntryHeader
            canSelectUser={false}
            targetUserId="u1"
            usersList={[]}
            onSelectUser={vi.fn()}
            displayName="Ada Lovelace"
            exportLoading={false}
            onExport={vi.fn()}
            viewMode="list"
            onViewModeChange={vi.fn()}
            {...props}
        />
    )

const tablist = () => screen.getByRole('tablist', { name: /view/i })

describe('tab semantigi', () => {
    it('tablist icinde Iki gercek tab: List ve Timesheet', () => {
        renderHeader()
        const tabs = within(tablist()).getAllByRole('tab')
        expect(tabs.map((t) => t.textContent)).toEqual(['List', 'Timesheet'])
    })

    it('aria-selected YALNIZCA aktif gorunumde true', () => {
        renderHeader({ viewMode: 'timesheet' })
        const tabs = within(tablist()).getAllByRole('tab')
        expect(tabs[0].getAttribute('aria-selected')).toBe('false')
        expect(tabs[1].getAttribute('aria-selected')).toBe('true')
        expect(tabs[1].className).toContain('active')
        expect(tabs[0].className).not.toContain('active')
    })

    it('tiklama onViewModeChange(v) cagirir — state sahibi degismedi', async () => {
        const onViewModeChange = vi.fn()
        const user = userEvent.setup({ delay: null })
        renderHeader({ onViewModeChange })
        await user.click(screen.getByRole('tab', { name: 'Timesheet' }))
        expect(onViewModeChange).toHaveBeenCalledWith('timesheet')
    })

    it('klavye: tab odaklanabilir ve Enter aktive eder', async () => {
        const onViewModeChange = vi.fn()
        const user = userEvent.setup({ delay: null })
        renderHeader({ onViewModeChange })
        const tab = screen.getByRole('tab', { name: 'Timesheet' })
        tab.focus()
        expect(tab).toHaveFocus()
        await user.keyboard('{Enter}')
        expect(onViewModeChange).toHaveBeenCalledWith('timesheet')
    })
})

describe('native buton gorunumu geri DONMEZ', () => {
    it('tablar AntD Button degil (.ant-btn sinifi yasak)', () => {
        renderHeader()
        for (const tab of within(tablist()).getAllByRole('tab')) {
            expect(tab.className).not.toContain('ant-btn')
            expect(tab.className).toContain('view-link')
        }
    })
})


describe('Premium UI — Submit Period tamamen kalkti', () => {
    it('header Submit Period butonu/bolumu icermez', () => {
        renderHeader()
        expect(screen.queryByText(/Submit Period/i)).toBeNull()
        expect(document.querySelector('.submit-period-dropdown')).toBeNull()
    })
})
