/**
 * =============================================================================
 * HERMES - Tasks liste sorgusu (Sprint 5C)
 * =============================================================================
 * Ekran durumu → liste parametreleri donusumu SAF modelden gelir
 * (model/taskQuery); burada kalan tek is onu React Query'ye baglamaktir.
 *
 * Cache anahtari MERKEZI sozlesmeden uretilir (queryKeys.tasks.list) ve
 * `stableFilters` sayesinde alan sirasindan bagimsizdir: ayni mantiksal
 * gorunum her zaman ayni anahtari verir. Kapsam, secili kullanici ve
 * filtreler anahtarin PARCASIDIR — kullanici degistiginde onceki
 * kullanicinin gorevleri bir an bile gorunmez.
 * =============================================================================
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { taskService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { quickFilterParams, todayKey, yesterdayKey } from '../model/dates'
import { buildTaskListParams } from '../model/taskQuery'

export function useTasksQuery({
    enabled, taskType, taskScope, viewedUserId, rangeMode, weekStart,
    quickFilter, filters, archiveState = 'active',
}) {
    const params = useMemo(
        () =>
            buildTaskListParams({
                taskType,
                statusFilter: filters.status,
                priorityFilter: filters.priority,
                customerFilter: filters.customer,
                projectFilter: filters.project,
                subProjectFilter: filters.subProject,
                taskScope,
                viewedUserId,
                rangeMode,
                weekStart,
                quickFilter: quickFilterParams(quickFilter, {
                    weekStart,
                    yesterday: yesterdayKey(),
                }),
                archiveState,
            }),
        [
            taskType, filters, taskScope, viewedUserId, rangeMode, weekStart,
            quickFilter, archiveState,
        ]
    )

    const query = useQuery({
        // `_day` YALNIZCA cache anahtarinin parcasidir, istege GITMEZ:
        // acik birakilan bir sekme gece yarisini gectiginde "bugun"e
        // bagli gorunumler (overdue rozeti, tarihsiz kanban) bayat
        // kalmasin diye. Onceki pozisyonel anahtardaki `todayStr`
        // ayni isi yapiyordu.
        queryKey: queryKeys.tasks.list({ ...params, _day: todayKey() }),
        queryFn: () => taskService.list(params),
        // Aktif kapsamin kayitlari YALNIZCA erisim varsa cekilir.
        enabled,
    })

    return {
        tasks: query.data ?? [],
        isLoading: query.isLoading,
        params,
    }
}

export default useTasksQuery
