/**
 * =============================================================================
 * Gorunum ↔ URL sozlesmesi (PM rework P3.5 / E1, E2)
 * =============================================================================
 * Ekranin durumu = secili gorunum; uc eksen URL'de yasar, yerel kopya
 * TUTULMAZ:
 *   ?view=<sistem | kayitli>  ?layout=board|list|calendar  ?group=…
 *   - parametre yokken varsayilan gorunum (mine) + pano + durum,
 *   - gecersiz deger sessizce varsayilana duser,
 *   - eski ?view=board|list|explorer baglantilari YERLESIM olarak calisir
 *     (explorer → board),
 *   - varsayilanlar URL'i kirletmez; gorunum degisince yerlesim/gruplama
 *     o gorunumun varsayilanina doner,
 *   - link ayni sonucu verir (E2): iki hook ayni URL'den ayni durumu okur.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import useTaskViewState from '../../features/tasks/hooks/useTaskViewState'
import {
    DEFAULT_LAYOUT, DEFAULT_VIEW_ID, GROUPS_BY_LAYOUT, SYSTEM_VIEWS, VIEW_LAYOUTS,
    isValidLayout, legacyLayoutOf, resolveView,
} from '../../features/tasks/model/views'

const wrapperFor = (initial) => {
    const Wrapper = ({ children }) => (
        <MemoryRouter initialEntries={[initial]}>
            <Routes>
                <Route path="/project-management" element={children} />
                <Route path="/project-management/:type" element={children} />
            </Routes>
        </MemoryRouter>
    )
    Wrapper.displayName = 'RouterWrapper'
    return Wrapper
}

const SAVED = [{ id: 'v-1', name: 'Vakko', scope: 'personal', saved: true, canEdit: true,
    filter: {}, defaultLayout: 'list', defaultGroup: 'due' }]

const renderView = (initial = '/project-management/tasks', saved = SAVED) =>
    renderHook(
        () => ({
            view: useTaskViewState({
                resolveDefaults: (id) => {
                    const v = resolveView(id, saved, { canViewAssignedByMe: true })
                    const layout = v.defaultLayout || DEFAULT_LAYOUT
                    return { layout, group: v.defaultGroup || null }
                },
            }),
            location: useLocation(),
        }),
        { wrapper: wrapperFor(initial) }
    )

describe('katalog', () => {
    it('uc yerlesim: pano · liste · takvim (E1/E5); explorer bir yerlesim DEGIL', () => {
        expect(VIEW_LAYOUTS.map((l) => l.value)).toEqual(['board', 'list', 'calendar'])
        expect(DEFAULT_LAYOUT).toBe('board')
        expect(isValidLayout('explorer')).toBe(false)
        expect(legacyLayoutOf('explorer')).toBe('board')
        expect(GROUPS_BY_LAYOUT.calendar).toEqual([])
    })

    it('sistem gorunumleri sabit ve triage (E3) icinde', () => {
        expect(SYSTEM_VIEWS.map((v) => v.id)).toEqual([
            'mine', 'assigned-by-me', 'triage', 'overdue', 'due-this-week',
            'completed-this-week', 'issues', 'suggestions', 'all',
        ])
        expect(DEFAULT_VIEW_ID).toBe('mine')
    })
})

describe('varsayilanlar', () => {
    it('parametre yokken: mine + pano + durum', () => {
        const { result } = renderView()
        expect(result.current.view.viewId).toBe('mine')
        expect(result.current.view.layout).toBe('board')
        expect(result.current.view.groupBy).toBe('status')
    })

    it('/project-management/issues → issues gorunumu', () => {
        const { result } = renderView('/project-management/issues')
        expect(result.current.view.viewId).toBe('issues')
    })

    it('kayitli gorunumun varsayilan yerlesim/gruplamasi URL bos iken uygulanir', () => {
        const { result } = renderView('/project-management/tasks?view=v-1')
        expect(result.current.view.viewId).toBe('v-1')
        expect(result.current.view.layout).toBe('list')
        expect(result.current.view.groupBy).toBe('due')
    })
})

describe('URL <-> eksenler', () => {
    it('eski ?view=board / ?view=list baglantilari yerlesim olarak calisir', () => {
        expect(renderView('/project-management/tasks?view=board').result.current.view.layout).toBe('board')
        const list = renderView('/project-management/tasks?view=list').result.current.view
        expect(list.layout).toBe('list')
        expect(list.viewId).toBe('mine')
    })

    it('?layout=calendar takvimi acar; gecersiz yerlesim varsayilana duser', () => {
        expect(renderView('/project-management/tasks?layout=calendar').result.current.view.layout).toBe('calendar')
        expect(renderView('/project-management/tasks?layout=zzz').result.current.view.layout).toBe('board')
    })

    it('gruplama yerlesime uymuyorsa yerlesimin varsayilanina duser', () => {
        const { result } = renderView('/project-management/tasks?layout=board&group=due')
        expect(result.current.view.groupBy).toBe('status')
    })

    it('yerlesim degisince URL guncellenir; varsayilana donunce parametre SILINIR', () => {
        const { result } = renderView()
        act(() => result.current.view.setLayout('list'))
        expect(result.current.location.search).toBe('?layout=list')
        expect(result.current.view.layout).toBe('list')
        act(() => result.current.view.setLayout('board'))
        expect(result.current.location.search).toBe('')
    })

    it('gorunum degisince yerlesim/gruplama parametreleri sifirlanir', () => {
        const { result } = renderView('/project-management/tasks?layout=list&group=owner')
        act(() => result.current.view.setViewId('overdue'))
        expect(result.current.location.search).toBe('?view=overdue')
        expect(result.current.view.layout).toBe('board')
        act(() => result.current.view.setViewId('mine'))
        expect(result.current.location.search).toBe('')
    })

    it('gruplama degisince URL guncellenir; diger parametreler KORUNUR', () => {
        const { result } = renderView('/project-management/tasks?item=abc&layout=list')
        act(() => result.current.view.setGroupBy('owner'))
        expect(result.current.location.search).toContain('item=abc')
        expect(result.current.location.search).toContain('layout=list')
        expect(result.current.location.search).toContain('group=owner')
    })

    it('eski ?view=board uzerinde yerlesim degisince eski parametre temizlenir', () => {
        const { result } = renderView('/project-management/tasks?view=board')
        act(() => result.current.view.setLayout('list'))
        expect(result.current.location.search).toBe('?layout=list')
    })

    it('link ayni sonucu verir: ayni URL, ayni durum (E2)', () => {
        const a = renderView('/project-management/tasks?view=triage&layout=list&group=project')
        const b = renderView('/project-management/tasks?view=triage&layout=list&group=project')
        expect(a.result.current.view).toMatchObject({ viewId: 'triage', layout: 'list', groupBy: 'project' })
        expect(b.result.current.view).toMatchObject({ viewId: 'triage', layout: 'list', groupBy: 'project' })
    })
})
