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
 * Hata durumunda modal ACIK kalir (mutation onError kapatmaz) — islem
 * basarisiz oldugunda diyalogun kapanmasi "yapildi" izlenimi veriyordu.
 *
 * TERMINOLOJI (2026-08-05): bu akis GERCEK SILME DEGILDIR — backend
 * `archived_at` yazar, kayit korunur ve geri alinabilir. UI'da "Delete"
 * demek kullaniciya yanlis bir kalicilik hissi veriyordu; metinler
 * Archive diline cevrildi.
 * =============================================================================
 */
import { ExclamationCircleOutlined, InboxOutlined } from '@ant-design/icons'

import DangerConfirmModal from '../../../components/common/DangerConfirmModal'
import { typeMeta } from '../../../utils/workItemType'

function TaskDeleteModal({ task, loading, onCancel, onConfirm }) {
    const meta = typeMeta(task?.task_type)
    return (
        <DangerConfirmModal
            open={!!task}
            title={`Archive ${meta.singular}`}
            subtitle={`The ${meta.lower} moves out of the Active workspace. Nothing is deleted.`}
            badgeIcon={<ExclamationCircleOutlined />}
            confirmIcon={<InboxOutlined />}
            itemName={task?.title}
            itemSubtitle={
                [task?.customer_name, task?.project_name]
                    .filter(Boolean)
                    .join(' · ') || undefined
            }
            body="Archive this work item? History, comments and logged time stay unchanged, and you can restore it later."
            confirmLabel="Archive now"
            loading={loading}
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    )
}

export default TaskDeleteModal
