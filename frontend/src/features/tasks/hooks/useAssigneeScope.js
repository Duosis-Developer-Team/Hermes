/**
 * =============================================================================
 * HERMES - Kisi ekseni: secenekler + istemci tarafi daraltma
 * =============================================================================
 * "Assigned by Me" kapsaminda atayan kisi, kimin neyi yaptigini kisiye
 * gore izleyebilmeli. "My Tasks"ta tek kisi vardir (kullanicinin
 * kendisi), bu yuzden eksen orada HIC gosterilmez.
 *
 * FILTRE NEDEN ISTEMCIDE UYGULANIR:
 * Liste ucu, admin OLMAYAN cagirana ait `assignee_user_id` parametresini
 * SESSIZCE kendisine zorlar (task_service.list_tasks_for_user, RBAC
 * savunmasi). "Assigned by Me + su kisiyi goster" istegi sunucuya
 * gonderilseydi atayan kisi KENDI gorevlerini gorurdu — yanlis sonuc.
 * Sonuc kumesi zaten RBAC filtreli ve SAYFALAMASIZ geldigi icin kisiye
 * gore daraltmak istemcide dogrudur ve sizinti uretmez: hic gelmemis
 * bir kayit filtrelenemez.
 *
 * Secenekler GORUNUR kayitlardan turetilir — listede hic assignment'i
 * olmayan bir kisi burada gorunmez, yani dizin uzerinden "kim var"
 * bilgisi sizmaz (§13).
 * =============================================================================
 */
import { useMemo } from 'react'

import { userLabel } from '../model/grouping'

export function useAssigneeScope({ tasks, taskScope, userMap, assigneeFilter }) {
    const isAssignedByMe = taskScope === 'assigned-by-me'

    const assigneeOptions = useMemo(() => {
        if (!isAssignedByMe) return null
        const seen = new Map()
        for (const t of tasks || []) {
            const id = t.assignee_user_id
            if (!id || seen.has(id)) continue
            seen.set(id, { value: id, label: userLabel(id, userMap) })
        }
        return [...seen.values()].sort((a, b) =>
            a.label.localeCompare(b.label, 'en')
        )
    }, [isAssignedByMe, tasks, userMap])

    const visibleTasks = useMemo(() => {
        if (!isAssignedByMe || !assigneeFilter) return tasks
        return (tasks || []).filter((t) => t.assignee_user_id === assigneeFilter)
    }, [tasks, isAssignedByMe, assigneeFilter])

    return { isAssignedByMe, assigneeOptions, visibleTasks }
}

export default useAssigneeScope
