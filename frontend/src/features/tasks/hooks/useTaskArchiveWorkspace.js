/**
 * =============================================================================
 * HERMES - Arsiv calisma alani (eksen + diyaloglar + mutation'lar)
 * =============================================================================
 * Sayfa bir ORKESTRASYON dosyasidir; arsiv akisinin durumu ve kurallari
 * burada yasar. Boylece Active|Archive ekseni, onay diyaloglari ve
 * mutation kilitleri tek yerden okunur.
 * =============================================================================
 */
import { useState } from 'react'

import useTaskArchiveMutations from './useTaskArchiveMutations'
import useTaskArchiveState from './useTaskArchiveState'
import { isReadOnlyState } from '../model/taskLifecycle'

export function useTaskArchiveWorkspace() {
    const { archiveState, setArchiveState } = useTaskArchiveState()
    const [archiveTarget, setArchiveTarget] = useState(null)
    const [restoreTarget, setRestoreTarget] = useState(null)

    const ops = useTaskArchiveMutations({
        onArchived: () => setArchiveTarget(null),
        onRestored: () => setRestoreTarget(null),
    })

    return {
        archiveState,
        setArchiveState,
        // Arsiv havuzu SALT OKUNUR: durum mutasyonu, surukleme ve
        // olusturma kapali; tek istisna acik Restore akisidir.
        readOnly: isReadOnlyState(archiveState),
        archiveTarget,
        restoreTarget,
        requestArchive: setArchiveTarget,
        requestRestore: setRestoreTarget,
        cancelArchive: () => setArchiveTarget(null),
        cancelRestore: () => setRestoreTarget(null),
        confirmArchive: () => {
            const id = archiveTarget?.representative?.id || archiveTarget?.id
            if (id) ops.archive(id)
        },
        confirmRestore: ({ assignmentTaskId, targetStatus }) => {
            const id = restoreTarget?.representative?.id || restoreTarget?.id
            if (id) ops.restore({ taskId: id, assignmentTaskId, targetStatus })
        },
        archiving: ops.archiveMutation.isPending,
        restoring: ops.restoreMutation.isPending,
    }
}

export default useTaskArchiveWorkspace
