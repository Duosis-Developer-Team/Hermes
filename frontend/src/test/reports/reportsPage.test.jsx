/**
 * =============================================================================
 * Sprint 6A/6C — Reports yuzeyi
 * =============================================================================
 * Kilitlenen gercek kusurlar:
 *   1. CSV export'ta cift tetikleme korumasi yalnizca butonun `disabled`
 *      gorunumune dayaniyordu; `disabled` bir render GEC geldigi icin
 *      arada ikinci indirme baslayabiliyordu.
 *   2. Basarisiz indirme BASARI gibi konusuluyordu: mutation cozulur
 *      cozulmez "CSV export started" deniyordu ve hata yolunda generic
 *      "Export failed" gosteriliyordu.
 *   3. Liste hatasi HIC gosterilmiyordu: sorgu patlayinca tablo sessizce
 *      bosaliyor, kullanici "kayit yok" saniyordu.
 *   4. `keepPreviousData` TanStack Query v5'te KALDIRILDI ve sessizce yok
 *      sayiliyordu → her filtre degisiminde tablo bosalip doluyordu.
 *
 * Indirilen dosyanin filtresi ile EKRANDAKI filtre ayni degerlerden
 * uretilir; bu da dogrulanir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const reportsService = { getJsonUserLogs: vi.fn(), exportExcel: vi.fn() }
const authService = { getUsers: vi.fn() }
const customerService = { getAll: vi.fn() }
const projectService = { getAll: vi.fn() }
const workTypeService = { getAll: vi.fn() }
const platformService = { getAll: vi.fn() }

vi.mock('../../services/api', () => ({
    reportsService, authService, customerService, projectService,
    workTypeService, platformService,
}))

const ReportsPage = (await import('../../pages/ReportsPage')).default
const { makeTestQueryClient, resetAuthStore } = await import('../utils')
const { useAuthStore } = await import('../../stores/authStore')

const LOGS = [
    {
        date: '2026-07-01', user_name: 'Ada Lovelace', customer_name: 'Vakko',
        project_name: 'ATM Yenileme', work_type: 'Development',
        platform: 'Backend', duration: 4, description: 'API work',
    },
    {
        date: '2026-07-02', user_name: 'Bob Bit', customer_name: 'Beko',
        project_name: 'Mobil App', work_type: 'Testing',
        platform: 'Frontend', duration: 2, description: 'Regression',
    },
]

const setupUser = () => userEvent.setup({ delay: null })
const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}
const httpError = (status, data) => ({ response: { status, data } })

const renderReports = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ReportsPage />
        </QueryClientProvider>
    )

beforeEach(() => {
    vi.clearAllMocks()
    resetAuthStore()
    // Rota zaten `reports.view` ile korunur; sayfa da savunma katmani
    // olarak ayni izne bakar.
    useAuthStore.setState({
        user: { id: 'u1', email: 'ada@x.com', full_name: 'Ada' },
        isAuthenticated: true,
        permissions: ['reports.view'],
    })
    reportsService.getJsonUserLogs.mockResolvedValue({ data: LOGS })
    reportsService.exportExcel.mockResolvedValue({ filename: 'hermes_rapor.csv' })
    authService.getUsers.mockResolvedValue({ data: [] })
    customerService.getAll.mockResolvedValue([])
    projectService.getAll.mockResolvedValue([])
    workTypeService.getAll.mockResolvedValue([])
    platformService.getAll.mockResolvedValue([])
})

describe('liste durumlari', () => {
    it('kayitlar listelenir', async () => {
        renderReports()
        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
        expect(screen.getByText('Bob Bit')).toBeInTheDocument()
    })

    it('SESSIZ bos tablo YOK — hata + RETRY sunulur', async () => {
        reportsService.getJsonUserLogs.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderReports()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        expect(screen.getByText(/server had a problem/i)).toBeInTheDocument()
        reportsService.getJsonUserLogs.mockResolvedValue({ data: LOGS })
        await user.click(retry)
        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    })

    it('teknik govde kullaniciya SIZMAZ', async () => {
        reportsService.getJsonUserLogs.mockRejectedValueOnce(
            httpError(500, { detail: 'psycopg2.OperationalError: boom' })
        )
        renderReports()
        await screen.findByRole('button', { name: 'Retry' })
        expect(screen.queryByText(/psycopg2/)).not.toBeInTheDocument()
    })

    it('kayit yoksa filtre dilinde bos durum gosterilir', async () => {
        reportsService.getJsonUserLogs.mockResolvedValue({ data: [] })
        renderReports()
        expect(await screen.findByText(/No entries match the current filters/))
            .toBeInTheDocument()
    })
})

describe('CSV export', () => {
    it('EKRANDAKI filtrelerle ayni parametreleri gonderir', async () => {
        const user = setupUser()
        renderReports()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: /Download CSV/i }))
        await waitFor(() => expect(reportsService.exportExcel).toHaveBeenCalled())
        const params = reportsService.exportExcel.mock.calls[0][0]
        // Tablo sorgusu da ayni tarih araligini kullanir.
        const queryParams = reportsService.getJsonUserLogs.mock.calls[0][0]
        expect(params.start_date).toBe(queryParams.start_date)
        expect(params.end_date).toBe(queryParams.end_date)
    })

    it('PENDING iken ikinci tiklama YENI indirme ACMAZ', async () => {
        const gate = deferred()
        reportsService.exportExcel.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderReports()
        await screen.findByText('Ada Lovelace')
        const btn = screen.getByRole('button', { name: /Download CSV/i })
        await user.click(btn)
        await waitFor(() => expect(reportsService.exportExcel).toHaveBeenCalledTimes(1))
        await user.click(btn)
        await user.click(btn)
        expect(reportsService.exportExcel).toHaveBeenCalledTimes(1)
        gate.resolve({ filename: 'x.csv' })
    })

    it('BASARIDA indirilen dosya adi bildirilir', async () => {
        reportsService.exportExcel.mockResolvedValue({ filename: 'temmuz.csv' })
        const user = setupUser()
        renderReports()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: /Download CSV/i }))
        expect(await screen.findByText(/Downloaded temmuz\.csv/)).toBeInTheDocument()
    })

    it('BASARISIZ indirme basari gibi GOSTERILMEZ', async () => {
        reportsService.exportExcel.mockRejectedValueOnce(
            httpError(409, { detail: 'Report window too large.' })
        )
        const user = setupUser()
        renderReports()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: /Download CSV/i }))
        expect(await screen.findByText('Report window too large.')).toBeInTheDocument()
        expect(screen.queryByText(/Downloaded/)).not.toBeInTheDocument()
    })

    it('indirme hatasinin TEKNIK govdesi gosterilmez', async () => {
        reportsService.exportExcel.mockRejectedValueOnce(
            httpError(500, { detail: '<!DOCTYPE html><html>500</html>' })
        )
        const user = setupUser()
        renderReports()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: /Download CSV/i }))
        expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument()
        expect(screen.queryByText(/DOCTYPE/)).not.toBeInTheDocument()
    })
})

describe('indirme yardimcisinin YEREL hatasi', () => {
    it('sunucunun aciklamasi KAYBOLMAZ (HTTP yaniti tasimasa bile)', async () => {
        /*
         * `downloadBlobResponse` JSON hata govdesini okuyup DUZ bir
         * Error firlatir. Dogrudan normalizeApiError'e verilirse
         * "sunucuya ulasilamiyor" diye siniflanirdi — bu davranisi
         * tarayici QA'si yakaladi, birim testi kacirmisti.
         */
        const err = new Error('Report window too large.')
        err.isDownloadError = true
        reportsService.exportExcel.mockRejectedValueOnce(err)
        const user = setupUser()
        renderReports()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: /Download CSV/i }))
        expect(await screen.findByText('Report window too large.')).toBeInTheDocument()
        expect(screen.queryByText(/Cannot reach the server/)).not.toBeInTheDocument()
    })

    it('GERCEK ag hatasi yine ag dilinde konusur', async () => {
        reportsService.exportExcel.mockRejectedValueOnce(new Error('Network Error'))
        const user = setupUser()
        renderReports()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: /Download CSV/i }))
        expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument()
    })
})
