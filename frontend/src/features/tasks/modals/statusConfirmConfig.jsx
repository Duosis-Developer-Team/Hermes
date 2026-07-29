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

export function statusConfirmConfig({ task, nextCompleted }) {
    // Pending → tamamla istegi ONCE kabul adimina donusur.
    if (nextCompleted && task.status === 'pending') {
        return {
            title: 'Accept this task?',
            body: 'The task will move to In Progress so you can start working on it.',
            confirmLabel: 'Accept Task',
            icon: <PlayCircleOutlined />,
        }
    }
    if (nextCompleted) {
        return {
            title: 'Mark task as completed?',
            body: 'This marks the task as completed. You can reopen it afterwards if needed.',
            confirmLabel: 'Mark as Completed',
            icon: <CheckCircleOutlined />,
        }
    }
    return {
        title: 'Reopen this task?',
        body: 'The task will move back to In Progress so it can be worked on again.',
        confirmLabel: 'Reopen',
        icon: <UndoOutlined />,
    }
}

export default statusConfirmConfig
