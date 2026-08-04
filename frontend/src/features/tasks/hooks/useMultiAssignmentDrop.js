/**
 * =============================================================================
 * HERMES - Coklu atama surukleme onayi (§11)
 * =============================================================================
 * Bir logical work item'in arkasinda birden fazla DEGISTIRILEBILIR
 * assignment varsa, surukleme SESSIZCE toplu guncelleme yapmaz. Bu hook
 * karari kullaniciya birakan akisi tutar; istek yalnizca kullanici
 * secim yaptiktan sonra ve HER assignment icin AYRI AYRI, mevcut tekil
 * akistan (optimistic update / rollback / mutation lock) gecerek gider.
 *
 * Completed hedefi ozeldir: log-time sozlesmesi kisiye ozeldir ve
 * baskasi adina kayit URETILMEZ. Bu yuzden Completed'a tasimada yalniz
 * kullanicinin KENDI atamasi secilebilir; digerleri icin toplu
 * tamamlama ENGELLENIR.
 * =============================================================================
 */
import { useState } from 'react'

import { isOwnAssignment } from '../model/permissions'

export function useMultiAssignmentDrop({ currentUserId, applyDrop, notify }) {
    const [pending, setPending] = useState(null)

    const start = (item, { newStatus, candidates }) => {
        const own = candidates.filter((task) =>
            isOwnAssignment({ task, currentUserId })
        )
        if (newStatus === 'completed') {
            if (own.length === 0) {
                notify?.(
                    'Completing on behalf of others is not allowed — each '
                    + 'assignee completes their own work item and logs time.'
                )
                return
            }
            // Tek kendi atamasi: mevcut tekil akis aynen calisir.
            if (own.length === 1) {
                applyDrop(own[0], { newStatus })
                return
            }
        }
        setPending({
            item,
            newStatus,
            candidates: newStatus === 'completed' ? own : candidates,
            selected: [],
        })
    }

    const toggle = (taskId, checked) =>
        setPending((prev) => prev && ({
            ...prev,
            selected: checked
                ? [...prev.selected, taskId]
                : prev.selected.filter((id) => id !== taskId),
        }))

    const cancel = () => setPending(null)

    const confirm = async () => {
        if (!pending || pending.selected.length === 0) return
        const { newStatus, candidates, selected } = pending
        const chosen = candidates.filter((t) => selected.includes(t.id))
        setPending(null)
        for (const task of chosen) {
            await applyDrop(task, { newStatus })
        }
    }

    return { pending, start, toggle, cancel, confirm }
}

export default useMultiAssignmentDrop
