/**
 * =============================================================================
 * HERMES - Tasks yuzeyi entegrasyon harness'i (Sprint 5C)
 * =============================================================================
 * GERCEK TasksPage'i mount eder: saf helper testi DEGIL — kullanici
 * etkilesimi → modal → payload → mutation → invalidation → focus zinciri
 * uctan uca kosar.
 *
 * `invalidateQueries` cagrilari casusla yakalanir (call-through: gercek
 * cache davranisi korunur) ki testler "invalidateQueries cagrildi"
 * seviyesinde kalmayip HANGI key ailesinin vuruldugunu ve hangilerinin
 * VURULMADIGINI dogrulayabilsin.
 * =============================================================================
 */
import { vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import TasksPage from '../../pages/TasksPage'
import { useAuthStore } from '../../stores/authStore'
import { makeTestQueryClient } from '../utils'

export const ME = { id: 'u1', email: 'ada@duosis.com', full_name: 'Ada Lovelace' }

/**
 * TasksPage'i gercek route bagliginda render eder.
 * @returns render sonucu + { queryClient, invalidateSpy }
 */
export function renderTasksPage({
    route = '/project-management/tasks',
    user = ME,
} = {}) {
    useAuthStore.setState({
        user, isAuthenticated: true, permissions: [],
    })
    const queryClient = makeTestQueryClient()
    // Call-through casus: gercek invalidation calisir, cagrilar kaydedilir.
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const result = render(
        <QueryClientProvider client={queryClient}>
            <ConfigProvider>
                <MemoryRouter initialEntries={[route]}>
                    <Routes>
                        <Route
                            path="/project-management"
                            element={<TasksPage />}
                        />
                        <Route
                            path="/project-management/:type"
                            element={<TasksPage />}
                        />
                    </Routes>
                </MemoryRouter>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { ...result, queryClient, invalidateSpy }
}

/**
 * Etkilesim surucusu — keystroke gecikmesi yok (jsdom'da sayfa agir).
 *
 * SURUKLEMEDEN SONRAKI tiklamalar MUTLAKA bunun uzerinden yapilmalidir:
 * dnd-kit surukleme bitisinde tek seferlik bir capture-phase click
 * bastiricisi birakir (surukleme sonrasi kazara tiklamayi engellemek
 * icin). Ciplak `fireEvent.click` tek bir click olayidir ve bastiriciya
 * yakalanip SESSIZCE yutulur; userEvent gercek tarayici dizisini
 * (pointerdown/mousedown/pointerup/mouseup/click) uretir ve gecer.
 * Bu davranis olculdu, varsayilmadi.
 */
export const setupUser = () => userEvent.setup({ delay: null })

/**
 * Gorev kartini KODUNDAN bulur.
 * NOT: board'da her kartin dis sarmalayicisi dnd-kit'ten `role="button"`
 * aliyor, kartin kendisi de role="button" — bu yuzden rol sorgusu iki
 * eleman bulur. Kart DOM sinifi tek ve kesin hedefi verir.
 */
/**
 * Kart kapsayicisi.
 *
 * Sprint 7: kart KOKU artik `role="button"` DEGIL (ic ice interaktif
 * kontrol yasagi). Erisilebilir ad, acma islemini yapan GERCEK butona
 * (baslik) tasindi; kapsayici sade bir `<div>`. Bu yuzden kart, baslik
 * butonunun adindan yukari cikilarak bulunur.
 */
export const taskCard = (code) => {
    const opener = Array.from(document.querySelectorAll('.task-card-open')).find(
        (b) => (b.getAttribute('aria-label') || '').includes(code)
    )
    const el = opener?.closest('.task-card')
    if (!el) throw new Error(`task card bulunamadi: ${code}`)
    return el
}

/** Karti ACAN gercek kontrol (baslik butonu). */
export const taskCardOpener = (code) =>
    taskCard(code).querySelector('.task-card-open')

/** Kart icinde sorgu yapmak icin kisayol. */
export const inCard = (code) => within(taskCard(code))

/**
 * Log Time diyalogu — SINIF ile bulunur, erisilebilir adla DEGIL.
 *
 * NEDEN: rc-util'in `useId`'i NODE_ENV=test altinda SABIT "test-id"
 * doner. Iki AntD modal'i ayni anda DOM'da oldugunda (onay modali
 * kapanma animasyonundayken Log Time acilir) ikisinin de
 * `aria-labelledby`'si ayni id'yi gosterir ve erisilebilir ad
 * KARISIR. Bu bir JSDOM ARTEFAKTIDIR — gercek tarayicida her diyalog
 * benzersiz id alir. Urun kusuru gibi raporlanmamali; adin gercekten
 * dogru oldugu tek-modal senaryolarda ve Chromium QA'sinda dogrulanir.
 */
export const logTimeDialog = () => document.querySelector('.log-time-modal')

// ─────────────────────────────────────────────────────────────────────────
// Board surukle-birak surucusu
// ─────────────────────────────────────────────────────────────────────────
// dnd-kit'in PointerSensor'u GERCEK pointer olaylari ve GERCEK geometri
// ister. jsdom ikisini de vermez:
//   1. `PointerEvent` sinifi yoktur → asagida MouseEvent uzerine minimal
//      bir polyfill kurulur (isPrimary/pointerId dnd-kit'in aktivasyon
//      kosulu icin sart),
//   2. her getBoundingClientRect 0x0 doner → carpisma tespiti kolonlari
//      ayirt edemez, bu yuzden board'a DETERMINISTIK bir geometri
//      giydirilir.
// Bunlar ORTAM eksigini kapatir; urun kodu degismez. Sensor, aktivasyon
// kisiti, carpisma tespiti (closestCorners), handleDragEnd ve mutation
// zincirinin TAMAMI gercek dnd-kit/urun kodudur.
// Gercek pointer fizigi ayrica Chromium'da olculur
// (scripts/qa/tasks-drag-qa.mjs).

const COLUMN_ORDER = ['pending', 'in_progress', 'completed', 'rejected']
const COL_W = 100
const COL_H = 400

const rectOf = (x, y, w, h) => ({
    x, y, width: w, height: h,
    top: y, left: x, right: x + w, bottom: y + h,
    toJSON() { return this },
})

/** Kolon govdesinin (droppable) hangi statuye ait oldugunu bulur. */
const statusOfColumnBody = (el) => {
    const col = el.closest('.tasks-board-column')
    if (!col) return null
    for (const s of COLUMN_ORDER) {
        if (col.classList.contains(`tasks-board-column-${s}`)) return s
    }
    return null
}

let restoreRect = null
// Suruklenen kartin kaynak dikdortgeni. dnd-kit carpisma hesabini
// `dragOverlay.rect ?? activeNodeRect` uzerinden yapar; board bir
// DragOverlay kullandigi icin OLCULEN eleman overlay'dir. jsdom'da
// overlay 0x0 kalirsa carpisma dikdortgeni bir NOKTAYA cokup komsu
// kolonlarla ESIT uzaklik uretir ve beraberlik her zaman soldaki
// kolona duser — yani surukleme sistematik olarak bir kolon eksik
// gorunur. Gercek tarayicida overlay kartin geometrisini tasir; burada
// da oyle taklit edilir.
let activeDragRect = null

/** Board'a deterministik geometri giydirir; testten sonra geri alinir. */
export function installBoardGeometry() {
    if (!window.PointerEvent) {
        window.PointerEvent = class PointerEvent extends window.MouseEvent {
            constructor(type, props = {}) {
                super(type, props)
                this.pointerId = props.pointerId ?? 1
                this.pointerType = props.pointerType ?? 'mouse'
                this.isPrimary = props.isPrimary ?? true
            }
        }
    }
    const original = Element.prototype.getBoundingClientRect
    restoreRect = () => { Element.prototype.getBoundingClientRect = original }
    Element.prototype.getBoundingClientRect = function boardRect() {
        if (this.classList?.contains('tasks-board-drag-overlay')) {
            return activeDragRect || rectOf(0, 0, COL_W, 50)
        }
        if (this.classList?.contains('tasks-board-column-body')) {
            const status = statusOfColumnBody(this)
            const i = COLUMN_ORDER.indexOf(status)
            if (i !== -1) return rectOf(i * COL_W, 0, COL_W, COL_H)
        }
        if (this.classList?.contains('tasks-board-draggable')) {
            const body = this.closest('.tasks-board-column-body')
            const status = body ? statusOfColumnBody(body) : null
            const i = COLUMN_ORDER.indexOf(status)
            if (i !== -1) {
                const idx = Array.from(body.children).indexOf(this)
                return rectOf(i * COL_W, idx * 60, COL_W, 50)
            }
        }
        return rectOf(0, 0, 0, 0)
    }
}

export function restoreBoardGeometry() {
    restoreRect?.()
    restoreRect = null
    activeDragRect = null
}

/**
 * dnd-kit, surukleme bittikten sonra TEK SEFERLIK bir capture-phase
 * click bastiricisi birakir: amaci, birakma hareketinin kartin uzerinde
 * bir "tiklama" olarak yorumlanmasini engellemektir. Gercek tarayicida
 * bu bastiriciyi, pointerup'in hemen ardindan gelen dogal `click`
 * tuketir. Sentetik surucude oyle bir click yoktur, bu yuzden bastirici
 * bir sonraki tiklamayi yutar. Surukleme sonrasi ARAYUZLE etkilesecek
 * testler once bunu cagirir — davranis olculdu, varsayilmadi.
 */
export const consumeDragClickSuppressor = async (user) => {
    await user.click(document.body)
}

/** Bir gorevin suruklenebilir sarmalayicisi (dnd-kit node'u). */
export const draggableFor = (code) => taskCard(code).closest('.tasks-board-draggable')

/**
 * Kartin su an bulundugu kolonun statusu — optimistic gorunum kaniti.
 * DragOverlay klonu kolon DISINDA render edilir; onu ATLAR.
 */
export const columnOf = (code) => {
    // Sprint 7: erisilebilir ad kart KOKUNDE degil, karti acan gercek
    // butonda (baslik). Karta oradan cikilir.
    const card = Array.from(document.querySelectorAll('.task-card-open'))
        .filter((b) => !b.closest('.tasks-board-drag-overlay'))
        .find((b) => (b.getAttribute('aria-label') || '').includes(code))
        ?.closest('.task-card')
    if (!card) throw new Error(`kolonda kart yok: ${code}`)
    return statusOfColumnBody(card.closest('.tasks-board-column-body'))
}

/**
 * DndContext'in olcum/efekt dongusunun oturmasini bekler.
 * `act()` ile SARILMAZ: fireEvent zaten act icinde calisir ve bu yardimci
 * bazen waitFor'un act'i icinden cagrildigi icin ic ice act "Should not
 * already be working" hatasi uretiyordu.
 */
const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms))

const pointer = (node, type, x, y) =>
    fireEvent(
        node,
        new window.PointerEvent(type, {
            bubbles: true, cancelable: true, button: 0, isPrimary: true,
            pointerId: 1, clientX: x, clientY: y,
        })
    )

/**
 * Gorevi hedef status kolonuna GERCEK pointer dizisiyle surukler:
 * pointerdown → (aktivasyon kisitini asan) pointermove → pointerup.
 * `release: false` ile birakmadan birakilabilir (pending testleri).
 */
export async function dragCardTo(code, targetStatus, { release = true } = {}) {
    const node = draggableFor(code)
    // Overlay olculdugunde kaynak kartin geometrisini gorsun.
    activeDragRect = node.getBoundingClientRect()
    const from = COLUMN_ORDER.indexOf(columnOf(code))
    const to = COLUMN_ORDER.indexOf(targetStatus)
    const startX = from * COL_W + COL_W / 2
    const startY = 25
    const endX = to * COL_W + COL_W / 2

    pointer(node, 'pointerdown', startX, startY)
    // Aktivasyon kisiti 6px — once esigi asip sensoru uyandiririz.
    pointer(document, 'pointermove', startX + 10, startY)
    // DndContext drag basladiginda droppable/active rect'leri OLCER; bu
    // olcum efekt+RAF dongusunde olur. Beklemezsek hedef hareket bos
    // rect'lere karsi hesaplanir ve carpisma yanlis kolonu secer.
    await settle()
    pointer(document, 'pointermove', endX, startY)
    await settle()
    if (release) {
        pointer(document, 'pointerup', endX, startY)
        await settle()
    }
    return {
        /** Suruklemeyi sonradan birakmak icin (pending senaryolari). */
        drop: async () => {
            pointer(document, 'pointerup', endX, startY)
            await settle()
        },
    }
}

/** Casusa dusen TUM invalidate cagrilarinin kok key'leri (tekil, sirali). */
// WS8: anahtarlar ['t', <tenant>, <aile>, ...] bicimindedir. Bu yardimci
// AILE adini cikarir; tenant oneki invalidation davranisini degistirmez,
// yalnizca anahtar uzayini tenant'a gore boler.
export const invalidatedFamilies = (spy) =>
    Array.from(
        new Set(
            spy.mock.calls
                .map((c) => {
                    const key = c[0]?.queryKey
                    if (!Array.isArray(key)) return undefined
                    return key[0] === 't' ? key[2] : key[0]
                })
                .filter((k) => typeof k === 'string')
        )
    ).sort()

/** Casusun v5 OBJECT syntax'i disinda cagrilmadigini dogrular (Sprint 1
 *  bulgusu: eski dizi bicimi TUM cache'i invalid ederdi). */
export const usedLegacyInvalidation = (spy) =>
    spy.mock.calls.some((c) => Array.isArray(c[0]))
