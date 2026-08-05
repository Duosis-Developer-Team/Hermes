/**
 * =============================================================================
 * HERMES - Arsiv diyaloglari (arsivle / geri al)
 * =============================================================================
 * Ikisi de sayfadan degil bu tek noktadan cizilir; sayfa orkestrasyon
 * dosyasi olarak kalir.
 * =============================================================================
 */
import TaskArchiveModal from '../modals/TaskArchiveModal'
import TaskDeleteModal from '../modals/TaskDeleteModal'
import TaskRestoreModal from '../modals/TaskRestoreModal'

function TaskArchiveDialogs({ workspace, dialogs, deleteMutation }) {
    // Cift gonderim kilidi KAYNAKTA.
    const confirmCardArchive = () => {
        if (deleteMutation.isPending || !dialogs.deletingTask) return
        deleteMutation.mutate(dialogs.deletingTask.id, {
            onSuccess: dialogs.closeDelete,
        })
    }

    return (
        <>
            {/* Kart uzerindeki (eski adiyla Delete) arsivleme onayi.
                Backend zaten soft-archive yapiyordu; metinler Archive
                diline cevrildi. */}
            <TaskDeleteModal
                task={dialogs.deletingTask}
                loading={deleteMutation.isPending}
                onCancel={dialogs.closeDelete}
                onConfirm={confirmCardArchive}
            />
            <TaskArchiveModal
                item={workspace.archiveTarget}
                loading={workspace.archiving}
                onCancel={workspace.cancelArchive}
                onConfirm={workspace.confirmArchive}
            />
            <TaskRestoreModal
                item={workspace.restoreTarget}
                loading={workspace.restoring}
                onCancel={workspace.cancelRestore}
                onConfirm={workspace.confirmRestore}
            />
        </>
    )
}

export default TaskArchiveDialogs
