/**
 * =============================================================================
 * HERMES - Durum degisikligi onay metni (Sprint 5C)
 * =============================================================================
 * "Gorevin MEVCUT durumu + istenen hedef" → diyalog basligi/govdesi/
 * dugme etiketi/ikonu. Ucuncu bir varyant YOKTUR; metin turetilir, elle
 * secilmez — boylece is akisi kurali (pending gorev DOGRUDAN tamamlanamaz,
 * once KABUL edilir) tek yerde durur.
 *
 * Ayri dosyada olmasinin sebebi: component dosyalari yalnizca component
 * export etmeli (react-refresh kurali, lint ratchet'i bunu yakaladi).
 * =============================================================================
 */
import {
    CheckCircleOutlined, PlayCircleOutlined, UndoOutlined,
} from '@ant-design/icons'

// `t` PARAMETRE olarak gelir: bu SAF bir fonksiyondur (dosyanin kendi
// aciklamasi da boyle der) ve hook cagiramaz.
export function statusConfirmConfig({ task, nextCompleted }, t) {
    // Pending → tamamla istegi ONCE kabul adimina donusur.
    if (nextCompleted && task.status === 'pending') {
        return {
            title: t('lifecycle.acceptTask'),
            body: 'The task will move to In Progress so you can start working on it.',
            confirmLabel: 'Accept Task',
            icon: <PlayCircleOutlined />,
        }
    }
    if (nextCompleted) {
        return {
            title: t('lifecycle.completeTask'),
            body: 'This marks the task as completed. You can reopen it afterwards if needed.',
            confirmLabel: 'Mark as Completed',
            icon: <CheckCircleOutlined />,
        }
    }
    return {
        title: t('lifecycle.reopenTask'),
        body: 'The task will move back to In Progress so it can be worked on again.',
        confirmLabel: 'Reopen',
        icon: <UndoOutlined />,
    }
}

export default statusConfirmConfig
