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
import { render, within } from '@testing-library/react'
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

/** Etkilesim surucusu — keystroke gecikmesi yok (jsdom'da sayfa agir). */
export const setupUser = () => userEvent.setup({ delay: null })

/**
 * Gorev kartini KODUNDAN bulur.
 * NOT: board'da her kartin dis sarmalayicisi dnd-kit'ten `role="button"`
 * aliyor, kartin kendisi de role="button" — bu yuzden rol sorgusu iki
 * eleman bulur. Kart DOM sinifi tek ve kesin hedefi verir.
 */
export const taskCard = (code) => {
    const el = Array.from(document.querySelectorAll('.task-card')).find((c) =>
        (c.getAttribute('aria-label') || '').includes(code)
    )
    if (!el) throw new Error(`task card bulunamadi: ${code}`)
    return el
}

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

/** Casusa dusen TUM invalidate cagrilarinin kok key'leri (tekil, sirali). */
export const invalidatedFamilies = (spy) =>
    Array.from(
        new Set(
            spy.mock.calls
                .map((c) => c[0]?.queryKey?.[0])
                .filter((k) => typeof k === 'string')
        )
    ).sort()

/** Casusun v5 OBJECT syntax'i disinda cagrilmadigini dogrular (Sprint 1
 *  bulgusu: eski dizi bicimi TUM cache'i invalid ederdi). */
export const usedLegacyInvalidation = (spy) =>
    spy.mock.calls.some((c) => Array.isArray(c[0]))
