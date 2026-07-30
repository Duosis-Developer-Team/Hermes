/**
 * =============================================================================
 * Sprint 6B.2 completion — Contract Status
 * =============================================================================
 * ONEMLI KAPSAM BULGUSU (kod okunarak dogrulandi): Contract Status bir
 * CRUD yuzeyi DEGILDIR. Iki sorgu (projects + billable summary) okur,
 * turetilmis sozlesme durumunu hesaplar ve gosterir. Create/Edit modali,
 * mutation, delete/archive ya da conflict akisi YOKTUR.
 *
 * Bu yuzden Admin CRUD sozlesmesinin su boyutlari bu yuzeyde UYGULANAMAZ
 * ve uydurulmadi: modal lifecycle, duplicate-submit kilidi, alan hatasi
 * eslemesi, destructive confirmation, mutation cache invalidasyonu.
 *
 * Uygulanabilen ve EKSIK olan boyutlar kapatildi:
 *   1. Iki sorgudan biri basarisiz olunca tablo SESSIZCE bosaliyordu:
 *      proje verisi gelmezse "sozlesme yok", kullanim verisi gelmezse
 *      "hic gun harcanmamis" gibi gorunuyordu. Ikisi de yaniltici.
 *   2. Ilk kullanim boslugu ile filtre sonucu yoklugu AYNI mesaji
 *      veriyordu.
 *   3. `p.name.toLowerCase()` null ada karsi korumasizdi — arama
 *      yazilmasi gerekmeden tum sayfa cokuyordu.
 *   4. Arama girdisinin erisilebilir adi yoktu.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const projectService = { getAll: vi.fn() }
const workLogService = { getBillableSummary: vi.fn() }

vi.mock('../../services/api', () => ({ projectService, workLogService }))

const ContractStatusPage = (await import('../../pages/admin/ContractStatusPage')).default
const { makeTestQueryClient } = await import('../utils')

const PROJECTS = [
    {
        id: 'p1', name: 'ATM Yenileme', customer_name: 'Vakko',
        contract_duration_days: 100, contract_start_date: '2026-01-01',
    },
    {
        id: 'p2', name: 'Mobil App', customer_name: 'Beko',
        contract_duration_days: 50, contract_start_date: '2026-02-01',
    },
    // Sozlesme suresi YOK → listelenmez (mevcut sozlesme).
    { id: 'p3', name: 'Ic Proje', customer_name: null },
]

// p1: 80 gun kullanildi (640/8) → %80 → critical
// p2: 10 gun kullanildi (80/8)  → %20 → safe
const BILLABLE = { data: { p1: 640, p2: 80 } }

const setupUser = () => userEvent.setup({ delay: null })
const httpError = (status, data) => ({ response: { status, data } })

const renderPage = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ContractStatusPage />
        </QueryClientProvider>
    )

beforeEach(() => {
    vi.clearAllMocks()
    projectService.getAll.mockResolvedValue(PROJECTS.map((p) => ({ ...p })))
    workLogService.getBillableSummary.mockResolvedValue(BILLABLE)
})

describe('KARAKTERIZASYON — turetilmis sozlesme durumu', () => {
    it('yalnizca sozlesme suresi OLAN projeler listelenir', async () => {
        renderPage()
        expect(await screen.findByText('ATM Yenileme')).toBeInTheDocument()
        expect(screen.getByText('Mobil App')).toBeInTheDocument()
        // Sozlesme suresi olmayan proje bu tabloda YOKTUR.
        expect(screen.queryByText('Ic Proje')).not.toBeInTheDocument()
    })

    it('kalan gun EN AZ olan en ustte gosterilir', async () => {
        renderPage()
        await screen.findByText('ATM Yenileme')
        const rows = screen.getAllByRole('row').map((r) => r.textContent || '')
        const iAtm = rows.findIndex((t) => t.includes('ATM Yenileme'))
        const iMobil = rows.findIndex((t) => t.includes('Mobil App'))
        // p1: 100-80 = 20 kalan; p2: 50-10 = 40 kalan → p1 once.
        expect(iAtm).toBeLessThan(iMobil)
    })

    it('kayit sayisi bildirilir', async () => {
        renderPage()
        expect(await screen.findByText('2 records found')).toBeInTheDocument()
    })
})

describe('arama', () => {
    it('musteri ve proje adinda arar', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('ATM Yenileme')
        await user.type(
            screen.getByLabelText('Search contracts by customer or project'),
            'Beko'
        )
        await waitFor(() =>
            expect(screen.queryByText('ATM Yenileme')).not.toBeInTheDocument()
        )
        expect(screen.getByText('Mobil App')).toBeInTheDocument()
    })

    it('arama girdisinin ERISILEBILIR ADI vardir', async () => {
        renderPage()
        await screen.findByText('ATM Yenileme')
        expect(screen.getByLabelText('Search contracts by customer or project'))
            .toBeInTheDocument()
    })

    it('ILK KULLANIM boslugu ile FILTRE sonucu yoklugu AYRI mesajlanir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('ATM Yenileme')
        await user.type(
            screen.getByLabelText('Search contracts by customer or project'),
            'zzzz'
        )
        expect(await screen.findByText(/No contracts match “zzzz”/))
            .toBeInTheDocument()

        // Hic sozlesme verisi olmayan durum FARKLI konusur.
        projectService.getAll.mockResolvedValue([])
        renderPage()
        expect(await screen.findByText(/Add contract duration to your projects/))
            .toBeInTheDocument()
    })

    it('KUSUR: null proje adi sayfayi COKERTMEZ', async () => {
        projectService.getAll.mockResolvedValue([
            { id: 'p9', name: null, customer_name: 'Nullco', contract_duration_days: 10 },
        ])
        const user = setupUser()
        renderPage()
        // Eski davranista `p.name.toLowerCase()` burada patliyordu.
        expect(await screen.findByText('Nullco')).toBeInTheDocument()
        await user.type(
            screen.getByLabelText('Search contracts by customer or project'),
            'Null'
        )
        expect(screen.getByText('Nullco')).toBeInTheDocument()
    })
})

describe('yukleme hatalari SESSIZ bosluk uretmez', () => {
    it('proje sorgusu basarisiz olunca hata + RETRY sunulur', async () => {
        projectService.getAll.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderPage()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        expect(screen.getByText(/server had a problem/i)).toBeInTheDocument()
        projectService.getAll.mockResolvedValue(PROJECTS)
        await user.click(retry)
        expect(await screen.findByText('ATM Yenileme')).toBeInTheDocument()
    })

    it('KULLANIM sorgusu basarisiz olunca hesaplanamadigi ACIKCA soylenir', async () => {
        // Bu en yaniltici hal: projeler gelir, kullanim gelmez → her
        // sozlesme "hic gun harcanmamis" gibi gorunur.
        workLogService.getBillableSummary.mockRejectedValueOnce(httpError(500, {}))
        renderPage()
        expect(
            await screen.findByText(/Contract usage cannot be calculated/)
        ).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('teknik govde kullaniciya SIZMAZ', async () => {
        projectService.getAll.mockRejectedValueOnce(
            httpError(500, { detail: 'psycopg2.OperationalError: boom' })
        )
        renderPage()
        await screen.findByRole('button', { name: 'Retry' })
        expect(screen.queryByText(/psycopg2/)).not.toBeInTheDocument()
    })
})
