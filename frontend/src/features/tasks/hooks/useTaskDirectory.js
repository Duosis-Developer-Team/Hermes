/**
 * =============================================================================
 * HERMES - Tasks referans verisi + kullanici dizini (Sprint 5C)
 * =============================================================================
 * Filtre seceneklerini besleyen musteri/proje/alt-proje sorgulari ve
 * gorev listesindeki kimlikleri ISME cozen tek /users/lookup cagrisi.
 *
 * Ham UUID kullaniciya ASLA gosterilmez; cozulemeyen kimlik notr bir
 * tire olur (TaskCard.userLabel). Admin ayrica tum aktif kullanicilari
 * ceker (kullanici secici) ve iki sonuc kumesi TEK bir userMap'te
 * birlesir — secici, kartlar ve swimlane basliklari ayni adi gorur.
 * =============================================================================
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
    authService, customerService, projectService, taskSubProjectService,
} from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'

export function useTaskDirectory({
    enabled, isTaskAdmin, currentUser, tasks, customerFilter, projectFilter,
}) {
    const { data: customers = [] } = useQuery({
        queryKey: queryKeys.customers.all,
        queryFn: () => customerService.getAll(),
        enabled,
    })

    const { data: projects = [] } = useQuery({
        queryKey: queryKeys.projects.all,
        queryFn: () => projectService.getAll(),
        enabled,
    })

    const filteredProjects = useMemo(() => {
        if (!customerFilter) return projects
        return projects.filter((p) => p.customer_id === customerFilter)
    }, [projects, customerFilter])

    const { data: subProjects = [] } = useQuery({
        queryKey: queryKeys.taskSubProjects.list(customerFilter, projectFilter),
        queryFn: () =>
            taskSubProjectService.list({
                customer_id: customerFilter || undefined,
                project_id: projectFilter || undefined,
            }),
        enabled,
    })

    // Gorev listesinin ATIFTA BULUNDUGU her kimlik — tek lookup cagrisi.
    const referencedUserIds = useMemo(() => {
        const ids = new Set()
        for (const t of tasks) {
            if (t.assignee_user_id) ids.add(t.assignee_user_id)
            if (t.assigner_user_id) ids.add(t.assigner_user_id)
            if (t.completed_by_user_id) ids.add(t.completed_by_user_id)
        }
        return Array.from(ids)
    }, [tasks])

    const { data: usersForTasks = [] } = useQuery({
        queryKey: queryKeys.authUsersLookup.byIds(referencedUserIds),
        queryFn: () => authService.lookupUsers({ ids: referencedUserIds }),
        enabled: enabled && referencedUserIds.length > 0,
        staleTime: 60 * 1000,
    })

    const { data: allActiveUsers = [] } = useQuery({
        queryKey: queryKeys.authUsersLookup.activeUsers(),
        queryFn: () => authService.lookupUsers(),
        enabled: enabled && isTaskAdmin,
        staleTime: 60 * 1000,
    })

    const userMap = useMemo(() => {
        const map = {}
        for (const u of allActiveUsers) map[u.id] = u
        for (const u of usersForTasks) map[u.id] = u
        return map
    }, [usersForTasks, allActiveUsers])

    // Admin kullanici secicisinin secenekleri. Admin olmayan yalnizca
    // KENDISINI gorur — secici zaten gizlidir, bu ikinci savunmadir.
    const userSelectorOptions = useMemo(() => {
        if (!currentUser?.id) return []
        const me = { value: currentUser.id, label: currentUser.full_name || 'Me' }
        if (!isTaskAdmin) return [me]
        const others = allActiveUsers
            .filter((u) => u.id !== currentUser.id)
            .map((u) => ({ value: u.id, label: u.full_name || u.email }))
        return [me, ...others]
    }, [currentUser, isTaskAdmin, allActiveUsers])

    return {
        customers,
        projects,
        filteredProjects,
        subProjects,
        userMap,
        allActiveUsers,
        userSelectorOptions,
    }
}

export default useTaskDirectory
