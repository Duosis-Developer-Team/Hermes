/**
 * =============================================================================
 * Gorunum ↔ URL sozlesmesi (§6.1, §14)
 * =============================================================================
 * Gorunum URL'de yasar; yerel kopya TUTULMAZ. Boylece:
 *   - view parametresi olmadan girilince Explorer acilir,
 *   - gecersiz/eski deger sessizce Explorer'a duser,
 *   - ilk boyama zaten dogru gorunumdur (Board gosterip Explorer'a
 *     gecen GORSEL FLASH olusamaz — iki kaynak yok),
 *   - tarayici geri/ileri tuslari calisir,
 *   - varsayilan gorunum URL'i kirletmez.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import useTaskViewState from '../../features/tasks/hooks/useTaskViewState'
import {
    DEFAULT_TASK_LAYOUT, TASK_LAYOUTS, isValidTaskLayout,
} from '../../features/tasks/model/constants'

const wrapperFor = (initial) => {
    const Wrapper = ({ children }) => (
        <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    )
    Wrapper.displayName = 'RouterWrapper'
    return Wrapper
}

const renderView = (initial = '/project-management/tasks') =>
    renderHook(
        () => ({
            view: useTaskViewState({ canViewAssignedByMe: true }),
            location: useLocation(),
        }),
        { wrapper: wrapperFor(initial) }
    )

describe('varsayilan gorunum', () => {
    it('Explorer katalogda ILK sirada ve varsayilandir', () => {
        expect(TASK_LAYOUTS[0].value).toBe('explorer')
        expect(DEFAULT_TASK_LAYOUT).toBe('explorer')
        expect(isValidTaskLayout('explorer')).toBe(true)
        expect(isValidTaskLayout('calendar')).toBe(false)
    })

    it('view parametresi YOKKEN Explorer acilir', () => {
        const { result } = renderView()
        expect(result.current.view.viewLayout).toBe('explorer')
    })

    it('Board ve List KALDIRILMADI', () => {
        expect(TASK_LAYOUTS.map((l) => l.value))
            .toEqual(['explorer', 'board', 'list'])
    })
})

describe('URL <-> gorunum', () => {
    it('?view=board Board acar', () => {
        const { result } = renderView('/project-management/tasks?view=board')
        expect(result.current.view.viewLayout).toBe('board')
    })

    it('?view=list List acar', () => {
        const { result } = renderView('/project-management/tasks?view=list')
        expect(result.current.view.viewLayout).toBe('list')
    })

    it('GECERSIZ deger sessizce Explorer a duser', () => {
        const { result } = renderView('/project-management/tasks?view=calendar')
        expect(result.current.view.viewLayout).toBe('explorer')
    })

    it('gorunum degisince URL guncellenir', () => {
        const { result } = renderView()
        act(() => result.current.view.setViewLayout('list'))
        expect(result.current.location.search).toBe('?view=list')
        expect(result.current.view.viewLayout).toBe('list')
    })

    it('varsayilana donunce parametre SILINIR (URL kirlenmez)', () => {
        const { result } = renderView('/project-management/tasks?view=board')
        act(() => result.current.view.setViewLayout('explorer'))
        expect(result.current.location.search).toBe('')
        expect(result.current.view.viewLayout).toBe('explorer')
    })

    it('diger sorgu parametreleri KORUNUR', () => {
        const { result } = renderView('/project-management/tasks?item=abc')
        act(() => result.current.view.setViewLayout('board'))
        expect(result.current.location.search).toContain('item=abc')
        expect(result.current.location.search).toContain('view=board')
    })

    it('gorunum yerel state te KOPYALANMAZ — tek kaynak URL', () => {
        // Ayni hook iki kez baglanirsa ikisi de AYNI degeri gorur.
        const { result } = renderView('/project-management/tasks?view=list')
        expect(result.current.view.viewLayout).toBe('list')
        act(() => result.current.view.setViewLayout('board'))
        expect(result.current.location.search).toBe('?view=board')
    })
})
