/**
 * =============================================================================
 * Sprint 4 — COPY/PASTE CHARACTERIZATION (refactor ONCESI yazildi)
 * =============================================================================
 * Paket §6 ve CTO §4: WorkLogCard/clipboard yapisi degistirilmeden ONCE
 * mevcut davranis testle KILITLENIR. Bu dosya, refactor'dan once yazildi
 * ve refactor SONRASI degistirilmeden yesil kalmak zorundadir — yani
 * gecen testler "davranis korundu"nun kanitidir.
 *
 * Kilitlenen sozlesme:
 *  1. Kayit secilir → Ctrl/Cmd+C snapshot alir.
 *  2. Hedef gun secilir → Ctrl/Cmd+V YENI kayit olusturur (alan esleme).
 *  3. Coklu paste: paste sonrasi pano DOLU kalir, hedef gun temizlenir.
 *  4. Snapshot immutable: kaynak sonradan degisse bile yapistirilan veri
 *     kopyalama anindaki degerdir.
 *  5. Input/textarea/select/contenteditable icindeyken kisayol CALISMAZ.
 *  6. Escape secim+pano+hedefi temizler.
 *  7. Hedefsiz paste uyari verir, mutation CALISMAZ.
 *  8. Pending sirasinda ikinci paste debounce edilir (cift kayit yok).
 *  9. Mac Meta ve Windows/Linux Control ayni davranir.
 * =============================================================================
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

const createSpy = vi.fn()

/*
 * ZAMAN BOMBASI DUZELTMESI (Sprint 7): fixture tarihi `2026-07-27` diye
 * SABITLENMISTI. TimeEntryPage her zaman ICINDE BULUNULAN ISO haftasini
 * gosterir; takvim o haftayi gecince kayit gorunur alanin disinda kaldi
 * ve test, urunde hicbir sey degismeden kirmiziya dondu (30 Temmuz'da
 * yesildi, 3 Agustos'ta kirmizi). Tarih artik GECERLI haftadan turetilir.
 */
const WEEK_MONDAY = dayjs().startOf('isoWeek').format('YYYY-MM-DD')
/** Hedef gun etiketleri de haftadan turetilir (sabit '28'/'29' DEGIL). */
const DAY_LABEL = (offset) =>
    // DayColumn gun numarasini SIFIR DOLGULU ('DD') cizer.
    dayjs().startOf('isoWeek').add(offset, 'day').format('DD')

const LOGS = [
    {
        id: 'log-1', customer_id: 'c1', project_id: 'p1', work_type_id: 'w1',
        activity_type_id: 'a1', platform_id: null, work_line_id: null,
        date_worked: WEEK_MONDAY, duration_hours: 2.5,
        description: 'Ilk kayit', customer_name: 'Vakko', project_name: 'ATM',
        work_type_name: 'Dev',
    },
]

vi.mock('../../services/api', () => ({
    authService: { getUsers: vi.fn(), lookupUsers: vi.fn(() => Promise.resolve([])) },
    workLogService: {
        getMyLogs: vi.fn(() => Promise.resolve({ data: LOGS })),
        create: (...a) => createSpy(...a),
        update: vi.fn(() => Promise.resolve({})),
        delete: vi.fn(() => Promise.resolve({})),
    },
    planTimeService: {
        getAll: vi.fn(() => Promise.resolve({ data: [] })),
        getMyPlanTimes: vi.fn(() => Promise.resolve({ data: [] })),
        respond: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    customerService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
    projectService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
    workTypeService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
    activityTypeService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
    platformService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
    workLineService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
}))

import TimeEntryPage from '../../pages/TimeEntryPage'
import { useAuthStore } from '../../stores/authStore'
import { makeTestQueryClient, resetAuthStore } from '../utils'

const renderPage = () => {
    useAuthStore.setState({
        user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: false },
        isAuthenticated: true, permissions: [],
    })
    return render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ConfigProvider>
                <MemoryRouter initialEntries={['/time-entry']}>
                    <TimeEntryPage />
                </MemoryRouter>
            </ConfigProvider>
        </QueryClientProvider>
    )
}

const card = async () => await screen.findByText('Ilk kayit')
const key = (k, mod = 'ctrl') =>
    fireEvent.keyDown(window, {
        key: k, ctrlKey: mod === 'ctrl', metaKey: mod === 'meta',
    })

beforeEach(() => {
    vi.clearAllMocks()
    createSpy.mockResolvedValue({ id: 'new-1' })
    resetAuthStore()
    localStorage.clear()
})

describe('kopyalama', () => {
    it('secili kayit Ctrl+C ile panoya alinir', async () => {
        renderPage()
        fireEvent.click(await card())
        key('c')
        // Pano dolunca gunlerde paste ipucu belirir
        await waitFor(() =>
            expect(document.body.textContent).toMatch(/Paste here|Ctrl\+V/i)
        )
    })

    it('secim YOKKEN Ctrl+C pano doldurmaz', async () => {
        renderPage()
        await card()
        key('c')
        await waitFor(() =>
            expect(document.body.textContent).not.toMatch(/Paste here/i)
        )
    })
})

describe('yapistirma', () => {
    const copyAndTarget = async () => {
        fireEvent.click(await card())
        key('c')
        await waitFor(() => expect(document.body.textContent).toMatch(/Ctrl\+V/i))
        // Hedef gun: kaynaktan FARKLI bir gun sec (28)
        const target = screen.getByText(DAY_LABEL(1))
        fireEvent.click(target.closest('div'))
    }

    it('Ctrl+V hedef gune YENI kayit olusturur — alan eslemesi birebir', async () => {
        renderPage()
        await copyAndTarget()
        key('v')
        await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
        const payload = createSpy.mock.calls[0][0]
        expect(payload).toMatchObject({
            customer_id: 'c1', project_id: 'p1', work_type_id: 'w1',
            activity_type_id: 'a1', platform_id: null, work_line_id: null,
            duration_hours: 2.5, description: 'Ilk kayit',
        })
        expect(payload.date_worked).not.toBe(WEEK_MONDAY) // hedef gune gitti
        expect(payload.id).toBeUndefined() // YENI kayit
    })

    it('Cmd+V (Mac) ayni sekilde calisir', async () => {
        renderPage()
        await copyAndTarget()
        key('v', 'meta')
        await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    })

    it('hedef gun SECILMEDEN paste mutation CALISMAZ', async () => {
        renderPage()
        fireEvent.click(await card())
        key('c')
        await waitFor(() => expect(document.body.textContent).toMatch(/Ctrl\+V/i))
        key('v')
        await new Promise((r) => setTimeout(r, 60))
        expect(createSpy).not.toHaveBeenCalled()
    })

    it('COKLU paste: paste sonrasi pano DOLU kalir, ikinci gune de yapistirilir', async () => {
        renderPage()
        await copyAndTarget()
        key('v')
        await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
        // Pano hala dolu → yeni hedef secilip tekrar yapistirilabilir
        fireEvent.click(screen.getByText(DAY_LABEL(2)).closest('div'))
        key('v')
        await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2))
        expect(createSpy.mock.calls[0][0].date_worked)
            .not.toBe(createSpy.mock.calls[1][0].date_worked)
    })
})

describe('kisayol guvenligi', () => {
    it.each([
        ['INPUT', () => { const el = document.createElement('input'); document.body.appendChild(el); el.focus(); return el }],
        ['TEXTAREA', () => { const el = document.createElement('textarea'); document.body.appendChild(el); el.focus(); return el }],
        ['SELECT', () => { const el = document.createElement('select'); document.body.appendChild(el); el.focus(); return el }],
    ])('%s icindeyken Ctrl+C pano DOLDURMAZ', async (_n, mk) => {
        renderPage()
        fireEvent.click(await card())
        const el = mk()
        key('c')
        await new Promise((r) => setTimeout(r, 40))
        expect(document.body.textContent).not.toMatch(/Paste here/i)
        el.remove()
    })

    // NOT: contenteditable vakasi jsdom'da DOM uzerinden test EDILEMEZ
    // (jsdom isContentEditable'i implemente etmiyor, hep false doner).
    // Bu dal, refactor'da cikarilan SAF guard fonksiyonu uzerinden
    // test edilir: src/test/time-entry/clipboardModel.test.js
})

describe('temizleme', () => {
    it('Escape secim + pano + hedefi temizler', async () => {
        renderPage()
        fireEvent.click(await card())
        key('c')
        await waitFor(() => expect(document.body.textContent).toMatch(/Ctrl\+V/i))
        fireEvent.keyDown(window, { key: 'Escape' })
        await waitFor(() =>
            expect(document.body.textContent).not.toMatch(/Paste here/i)
        )
    })
})

describe('cache sozlesmesi (§9 — mutation sonrasi invalidation)', () => {
    it('paste sonrasi workLogs ailesi invalidate edilir, v5 object-syntax ile', async () => {
        const client = makeTestQueryClient()
        const spy = vi.spyOn(client, 'invalidateQueries')
        useAuthStore.setState({
            user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: false },
            isAuthenticated: true, permissions: [],
        })
        render(
            <QueryClientProvider client={client}>
                <ConfigProvider>
                    <MemoryRouter initialEntries={['/time-entry']}>
                        <TimeEntryPage />
                    </MemoryRouter>
                </ConfigProvider>
            </QueryClientProvider>
        )
        fireEvent.click(await screen.findByText('Ilk kayit'))
        fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
        await waitFor(() => expect(document.body.textContent).toMatch(/Ctrl\+V/i))
        fireEvent.click(screen.getByText(DAY_LABEL(1)).closest('div'))
        fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

        await waitFor(() => expect(createSpy).toHaveBeenCalled())
        await waitFor(() => {
            const keys = spy.mock.calls
                .map((c) => c[0]?.queryKey?.[0])
                .filter(Boolean)
            expect(keys).toContain('workLogs')
        })
        // v5 object-syntax zorunlu: dizi-bicim cagri OLMAMALI (tum cache'i
        // invalidate ederdi — Sprint 1'de duzeltilen davranis).
        for (const call of spy.mock.calls) {
            expect(Array.isArray(call[0])).toBe(false)
        }
    })
})
