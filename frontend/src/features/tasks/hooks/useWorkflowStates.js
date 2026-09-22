/**
 * =============================================================================
 * HERMES - Is akisi durumlari (workflow_states) — PM rework P1
 * =============================================================================
 * Pano sutunlari ve durum sozlugu icin TEK kaynak: `GET /core/tasks/states`.
 * Sunucu her durum icin `legacy_status` (pending/in_progress/completed/
 * cancelled) verir; P1'de sutunlar bu uc eski anahtara iner (ozel durumlar
 * kategorisiyle ayni sutuna duser). Etiket ceviriden gelir; sunucudaki
 * durum adi (`stateName`) ve kimligi (`stateId`) sutuna ILISTIRILIR.
 *
 * FALLBACK: uc erisilemezse/henuz donmediyse eski uc sutun kullanilir —
 * kart ekrandan asla kaybolmaz, pano bos kalmaz.
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'

import { taskService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'

/** Eski uc sutun — sira ve ceviri anahtarlari sozlesmedir. */
export const FALLBACK_COLUMNS = [
    { status: 'pending', labelKey: 'plan.pending', stateId: null, stateName: null },
    { status: 'in_progress', labelKey: 'board.inProgress', stateId: null, stateName: null },
    { status: 'completed', labelKey: 'board.completed', stateId: null, stateName: null },
]

/**
 * Sunucu durumlarindan pano sutunlari. Sutun kumesi ve sirasi sabittir;
 * her sutuna eslesen (aktif, ayni legacy_status) ILK durum ilistirilir.
 * Durum listesi bos/gecersizse fallback doner.
 */
export function boardColumnsOf(states) {
    if (!Array.isArray(states) || states.length === 0) return FALLBACK_COLUMNS
    const active = states
        .filter((s) => s && s.is_active !== false)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    return FALLBACK_COLUMNS.map((col) => {
        const match = active.find((s) => s.legacy_status === col.status)
        return match
            ? { ...col, stateId: match.id, stateName: match.name }
            : col
    })
}

export function useWorkflowStates({ enabled = true } = {}) {
    const query = useQuery({
        queryKey: queryKeys.tasks.states(),
        queryFn: () => taskService.listStates(),
        enabled,
        staleTime: 5 * 60 * 1000,
        retry: false,
    })
    const states = Array.isArray(query.data) ? query.data : []
    return {
        states,
        columns: boardColumnsOf(states),
        isFallback: states.length === 0,
        isLoading: query.isLoading,
    }
}

export default useWorkflowStates
