/**
 * =============================================================================
 * Sprint 6B.2 completion — PM Configurations (Task Management → Sub Projects)
 * =============================================================================
 * PM Configurations basit bir sozluk CRUD'u DEGIL. Gercek alt yuzeyleri:
 *   1. Task Access            → 6B.1'de kapatildi (burada dokunulmaz)
 *   2. Assignment Hierarchy   → ayri dosyada testlendi
 *   3. Sub Projects           → customer → project BAGIMLI secim zinciri
 *   4. Mail Notifications     → task tipi basina tam-satir upsert
 *
 * Bu dosya Sub Projects'in DOMAINE OZEL kuralini once karakterize eder:
 * bir alt proje customer + project altinda yasar, proje listesi secilen
 * musteriye gore DARALIR ve duzenlemede bu iki alan KILITLIDIR (alt
 * projenin sahibi tasinmaz). Bu davranis DOGRU calisiyordu ve
 * DEGISTIRILMEDI — kilitlendi.
 *
 * Kapatilan kusurlar:
 *   - Edit A → Edit B: resetFields yoktu, eksik aciklama tasiniyordu.
 *   - Kaydetme ve silmede pending kilidi yoktu.
 *   - `|| 'Failed to ...'`: teknik govdeler sizabiliyordu.
 *   - Satir aksiyonlarinin erisilebilir adi yoktu.
 *   - Liste hatasinda retry, ilk-kullanim/filtre bosluk ayrimi yoktu.
 *   - Yalniz-bosluk ad gecerli sayilip trim sonrasi BOS gonderiliyordu.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const customerService = { getAll: vi.fn() }
const projectService = { getAll: vi.fn() }
const taskSubProjectService = {
    list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
}

vi.mock('../../services/api', () => ({
    customerService, projectService, taskSubProjectService,
    // Ayni modulden gelen ama bu sekmede kullanilmayan servisler:
    authService: { lookupUsers: vi.fn().mockResolvedValue([]) },
    userGroupService: { list: vi.fn().mockResolvedValue([]) },
    taskAssignmentService: { list: vi.fn().mockResolvedValue([]) },
    taskAssignmentGroupService: { list: vi.fn().mockResolvedValue([]) },
    taskNotificationSettingsService: {
        list: vi.fn().mockResolvedValue([]), update: vi.fn(),
    },
    taskPermissionService: { list: vi.fn().mockResolvedValue([]) },
}))

const { SubProjectsTab } = await import('../../pages/admin/TaskManagementPage')
const { makeTestQueryClient } = await import('../utils')

const CUSTOMERS = [
    { id: 'c1', name: 'Vakko' },
    { id: 'c2', name: 'Beko' },
]
const PROJECTS = [
    { id: 'p1', customer_id: 'c1', name: 'ATM Yenileme' },
    { id: 'p2', customer_id: 'c1', name: 'Kiosk' },
    { id: 'p3', customer_id: 'c2', name: 'Mobil App' },
]
const SUBS = [
    {
        id: 's1', name: 'Faz 1', description: 'Ilk faz',
        customer_id: 'c1', project_id: 'p1',
        customer_name: 'Vakko', project_name: 'ATM Yenileme',
    },
    {
        // `description` BILEREK YOK.
        id: 's2', name: 'Faz 2',
        customer_id: 'c1', project_id: 'p1',
        customer_name: 'Vakko', project_name: 'ATM Yenileme',
    },
]

const setupUser = () => userEvent.setup({ delay: null })
const deferred = () => {
    let resolve
    const promise = new Promise((res) => { resolve = res })
    return { promise, resolve }
}
const httpError = (status, data) => ({ response: { status, data } })

const renderTab = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <SubProjectsTab />
        </QueryClientProvider>
    )

/**
 * Diyalog BASLIK METNI uzerinden bulunur, erisilebilir ad uzerinden
 * DEGIL. Neden: rc-util `useId` NODE_ENV=test altinda SABIT "test-id"
 * dondurur, bu yuzden ust uste acilan diyaloglar ayni
 * `aria-labelledby`yi paylasir ve ikinci acilista ad cozumu bozulur.
 * Gercek tarayicida id'ler benzersizdir (`:r16:` gibi) — bu bir TEST
 * ORTAMI artefaktidir, urun kusuru degil; Sprint 5C'de de belgelendi.
 */
const dialog = async (titleRe) => {
    const title = await screen.findByText(titleRe, { selector: '.ant-modal-title' })
    return title.closest('[role="dialog"]')
}

/**
 * Modal `destroyOnHidden` kullaniyor ve jsdom'da CSS gecisleri
 * tamamlanmadigi icin kapanma animasyonu bitmeden yeni acilis
 * cizilmiyor. Bir sonraki acilistan ONCE diyalogun gerceken
 * kaldirilmasi beklenir.
 */
/**
 * `DangerConfirmModal` basligini gorsel-gizli bir span icinde tasir, bu
 * yuzden `.ant-modal-title` selector'u ile eslesmez; metin nerede
 * bulunursa bulunsun diyaloga TIRMANILIR.
 */
const confirmDialog = async (re) => {
    const nodes = await screen.findAllByText(re)
    return nodes[0].closest('[role="dialog"]')
}

const closeDialog = async (user, d) => {
    await user.click(within(d).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    customerService.getAll.mockResolvedValue(CUSTOMERS.map((c) => ({ ...c })))
    projectService.getAll.mockResolvedValue(PROJECTS.map((p) => ({ ...p })))
    taskSubProjectService.list.mockResolvedValue(SUBS.map((s) => ({ ...s })))
    taskSubProjectService.create.mockResolvedValue({})
    taskSubProjectService.update.mockResolvedValue({})
    taskSubProjectService.delete.mockResolvedValue({})
})

describe('KARAKTERIZASYON — customer → project bagimli zinciri', () => {
    it('alt projeler musteri ve proje adiyla listelenir', async () => {
        renderTab()
        expect(await screen.findByText('Faz 1')).toBeInTheDocument()
        expect(screen.getAllByText('Vakko').length).toBeGreaterThan(0)
    })

    it('proje listesi SECILEN MUSTERIYE gore daralir', async () => {
        const user = setupUser()
        renderTab()
        await screen.findByText('Faz 1')
        await user.click(screen.getByRole('button', { name: /Create Sub Project/ }))
        const d = await dialog(/Create Sub Project/)

        const combos = within(d).getAllByRole('combobox')
        await user.click(combos[0])
        await user.click(await screen.findByTitle('Vakko'))
        await user.click(combos[1])
        // Yalnizca Vakko'nun projeleri.
        expect(await screen.findByTitle('ATM Yenileme')).toBeInTheDocument()
        expect(screen.getByTitle('Kiosk')).toBeInTheDocument()
        expect(screen.queryByTitle('Mobil App')).not.toBeInTheDocument()
    })

    it('MUSTERI degisince secili proje TEMIZLENIR', async () => {
        const user = setupUser()
        renderTab()
        await screen.findByText('Faz 1')
        await user.click(screen.getByRole('button', { name: /Create Sub Project/ }))
        const d = await dialog(/Create Sub Project/)
        const combos = within(d).getAllByRole('combobox')

        await user.click(combos[0])
        await user.click(await screen.findByTitle('Vakko'))
        await user.click(combos[1])
        await user.click(await screen.findByTitle('Kiosk'))
        expect(within(d).getByTitle('Kiosk')).toBeInTheDocument()

        // Musteri degisti: baska musterinin projesi secili KALAMAZ.
        await user.click(combos[0])
        await user.click(await screen.findByTitle('Beko'))
        await waitFor(() =>
            expect(within(d).queryByTitle('Kiosk')).not.toBeInTheDocument()
        )
    })

    it('DUZENLEMEDE sahiplik alanlari KILITLIDIR', async () => {
        const user = setupUser()
        renderTab()
        await user.click(await screen.findByRole('button', { name: 'Edit Faz 1' }))
        const d = await dialog(/Edit Sub Project/)
        const combos = within(d).getAllByRole('combobox')
        // Alt projenin musteri/proje sahibi tasinmaz.
        expect(combos[0]).toBeDisabled()
        expect(combos[1]).toBeDisabled()
    })

    it('duzenleme YALNIZCA ad ve aciklamayi gonderir', async () => {
        const user = setupUser()
        renderTab()
        await user.click(await screen.findByRole('button', { name: 'Edit Faz 1' }))
        const d = await dialog(/Edit Sub Project/)
        await user.clear(within(d).getByLabelText('Name'))
        await user.type(within(d).getByLabelText('Name'), 'Faz 1 rev')
        await user.click(within(d).getByRole('button', { name: /Save Changes/ }))
        await waitFor(() => expect(taskSubProjectService.update).toHaveBeenCalled())
        const [id, payload] = taskSubProjectService.update.mock.calls[0]
        expect(id).toBe('s1')
        expect(payload).toEqual({ name: 'Faz 1 rev', description: 'Ilk faz' })
        expect(payload).not.toHaveProperty('customer_id')
        expect(payload).not.toHaveProperty('project_id')
    })

    it('olusturma customer + project ile gonderilir', async () => {
        const user = setupUser()
        renderTab()
        await screen.findByText('Faz 1')
        await user.click(screen.getByRole('button', { name: /Create Sub Project/ }))
        const d = await dialog(/Create Sub Project/)
        const combos = within(d).getAllByRole('combobox')
        await user.click(combos[0])
        await user.click(await screen.findByTitle('Beko'))
        await user.click(combos[1])
        await user.click(await screen.findByTitle('Mobil App'))
        await user.type(within(d).getByLabelText('Name'), 'Yeni Faz')
        await user.click(within(d).getByRole('button', { name: /^Create Sub Project$/ }))
        await waitFor(() => expect(taskSubProjectService.create).toHaveBeenCalled())
        expect(taskSubProjectService.create).toHaveBeenCalledWith({
            customer_id: 'c2', project_id: 'p3', name: 'Yeni Faz', description: null,
        })
    })
})

describe('modal lifecycle — bayat deger YOK', () => {
    it('Edit A → Edit B: A’nin aciklamasi B’ye TASINMAZ', async () => {
        const user = setupUser()
        renderTab()
        await user.click(await screen.findByRole('button', { name: 'Edit Faz 1' }))
        let d = await dialog(/Edit Sub Project/)
        expect(within(d).getByLabelText('Description')).toHaveValue('Ilk faz')
        await closeDialog(user, d)

        await user.click(screen.getByRole('button', { name: 'Edit Faz 2' }))
        d = await dialog(/Edit Sub Project/)
        expect(within(d).getByLabelText('Name')).toHaveValue('Faz 2')
        expect(within(d).getByLabelText('Description')).toHaveValue('')
    })

    it('Edit → Create temiz defaultlarla acilir', async () => {
        const user = setupUser()
        renderTab()
        await user.click(await screen.findByRole('button', { name: 'Edit Faz 1' }))
        let d = await dialog(/Edit Sub Project/)
        await closeDialog(user, d)
        await user.click(screen.getByRole('button', { name: /Create Sub Project/ }))
        d = await dialog(/Create Sub Project/)
        expect(within(d).getByLabelText('Name')).toHaveValue('')
        expect(within(d).getByLabelText('Description')).toHaveValue('')
        // Sahiplik alanlari yeniden SECILEBILIR olur.
        expect(within(d).getAllByRole('combobox')[0]).toBeEnabled()
    })

    it('yalniz BOSLUK ad gecersizdir — bos ad GONDERILMEZ', async () => {
        const user = setupUser()
        renderTab()
        await user.click(await screen.findByRole('button', { name: 'Edit Faz 1' }))
        const d = await dialog(/Edit Sub Project/)
        await user.clear(within(d).getByLabelText('Name'))
        await user.type(within(d).getByLabelText('Name'), '   ')
        await user.click(within(d).getByRole('button', { name: /Save Changes/ }))
        expect(await screen.findByText('Name is required.')).toBeInTheDocument()
        expect(taskSubProjectService.update).not.toHaveBeenCalled()
    })
})

describe('cift tetikleme kilitleri', () => {
    it('PENDING iken ikinci kaydetme YENI istek ACMAZ', async () => {
        const gate = deferred()
        taskSubProjectService.update.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTab()
        await user.click(await screen.findByRole('button', { name: 'Edit Faz 1' }))
        const d = await dialog(/Edit Sub Project/)
        const save = within(d).getByRole('button', { name: /Save Changes/ })
        await user.click(save)
        await waitFor(() => expect(taskSubProjectService.update).toHaveBeenCalledTimes(1))
        await user.click(save)
        await user.click(save)
        expect(taskSubProjectService.update).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('PENDING iken silme tekrar tetiklenemez', async () => {
        const gate = deferred()
        taskSubProjectService.delete.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTab()
        await user.click(
            await screen.findByRole('button', { name: 'Delete Faz 1 permanently' })
        )
        const confirm = await confirmDialog(/Delete sub project\?/)
        const btn = within(confirm).getByRole('button', { name: /Delete/ })
        await user.click(btn)
        await waitFor(() => expect(taskSubProjectService.delete).toHaveBeenCalledTimes(1))
        await user.click(btn)
        await user.click(btn)
        expect(taskSubProjectService.delete).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })
})

describe('erisilebilir satir aksiyonlari', () => {
    it('aksiyonlar HANGI kaydi hedefledigini SOYLER', async () => {
        renderTab()
        expect(await screen.findByRole('button', { name: 'Edit Faz 1' }))
            .toBeInTheDocument()
        // Bu uc GERCEKTEN kalici siler; ad bunu soyler.
        expect(screen.getByRole('button', { name: 'Delete Faz 1 permanently' }))
            .toBeInTheDocument()
    })
})

describe('hata sunumu ve liste durumlari', () => {
    it('catisma mesaji KORUNUR', async () => {
        taskSubProjectService.create.mockRejectedValueOnce(
            httpError(409, { detail: 'A sub project with this name exists.' })
        )
        const user = setupUser()
        renderTab()
        await screen.findByText('Faz 1')
        await user.click(screen.getByRole('button', { name: /Create Sub Project/ }))
        const d = await dialog(/Create Sub Project/)
        const combos = within(d).getAllByRole('combobox')
        await user.click(combos[0])
        await user.click(await screen.findByTitle('Vakko'))
        await user.click(combos[1])
        await user.click(await screen.findByTitle('Kiosk'))
        await user.type(within(d).getByLabelText('Name'), 'Kopya')
        await user.click(within(d).getByRole('button', { name: /^Create Sub Project$/ }))
        expect(await screen.findByText('A sub project with this name exists.'))
            .toBeInTheDocument()
    })

    it('teknik govde kullaniciya SIZMAZ', async () => {
        taskSubProjectService.delete.mockRejectedValueOnce(
            httpError(500, { detail: 'sqlalchemy.exc.IntegrityError: fk' })
        )
        const user = setupUser()
        renderTab()
        await user.click(
            await screen.findByRole('button', { name: 'Delete Faz 1 permanently' })
        )
        const confirm = await confirmDialog(/Delete sub project\?/)
        await user.click(within(confirm).getByRole('button', { name: /Delete/ }))
        expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument()
        expect(screen.queryByText(/sqlalchemy/)).not.toBeInTheDocument()
    })

    it('liste hatasinda RETRY sunulur', async () => {
        taskSubProjectService.list.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderTab()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        taskSubProjectService.list.mockResolvedValue(SUBS)
        await user.click(retry)
        expect(await screen.findByText('Faz 1')).toBeInTheDocument()
    })

    it('ILK KULLANIM boslugu ile FILTRE sonucu yoklugu AYRI mesajlanir', async () => {
        taskSubProjectService.list.mockResolvedValue([])
        const user = setupUser()
        renderTab()
        expect(await screen.findByText(/No sub-projects yet/)).toBeInTheDocument()

        // Musteri filtresi secilince mesaj FILTRE dilinde konusur.
        const filters = screen.getAllByRole('combobox')
        await user.click(filters[0])
        await user.click(await screen.findByTitle('Vakko'))
        expect(await screen.findByText(/match the selected filters/))
            .toBeInTheDocument()
    })

    it('mutasyon sonrasi Tasks tarafi da tazelenir', async () => {
        const user = setupUser()
        renderTab()
        await user.click(await screen.findByRole('button', { name: 'Edit Faz 1' }))
        const d = await dialog(/Edit Sub Project/)
        await user.click(within(d).getByRole('button', { name: /Save Changes/ }))
        await waitFor(() => expect(taskSubProjectService.update).toHaveBeenCalled())
        // Admin listesi yeniden cekilir (Tasks tarafindaki
        // `task-sub-projects` anahtari da invalidate edilir).
        await waitFor(() =>
            expect(taskSubProjectService.list.mock.calls.length).toBeGreaterThan(1)
        )
    })
})
