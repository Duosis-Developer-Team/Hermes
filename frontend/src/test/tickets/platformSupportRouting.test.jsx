/**
 * HERMES - Platform Console: tenant destek yonlendirmesi.
 *
 * Ekranin iki sozu var ve ikisi de test kilitli:
 *   1. Ticket ICERIGI gostermez (platform duzlemi yalnizca konfigurasyon).
 *   2. Yonlendirme, "kim acabilir"i belirlemez — o tenant RBAC'inin isi;
 *      ekran bunu ACIKCA yazar.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '../utils'

vi.mock('../../api/platformApi', () => ({
    platformService: {
        supportProviders: vi.fn(),
        supportRouting: vi.fn(),
        setSupportRouting: vi.fn(),
        disableSupportRouting: vi.fn(),
    },
}))

const { platformService } = await import('../../api/platformApi')
const { default: SupportRoutingTab } = await import(
    '../../pages/platform/SupportRoutingTab'
)

const PROVIDER = {
    tenant_id: 'prov-1',
    slug: 'duosis',
    display_name: 'Duosis',
    groups: [
        { id: 'g1', name: 'Technical Team', member_count: 2 },
        { id: 'g2', name: 'Platform Team', member_count: 3 },
    ],
}

const ROWS = [
    {
        tenant_id: 't1', slug: 'acme', display_name: 'Acme',
        tenant_status: 'active', enabled: false,
    },
    {
        tenant_id: 't2', slug: 'globex', display_name: 'Globex',
        tenant_status: 'active', enabled: true,
        provider_tenant_id: 'prov-1', group_id: 'g1',
        group_name: 'Technical Team', group_active: true, route_version: 2,
    },
]

beforeEach(() => {
    vi.clearAllMocks()
    platformService.supportProviders.mockResolvedValue({
        providers: [PROVIDER], module_state: 'ok',
    })
    platformService.supportRouting.mockResolvedValue(ROWS)
    platformService.setSupportRouting.mockResolvedValue({ enabled: true })
    platformService.disableSupportRouting.mockResolvedValue({ enabled: false })
})

describe('platform support routing', () => {
    it('yonlendirmesi OLMAYAN tenant da listede gorunur', async () => {
        renderWithProviders(<SupportRoutingTab />)
        // Aksi halde "ticket acamayan tenant" ekranda hic gorunmez ve
        // operator neyi acacagini bulamaz.
        expect(await screen.findByText('Acme')).toBeInTheDocument()
        expect(screen.getByText('Globex')).toBeInTheDocument()
    })

    it('kapali bir tenant acilinca route KURULUR', async () => {
        const user = userEvent.setup()
        renderWithProviders(<SupportRoutingTab />)
        const row = (await screen.findByText('Acme')).closest('tr')
        await user.click(within(row).getByRole('switch'))
        expect(platformService.setSupportRouting).toHaveBeenCalledWith('t1', {
            provider_tenant_id: 'prov-1', group_id: 'g1',
        })
    })

    it('acik bir tenant kapatilinca route PASIFE alinir', async () => {
        const user = userEvent.setup()
        renderWithProviders(<SupportRoutingTab />)
        const row = (await screen.findByText('Globex')).closest('tr')
        await user.click(within(row).getByRole('switch'))
        expect(platformService.disableSupportRouting)
            .toHaveBeenCalledWith('t2')
        expect(platformService.setSupportRouting).not.toHaveBeenCalled()
    })

    it('ekran, "kim acabilir" sorusunun tenant RBAC\'ine ait oldugunu SOYLER', async () => {
        renderWithProviders(<SupportRoutingTab />)
        expect(
            await screen.findByText(/tickets.access \/ tickets.create/),
        ).toBeInTheDocument()
        expect(
            screen.getByText(/existing tickets are never moved/),
        ).toBeInTheDocument()
    })

    it('tek saglayici varken bunu acikca yazar (secici yine de var)', async () => {
        renderWithProviders(<SupportRoutingTab />)
        expect(
            await screen.findByText(/One support provider is configured/),
        ).toBeInTheDocument()
    })

    it('modul yapilandirilmamissa tablo YERINE acik uyari cikar', async () => {
        platformService.supportProviders.mockResolvedValue({
            providers: [], module_state: 'not_configured',
        })
        renderWithProviders(<SupportRoutingTab />)
        expect(
            await screen.findByText(/support module is not configured/),
        ).toBeInTheDocument()
        expect(screen.queryByRole('switch')).toBeNull()
    })

    it('ekranda hicbir ticket icerigi gosterilmez', async () => {
        renderWithProviders(<SupportRoutingTab />)
        await screen.findByText('Acme')
        // Konfigurasyon ekrani: ticket kodu/baslik/mesaj sutunu YOK.
        expect(screen.queryByText(/TKT-/)).toBeNull()
        for (const header of ['Ticket', 'Subject', 'Message', 'Title']) {
            expect(screen.queryByRole('columnheader', { name: header }))
                .toBeNull()
        }
    })
})
