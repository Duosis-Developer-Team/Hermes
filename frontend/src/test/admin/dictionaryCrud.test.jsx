/**
 * =============================================================================
 * Sprint 6B.2 — Sozluk CRUD ortak kabugu (GERCEK mount)
 * =============================================================================
 * Kaynak metni aranmaz: gercek yuzey mount edilir ve kullanici
 * etkilesimleri surulur. Kilitlenen bes kusur (uc kopyada da vardi):
 *   1. Form dogrulamasi basarisiz olunca console.error
 *   2. Cift gonderim engellenmiyor
 *   3. Edit A → Edit B gecisinde A'nin degerleri KALIYOR (setFieldsValue
 *      sig birlestirme)
 *   4. Hata mesaji "Error"; alan hatalari forma baglanmiyor
 *   5. Ikon-only satir aksiyonlarinin erisilebilir adi yok
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'

import DictionaryCrudPage from '../../features/admin/dictionaries/DictionaryCrudPage'
import { makeTestQueryClient } from '../utils'

const ITEMS = [
    { id: 'a1', name: 'Coding', code: 'COD', description: 'Writing code', is_active: true },
    { id: 'a2', name: 'Review', code: 'REV', description: '', is_active: true },
    { id: 'a3', name: 'Legacy Task', code: 'LEG', description: 'Old', is_active: false },
]

let service
const setupUser = () => userEvent.setup({ delay: null })

const renderPage = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ConfigProvider>
                <DictionaryCrudPage
                    title="Activity Types"
                    singular="Activity Type"
                    description="Manage activity types"
                    service={service}
                    queryKey={['activityTypes']}
                />
            </ConfigProvider>
        </QueryClientProvider>
    )

const httpError = (status, data) => ({ response: { status, data } })
const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

beforeEach(() => {
    service = {
        getAll: vi.fn().mockResolvedValue(ITEMS.map((i) => ({ ...i }))),
        create: vi.fn().mockResolvedValue({ id: 'new' }),
        update: vi.fn().mockResolvedValue({ id: 'a1' }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
    }
})

/** Footer butonlari dialog KAPSAMINDA sorgulanir: toolbar'daki
 *  "Add Activity Type" ile modal OK butonu AYNI erisilebilir adi tasir. */
const submitBtn = (label) => {
    const dialog = screen.getByRole('dialog', { name: /Activity Type/ })
    return within(dialog).getByRole('button', { name: label })
}
const cancelBtn = () => submitBtn('Cancel')

const openEditFor = async (user, name) => {
    await user.click(await screen.findByRole('button', { name: `Edit ${name}` }))
    return screen.getByRole('dialog', { name: /Edit Activity Type/ })
}

describe('liste, arama ve bos durumlar', () => {
    it('kayitlar listelenir', async () => {
        renderPage()
        expect(await screen.findByText('Coding')).toBeInTheDocument()
        expect(screen.getByText('Review')).toBeInTheDocument()
    })

    it('durum yalniz RENKLE anlatilmaz — metin de tasir', async () => {
        renderPage()
        expect(await screen.findByText('Archived')).toBeInTheDocument()
        expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    })

    it('ILK KULLANIM boslugu ile FILTRE sonucu yoklugu AYRI mesajlanir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.type(screen.getByLabelText('Search Activity Types'), 'zzzz')
        expect(await screen.findByText(/match “zzzz”/)).toBeInTheDocument()

        service.getAll.mockResolvedValue([])
        renderPage()
        expect(await screen.findByText(/No activity types yet/)).toBeInTheDocument()
    })

    it('arama ad, kod ve aciklamada calisir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.type(screen.getByLabelText('Search Activity Types'), 'REV')
        await waitFor(() => expect(screen.queryByText('Coding')).not.toBeInTheDocument())
        expect(screen.getByText('Review')).toBeInTheDocument()
    })

    it('liste hatasinda RETRY sunulur ve yeniden cagrilir', async () => {
        service.getAll.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderPage()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        expect(screen.getByText(/server had a problem/)).toBeInTheDocument()
        service.getAll.mockResolvedValue(ITEMS)
        await user.click(retry)
        expect(await screen.findByText('Coding')).toBeInTheDocument()
    })
})

describe('satir aksiyonlari erisilebilir', () => {
    it('ikon-only butonlarin ERISILEBILIR ADI vardir', async () => {
        renderPage()
        expect(await screen.findByRole('button', { name: 'Edit Coding' })).toBeInTheDocument()
        // Aktif kayit ARSIVLENIR, pasif kayit KALICI SILINIR — ad bunu soyler.
        expect(screen.getByRole('button', { name: 'Archive Coding' })).toBeInTheDocument()
        expect(
            screen.getByRole('button', { name: 'Delete Legacy Task permanently' })
        ).toBeInTheDocument()
    })
})

describe('modal lifecycle — bayat deger YOK', () => {
    it('Create temiz defaultlarla acilir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        expect(within(dialog).getByLabelText('Name')).toHaveValue('')
        expect(within(dialog).getByLabelText('Code')).toHaveValue('')
    })

    it('Edit yalniz SECILI entity’nin verisiyle acilir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        const dialog = await openEditFor(user, 'Coding')
        expect(within(dialog).getByLabelText('Name')).toHaveValue('Coding')
        expect(within(dialog).getByLabelText('Code')).toHaveValue('COD')
        expect(within(dialog).getByLabelText('Description')).toHaveValue('Writing code')
    })

    it('KUSUR: Edit A → Edit B gecisinde A’nin degeri TASINMAZ', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        // A: aciklamasi DOLU
        let dialog = await openEditFor(user, 'Coding')
        expect(within(dialog).getByLabelText('Description')).toHaveValue('Writing code')
        await user.click(cancelBtn())

        // B: aciklamasi BOS → eski davranista A'nin aciklamasi kalirdi
        // (setFieldsValue sig birlestirir).
        dialog = await openEditFor(user, 'Review')
        expect(within(dialog).getByLabelText('Name')).toHaveValue('Review')
        expect(within(dialog).getByLabelText('Description')).toHaveValue('')
    })

    it('Edit → Create gecisinde eski deger KALMAZ', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await openEditFor(user, 'Coding')
        await user.click(cancelBtn())
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const create = screen.getByRole('dialog', { name: /Add Activity Type/ })
        expect(within(create).getByLabelText('Name')).toHaveValue('')
        expect(within(create).getByLabelText('Description')).toHaveValue('')
    })

    it('baslik ve primary buton Create/Edit ayrimini DOGRU gosterir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        expect(screen.getByRole('dialog', { name: /Add Activity Type/ })).toBeInTheDocument()
        await user.click(cancelBtn())
        await openEditFor(user, 'Coding')
        expect(screen.getByRole('dialog', { name: /Edit Activity Type/ })).toBeInTheDocument()
        expect(submitBtn('Save Changes')).toBeInTheDocument()
    })
})

describe('gonderim: validation, cift gonderim, hata', () => {
    it('zorunlu alanlar bildirilir ve mutation ACILMAZ', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        await user.click(submitBtn('Add Activity Type'))
        expect(await screen.findByText('Name is required.')).toBeInTheDocument()
        expect(service.create).not.toHaveBeenCalled()
    })

    it('yalniz BOSLUK gecersizdir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        await user.type(within(dialog).getByLabelText('Name'), '   ')
        await user.click(submitBtn('Add Activity Type'))
        expect(await screen.findByText('Name is required.')).toBeInTheDocument()
        expect(service.create).not.toHaveBeenCalled()
    })

    it('PENDING iken ikinci gonderim YENI mutation ACMAZ', async () => {
        const gate = deferred()
        service.create.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        await user.type(within(dialog).getByLabelText('Name'), 'Testing')
        const ok = submitBtn('Add Activity Type')
        await user.click(ok)
        await waitFor(() => expect(service.create).toHaveBeenCalledTimes(1))
        await user.click(ok)
        await user.click(ok)
        expect(service.create).toHaveBeenCalledTimes(1)
        // API donmeden modal KAPANMAZ.
        expect(screen.getByRole('dialog', { name: /Add Activity Type/ })).toBeInTheDocument()
        gate.resolve({ id: 'x' })
    })

    it('kod ad’dan turetilir — YALNIZCA yeni kayitta', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        await user.type(within(dialog).getByLabelText('Name'), 'Pair Programming')
        expect(within(dialog).getByLabelText('Code')).not.toHaveValue('')

        await user.click(cancelBtn())
        const edit = await openEditFor(user, 'Coding')
        await user.clear(within(edit).getByLabelText('Name'))
        await user.type(within(edit).getByLabelText('Name'), 'Renamed')
        // Edit'te kod DEGISMEZ.
        expect(within(edit).getByLabelText('Code')).toHaveValue('COD')
    })

    it('422 alan hatasi ILGILI ALANA baglanir', async () => {
        service.create.mockRejectedValueOnce(httpError(422, {
            detail: [{ loc: ['body', 'code'], msg: 'Code already used' }],
        }))
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        await user.type(within(dialog).getByLabelText('Name'), 'Dup')
        await user.click(submitBtn('Add Activity Type'))
        expect(await screen.findByText('Code already used')).toBeInTheDocument()
    })

    it('409 conflict FORM ustunde gosterilir ve girdiler KORUNUR', async () => {
        service.create.mockRejectedValueOnce(
            httpError(409, { detail: 'An activity type with this code exists.' })
        )
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        await user.type(within(dialog).getByLabelText('Name'), 'Korunacak')
        await user.click(submitBtn('Add Activity Type'))

        expect(
            await screen.findByText('An activity type with this code exists.')
        ).toBeInTheDocument()
        // Modal ACIK ve girdi YERINDE.
        const still = screen.getByRole('dialog', { name: /Add Activity Type/ })
        expect(within(still).getByLabelText('Name')).toHaveValue('Korunacak')
    })

    it('teknik 5xx govdesi kullaniciya SIZMAZ', async () => {
        service.create.mockRejectedValueOnce(
            httpError(500, { detail: 'sqlalchemy.exc.IntegrityError: duplicate key' })
        )
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        await user.type(within(dialog).getByLabelText('Name'), 'X')
        await user.click(submitBtn('Add Activity Type'))
        expect(await screen.findByText(/server had a problem/)).toBeInTheDocument()
        expect(screen.queryByText(/sqlalchemy/)).not.toBeInTheDocument()
    })

    it('basarili create sonrasi modal kapanir ve liste tazelenir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Add Activity Type' }))
        const dialog = screen.getByRole('dialog', { name: /Add Activity Type/ })
        await user.type(within(dialog).getByLabelText('Name'), 'Yeni')
        await user.click(submitBtn('Add Activity Type'))
        await waitFor(() => expect(service.create).toHaveBeenCalled())
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: /Add Activity Type/ })
            ).not.toBeInTheDocument()
        )
        // Hedefli invalidation → liste yeniden cekilir.
        await waitFor(() => expect(service.getAll.mock.calls.length).toBeGreaterThan(1))
    })

    it('edit dogru id ve payload ile gonderilir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        const dialog = await openEditFor(user, 'Coding')
        await user.clear(within(dialog).getByLabelText('Name'))
        await user.type(within(dialog).getByLabelText('Name'), 'Coding v2')
        await user.click(submitBtn('Save Changes'))
        await waitFor(() => expect(service.update).toHaveBeenCalled())
        const [id, payload] = service.update.mock.calls[0]
        expect(id).toBe('a1')
        expect(payload).toMatchObject({ name: 'Coding v2', code: 'COD' })
    })
})

describe('archive / delete terminolojisi ve kilitler', () => {
    it('AKTIF kayit ARSIVLENIR — "delete" denmez', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Archive Coding' }))
        expect(await screen.findByText(/Archive \/ Deactivate\?/)).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Archive' }))
        await waitFor(() =>
            expect(service.update).toHaveBeenCalledWith('a1', { is_active: false })
        )
        expect(service.delete).not.toHaveBeenCalled()
    })

    it('PASIF kayit KALICI silinir', async () => {
        const user = setupUser()
        renderPage()
        await screen.findByText('Legacy Task')
        await user.click(
            screen.getByRole('button', { name: 'Delete Legacy Task permanently' })
        )
        expect(await screen.findByText(/Delete Permanently\?/)).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Delete Permanently' }))
        await waitFor(() => expect(service.delete).toHaveBeenCalledWith('a3'))
    })

    it('yikici islem PENDING iken tekrar tetiklenemez', async () => {
        const gate = deferred()
        service.update.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderPage()
        await screen.findByText('Coding')
        await user.click(screen.getByRole('button', { name: 'Archive Coding' }))
        const confirm = await screen.findByRole('button', { name: 'Archive' })
        await user.click(confirm)
        await waitFor(() => expect(service.update).toHaveBeenCalledTimes(1))
        await user.click(confirm)
        await user.click(confirm)
        expect(service.update).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('kullanimda olan kayitta ARSIVLEME yolu onerilir', async () => {
        service.delete.mockRejectedValueOnce(
            httpError(409, { detail: 'Activity type is in use.' })
        )
        const user = setupUser()
        renderPage()
        await screen.findByText('Legacy Task')
        await user.click(
            screen.getByRole('button', { name: 'Delete Legacy Task permanently' })
        )
        await user.click(await screen.findByRole('button', { name: 'Delete Permanently' }))
        expect(await screen.findByText(/Try archiving it instead/)).toBeInTheDocument()
    })
})
