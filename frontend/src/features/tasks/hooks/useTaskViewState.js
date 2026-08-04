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

import { currentWeekStart } from '../model/dates'
import { DEFAULT_TASK_LAYOUT } from '../model/constants'

export function useTaskViewState({ canViewAssignedByMe }) {
    const [weekStart, setWeekStart] = useState(() => currentWeekStart())
    // §6.1: Explorer VARSAYILAN gorunumdur. Ilk render'da dogrudan
    // Explorer cizilir — once Board gosterip sonra gecis YOK.
    const [viewLayout, setViewLayout] = useState(DEFAULT_TASK_LAYOUT)
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
