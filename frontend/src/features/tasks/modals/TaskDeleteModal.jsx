/**
 * =============================================================================
 * HERMES - Gorev silme onayi (Sprint 5C)
 * =============================================================================
 * Sayfanin icinde satir satir yazilmis 95 satirlik Modal, PAYLASILAN
 * DangerConfirmModal primitive'ine tasindi. Gorunum birebir ayni kalir —
 * o primitive'in basligindaki not zaten "Time Entry / Tasks satir-ici
 * silme modallariyla GORSEL OLARAK AYNI" diyordu; artik kopya degil ayni
 * bilesen. Kazanimlar: erisilebilir diyalog adi, pending'te kapanma
 * kilidi ve ham `rgba(239,68,68,…)` / `#ef4444` degerlerinin gitmesi.
 *
 * Hata durumunda modal ACIK kalir (mutation onError kapatmaz) — silme
 * basarisiz oldugunda diyalogun kapanmasi "silindi" izlenimi veriyordu.
 * =============================================================================
 */
import { DeleteOutlined, ExclamationCircleOutlined } from '@ant-design/icons'

import DangerConfirmModal from '../../../components/common/DangerConfirmModal'
import { typeMeta } from '../../../utils/workItemType'

function TaskDeleteModal({ task, loading, onCancel, onConfirm }) {
    const meta = typeMeta(task?.task_type)
    return (
        <DangerConfirmModal
            open={!!task}
            title={`Delete ${meta.singular}`}
            subtitle={`The ${meta.lower} will be archived and removed from the board.`}
            badgeIcon={<ExclamationCircleOutlined />}
            confirmIcon={<DeleteOutlined />}
            itemName={task?.title}
            itemSubtitle={
                [task?.customer_name, task?.project_name]
                    .filter(Boolean)
                    .join(' · ') || undefined
            }
            body="Are you sure you want to delete this task?"
            confirmLabel="Delete"
            loading={loading}
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    )
}

export default TaskDeleteModal
