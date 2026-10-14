/**
 * HERMES - Dalga D4 e-posta kanali ayari — istemci.
 *   Anahtar degisince TAM ayar govdesi kaydedilir; gonderim kapaliysa uyari;
 *   gelen kutusu yoksa acma anahtari hic cizilmez; varsa adres kopyalanabilir;
 *   son gonderimler durum + talep numarasi + maskeli aliciyla listelenir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'

vi.mock('../../api/ticketsApi', async () => {
    const actual = await vi.importActual('../../api/ticketsApi')
    return {
        ...actual,
        ticketHelpdeskService: { mail: vi.fn(), updateMail: vi.fn() },
    }
})

const { ticketHelpdeskService } = await import('../../api/ticketsApi')
const { default: MailTab } = await import('../../pages/tickets/MailTab')

const BASE = {
    requester_enabled: true, agent_enabled: true, language: 'tr', inbound_enabled: false,
    outbound_ready: true, sender: 'hermes@duosis.com', inbound_configured: false, inbound_address: null,
    counts_7d: { sent: 3, pending: 1, failed: 0, skipped: 0 },
    recent: [{
        id: 'r1', kind: 'reply', audience: 'requester', status: 'sent', recipient: 'm***i@acme.com',
        ticket_number: 'TKT-000042', attempts: 1, last_error: null,
        created_at: '2026-10-14T08:00:00Z', sent_at: '2026-10-14T08:01:00Z',
    }],
}

beforeEach(() => {
    resetAuthStore()
    vi.clearAllMocks()
})

describe('e-posta sekmesi', () => {
    it('anahtar tum ayari kaydeder; son gonderimleri listeler', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        ticketHelpdeskService.mail.mockResolvedValue(BASE)
        ticketHelpdeskService.updateMail.mockImplementation(async (body) => ({ ...BASE, ...body }))
        renderWithProviders(<MailTab />)
        expect(await screen.findByText('E-mails are sent from hermes@duosis.com.')).toBeInTheDocument()
        expect(screen.getByText('Reply to requester')).toBeInTheDocument()
        expect(screen.getByText(/TKT-000042 · m\*\*\*i@acme\.com/)).toBeInTheDocument()
        expect(screen.getByText(/3 sent · 1 queued/)).toBeInTheDocument()
        // Gelen kutusu sunucuda yok: acma anahtari cizilmez.
        expect(screen.queryByRole('switch', { name: 'Accept requests by e-mail' })).toBeNull()

        await user.click(screen.getByRole('switch', { name: 'E-mail the team' }))
        await waitFor(() => expect(ticketHelpdeskService.updateMail).toHaveBeenCalledWith({
            requester_enabled: true, agent_enabled: false, language: 'tr', inbound_enabled: false,
        }))
        await waitFor(() => expect(screen.getByRole('switch', { name: 'E-mail the team' })).not.toBeChecked())
    })

    it('gonderim kapaliysa uyarir; gelen kutusu varsa adresi gosterir', async () => {
        ticketHelpdeskService.mail.mockResolvedValue({
            ...BASE, outbound_ready: false, sender: null, inbound_configured: true,
            inbound_address: 'talep+acme@duosis.com', recent: [],
        })
        renderWithProviders(<MailTab />)
        expect(await screen.findByText(/E-mail delivery is off or not configured/)).toBeInTheDocument()
        expect(screen.getByRole('switch', { name: 'Accept requests by e-mail' })).toBeInTheDocument()
        expect(screen.getByText('talep+acme@duosis.com')).toBeInTheDocument()
        expect(screen.getByText('No e-mail has been sent yet.')).toBeInTheDocument()
    })
})
