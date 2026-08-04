/**
 * =============================================================================
 * HERMES - Tasks gorunum durumu (Sprint 5C)
 * =============================================================================
 * Kapsam / layout / zaman araligi / hizli filtre / swimlane / admin
 * kullanici secimi — kullanicinin BAKIS ACISINI belirleyen eksenler.
 * Hepsi BAGIMSIZDIR: hicbiri digerini otomatik cevirmez.
 *
 * Capraz filtreler (status/priority/customer/...) buraya AIT DEGILDIR;
 * onlar useTaskFilters'ta durur — biri "neye bakiyorum", digeri "neyi
 * eliyorum" sorusunu cevaplar.
 * =============================================================================
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { currentWeekStart } from '../model/dates'
import { DEFAULT_TASK_LAYOUT, isValidTaskLayout } from '../model/constants'

export function useTaskViewState({ canViewAssignedByMe }) {
    const [weekStart, setWeekStart] = useState(() => currentWeekStart())
    /*
     * GORUNUM URL'DE YASAR (§6.1) — tek kaynak.
     *   /project-management/tasks                → Explorer (varsayilan)
     *   /project-management/tasks?view=board     → Board
     *   /project-management/tasks?view=list      → List
     *
     * Yerel state TUTULMAZ: ikisi birden olsaydi ilk render'da Board
     * cizilip hemen Explorer'a gecen bir GORSEL FLASH olusurdu. Deger
     * dogrudan URL'den okundugu icin ilk boyama zaten dogru gorunumdur.
     * Gecersiz/eski bir deger sessizce varsayilana duser.
     *
     * setSearchParams PUSH yapar → tarayici geri/ileri tuslari gorunum
     * degisikliklerinde dogru calisir.
     */
    const [searchParams, setSearchParams] = useSearchParams()
    const urlView = searchParams.get('view')
    const viewLayout = isValidTaskLayout(urlView) ? urlView : DEFAULT_TASK_LAYOUT

    const setViewLayout = (next) => {
        const params = new URLSearchParams(searchParams)
        // Varsayilan gorunum URL'i KIRLETMEZ.
        if (next === DEFAULT_TASK_LAYOUT) params.delete('view')
        else params.set('view', next)
        setSearchParams(params)
    }
    const [rangeMode, setRangeMode] = useState('all')
    const [groupByAssignee, setGroupByAssignee] = useState(false)
    const [taskScope, setTaskScope] = useState('my-tasks')
    const [quickFilter, setQuickFilter] = useState(null)
    // Admin-only user selector (Time Entry parity). null → current user.
    const [selectedUserId, setSelectedUserId] = useState(null)

    // Izin acikken kaldirilirsa ve kullanici Assigned-by-Me kapsamindaysa
    // My Tasks'a duser (render sirasinda duzeltilir — bir sonraki render
    // dogru kapsamla cizilir, yetkisiz veri istegi ACILMAZ).
    if (taskScope === 'assigned-by-me' && !canViewAssignedByMe) {
        setTaskScope('my-tasks')
    }

    return {
        weekStart,
        setWeekStart,
        goToPreviousWeek: () => setWeekStart((p) => p.subtract(1, 'week')),
        goToNextWeek: () => setWeekStart((p) => p.add(1, 'week')),
        goToCurrentWeek: () => setWeekStart(currentWeekStart()),
        viewLayout,
        setViewLayout,
        rangeMode,
        setRangeMode,
        groupByAssignee,
        setGroupByAssignee,
        taskScope,
        setTaskScope,
        quickFilter,
        // Aktif cipe tekrar tiklamak filtreyi TEMIZLER.
        toggleQuickFilter: (value) =>
            setQuickFilter((prev) => (prev === value ? null : value)),
        clearQuickFilter: () => setQuickFilter(null),
        selectedUserId,
        setSelectedUserId,
    }
}

export default useTaskViewState
