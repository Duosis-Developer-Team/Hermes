/**
 * =============================================================================
 * Billable Hours — kullanici secici sozlesmesi (GERCEK mount)
 * =============================================================================
 * KAPATILAN KUSUR (kullanici bildirimi, 2026-08-04):
 * Secicide kullanici adi yerine HAM UUID goruluyordu.
 *
 * Kok neden: RBAC cutover'inda (f6882f1) sayfa kapisi `is_admin` yerine
 * `reports.view` oldu, ama kullanici listesi hala `GET /api/v1/auth/users`
 * (users.manage ZORUNLU) ucundan geliyordu. `reports.view` olup
 * `users.manage` olmayan kullanicida istek 403 doner, liste bos kalir ve
 * AntD Select secili degeri eslestirecek option bulamayinca degerin
 * KENDISINI — yani UUID'yi — basar.
 *
 * Kilitlenenler:
 *   1. Sayfa admin-only `/auth/users` ucune BAGLI DEGIL; en az ayricalikli
 *      `/auth/users/lookup` kullanir.
 *   2. Liste bos donse veya istek PATLASA bile ekranda ham kimlik
 *      GORUNMEZ — kullanici en kotu durumda kendi adini gorur.
 *   3. Baskasini secme yetkisi backend'in uyguladigi izinle ayni
 *      (worklogs.admin); izin yoksa secici kilitlidir.
 * =============================================================================
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'

const authService = { getUsers: vi.fn(), lookupUsers: vi.fn() }
const workLogService = { getMyLogs: vi.fn(), update: vi.fn() }
const customerService = { getAll: vi.fn() }
const projectService = { getAll: vi.fn() }

vi.mock('../../services/api', () => ({
    authService, workLogService, customerService, projectService,
}))

const BillableHoursPage = (await import('../../pages/BillableHoursPage')).default
const { useAuthStore } = await import('../../stores/authStore')
const { makeTestQueryClient, resetAuthStore } = await import('../utils')

const SELF_ID = '30cfc224-4e7f-4776-ab42-130000000000'
const OTHER_ID = '9f1c0000-0000-4000-8000-000000000001'

const setUser = (permissions) => {
    useAuthStore.setState({
        user: { id: SELF_ID, email: 'gencay@duosis.com', full_name: 'Gencay Coskun' },
        isAuthenticated: true,
        permissions,
    })
}

const renderPage = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <BillableHoursPage />
        </QueryClientProvider>
    )

beforeEach(() => {
    vi.clearAllMocks()
    resetAuthStore()
    customerService.getAll.mockResolvedValue([])
    projectService.getAll.mockResolvedValue([])
    workLogService.getMyLogs.mockResolvedValue({ data: [] })
    authService.lookupUsers.mockResolvedValue([
        { id: SELF_ID, full_name: 'Gencay Coskun', email: 'gencay@duosis.com' },
        { id: OTHER_ID, full_name: 'Ada Lovelace', email: 'ada@duosis.com' },
    ])
})

describe('kullanici secicisi ham kimlik GOSTERMEZ', () => {
    it('liste yuklendiginde secili kullanicinin ADI gorunur', async () => {
        setUser(['reports.view', 'worklogs.admin'])
        renderPage()
        expect(await screen.findByTitle('Gencay Coskun')).toBeInTheDocument()
        expect(screen.queryByText(SELF_ID)).toBeNull()
    })

    it('lookup PATLASA bile UUID basilmaz — kendi adi gosterilir', async () => {
        setUser(['reports.view', 'worklogs.admin'])
        authService.lookupUsers.mockRejectedValue(
            Object.assign(new Error('Forbidden'), { response: { status: 403 } })
        )
        renderPage()
        expect(await screen.findByTitle('Gencay Coskun')).toBeInTheDocument()
        expect(screen.queryByText(SELF_ID)).toBeNull()
    })

    it('lookup BOS donse bile UUID basilmaz', async () => {
        setUser(['reports.view', 'worklogs.admin'])
        authService.lookupUsers.mockResolvedValue([])
        renderPage()
        expect(await screen.findByTitle('Gencay Coskun')).toBeInTheDocument()
        expect(screen.queryByText(SELF_ID)).toBeNull()
    })
})

describe('yetki sozlesmesi', () => {
    it('admin-only /auth/users ucu ARTIK CAGRILMAZ', async () => {
        setUser(['reports.view', 'worklogs.admin'])
        renderPage()
        await screen.findByTitle('Gencay Coskun')
        expect(authService.getUsers).not.toHaveBeenCalled()
        expect(authService.lookupUsers).toHaveBeenCalled()
    })

    it('worklogs.admin YOKSA secici kilitli ve liste hic cekilmez', async () => {
        setUser(['reports.view'])
        renderPage()
        // Kendi adini yine gorur (secili deger her zaman cozulur).
        expect(await screen.findByTitle('Gencay Coskun')).toBeInTheDocument()
        await waitFor(() => {
            expect(authService.lookupUsers).not.toHaveBeenCalled()
        })
        expect(document.querySelector('.bh-user-select .ant-select-disabled')
            || document.querySelector('.bh-user-select.ant-select-disabled'))
            .toBeTruthy()
    })

    it('kendi kayitlari icin sorgu KENDI id siyle gider', async () => {
        setUser(['reports.view', 'worklogs.admin'])
        renderPage()
        await waitFor(() => {
            const last = workLogService.getMyLogs.mock.calls.at(-1)?.[0] || {}
            expect(last.user_id).toBe(SELF_ID)
        })
    })
})
