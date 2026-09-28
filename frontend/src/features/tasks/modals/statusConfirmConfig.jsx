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

// Onay metinleri inceleme penceresiyle AYNI anahtarlardan (tek kaynak).
const noun = (t) => ({ noun: t('review.noun.task'), Noun: t('review.nounCap.task') })

// `t` PARAMETRE olarak gelir: bu SAF bir fonksiyondur (dosyanin kendi
// aciklamasi da boyle der) ve hook cagiramaz.
export function statusConfirmConfig({ task, nextCompleted }, t) {
    // Pending → tamamla istegi ONCE kabul adimina donusur.
    if (nextCompleted && task.status === 'pending') {
        return {
            title: t('lifecycle.acceptTask'),
            body: t('review.confirm.acceptBody', noun(t)),
            confirmLabel: t('review.accept', noun(t)),
            icon: <PlayCircleOutlined />,
        }
    }
    if (nextCompleted) {
        return {
            title: t('lifecycle.completeTask'),
            body: t('review.confirm.completeBody', noun(t)),
            confirmLabel: t('review.markCompleted'),
            icon: <CheckCircleOutlined />,
        }
    }
    return {
        title: t('lifecycle.reopenTask'),
        body: t('review.confirm.reopenBodyCompleted', noun(t)),
        confirmLabel: t('review.reopen'),
        icon: <UndoOutlined />,
    }
}

export default statusConfirmConfig
