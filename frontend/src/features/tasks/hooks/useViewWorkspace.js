/**
 * =============================================================================
 * HERMES - Gorunum calisma alani (PM rework P3.5 / E1, E2)
 * =============================================================================
 * "Ekranin durumu = secili gorunum" sozlesmesinin tek sahibi:
 *   - URL'deki gorunum/yerlesim/gruplama (useTaskViewState)
 *   - kayitli gorunumler (useSavedViews) + sistem gorunumleri (model)
 *   - drawer filtreleri: gorunum degisince o gorunumun filtreleriyle baslar
 *   - "sapti mi?" ve kaydet/guncelle/sil akislari
 * Sorgu parametrelerini kendisi URETMEZ; buildTaskListParams girdilerini
 * (viewQueryInputs) verir.
 * =============================================================================
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { yesterdayKey } from '../model/dates'
import {
    DEFAULT_VIEW_ID, createTypeOfView, filtersOfView, groupOfView, isViewDirty,
    layoutOfView, resolveView, systemViewsFor, toFilterJson, viewQueryInputs,
} from '../model/views'
import useSavedViews from './useSavedViews'
import useTaskFilters from './useTaskFilters'
import useTaskViewState from './useTaskViewState'

export function useViewWorkspace({ canViewAssignedByMe = false, enabled = true } = {}) {
    const saved = useSavedViews({ enabled })
    const savedViews = saved.savedViews

    const resolveDefaults = useCallback((id) => {
        const v = resolveView(id, savedViews, { canViewAssignedByMe })
        const layout = layoutOfView(v)
        return { layout, group: groupOfView(v, layout) }
    }, [savedViews, canViewAssignedByMe])

    const state = useTaskViewState({ resolveDefaults })
    const view = useMemo(
        () => resolveView(state.viewId, savedViews, { canViewAssignedByMe }),
        [state.viewId, savedViews, canViewAssignedByMe],
    )

    const { filters, clearFilters, replaceFilters, ...filterActions } = useTaskFilters()

    // Gorunum KIMLIGI degisince drawer o gorunumun filtreleriyle baslar.
    // (Ayni gorunum yeniden cozulunce — kayitli liste yenilenince —
    // kullanicinin drawer'da yaptigi degisiklik korunur.)
    const lastViewId = useRef(null)
    useEffect(() => {
        if (lastViewId.current === view.id) return
        lastViewId.current = view.id
        replaceFilters(filtersOfView(view))
        // replaceFilters stabil (setState sarmalayici); yalnizca gorunum kimligi izlenir.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view.id])

    const dirty = isViewDirty(view, { filters, layout: state.layout, group: state.groupBy })
    const queryInputs = useMemo(
        () => viewQueryInputs(view, { weekStart: state.weekStart, yesterday: yesterdayKey() }),
        [view, state.weekStart],
    )

    const systemViews = useMemo(() => systemViewsFor({ canViewAssignedByMe }), [canViewAssignedByMe])

    // Sol kolon "Projeler": klasor secimi = capraz filtre.
    const folderSelection = useMemo(() => ({
        customer: filters.customer, project: filters.project, subProject: filters.subProject,
    }), [filters.customer, filters.project, filters.subProject])
    const selectFolder = (sel) => {
        if (!sel) {
            filterActions.setCustomer(null)
            return
        }
        filterActions.setCustomer(sel.customer || null)
        if (sel.project) filterActions.setProject(sel.project)
        if (sel.subProject) filterActions.setSubProject(sel.subProject)
    }

    const saveAs = async ({ name, scope }) => {
        const created = await saved.createView({
            name, scope, layout: state.layout,
            filter_json: toFilterJson(view, { filters, group: state.groupBy }),
        })
        if (created?.id) state.setViewId(created.id)
        return created
    }
    const updateCurrent = () => saved.updateView({
        id: view.id,
        data: { layout: state.layout, filter_json: toFilterJson(view, { filters, group: state.groupBy }) },
    })
    const removeView = async (target) => {
        await saved.deleteView(target.id)
        if (target.id === view.id) state.setViewId(DEFAULT_VIEW_ID)
    }

    return {
        ...state,
        view,
        systemViews,
        personalViews: saved.personal,
        sharedViews: saved.shared,
        isSaving: saved.isSaving,
        filters,
        filterActions,
        clearFilters,
        folderSelection,
        selectFolder,
        dirty,
        canUpdate: !!(view.saved && view.canEdit),
        queryInputs,
        createType: createTypeOfView(view),
        saveAs,
        updateCurrent,
        removeView,
    }
}

export default useViewWorkspace
