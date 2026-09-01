/**
 * =============================================================================
 * HERMES - Durum degisikligi onayi (Sprint 5C)
 * =============================================================================
 * Checkbox ile tetiklenen durum degisiklikleri (kabul / tamamla / yeniden
 * ac) once onay ister — yanlislikla yapilan bir tiklama gorevin durumunu
 * SESSIZCE degistiremez (§7 destructive/irreversible eylem kurali).
 *
 * Metin/ikon secimi saf bir fonksiyondan gelir (statusConfirmConfig);
 * bu dosya yalnizca paylasilan onay primitive'ini besler.
 * =============================================================================
 */
import DangerConfirmModal from '../../../components/common/DangerConfirmModal'
import { statusConfirmConfig } from './statusConfirmConfig'
import { useT } from '../../../i18n'

function TaskStatusConfirmModal({ pendingToggle, loading, onCancel, onConfirm }) {
    const t = useT()
    if (!pendingToggle) return null
    const { task } = pendingToggle
    const cfg = statusConfirmConfig(pendingToggle, t)
    return (
        <DangerConfirmModal
            open
            tone="primary"
            badgeIcon={cfg.icon}
            confirmIcon={cfg.icon}
            title={cfg.title}
            body={cfg.body}
            itemName={task.title}
            itemSubtitle={
                [task.customer_name, task.project_name]
                    .filter(Boolean)
                    .join(' · ') || undefined
            }
            confirmLabel={cfg.confirmLabel}
            loading={loading}
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    )
}

export default TaskStatusConfirmModal
