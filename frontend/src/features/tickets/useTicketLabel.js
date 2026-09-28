/**
 * HERMES - Ticket etiketleri icin dil duyarli okuyucu.
 *
 * Sozlesme kodlari (durum, oncelik, kategori...) sabittir; kullaniciya
 * gosterilen etiket `ticketLabels.<sozluk>.<kod>` ceviri anahtarindan
 * gelir. Bilinmeyen kod (sozlesme v1 icinde yeni deger) icin constants.js
 * sozlugu ve en sonda ham kod — ekran KIRILMAZ.
 */
import { useCallback } from 'react'

import { useT } from '../../i18n'
import {
    AGENT_STATUS_LABELS, CATEGORY_LABELS, IMPACT_LABELS, PRIORITY_LABELS,
    QUEUE_LABELS, RESOLUTION_LABELS, STATUS_LABELS, labelOf,
} from './constants'

const FALLBACK = {
    status: STATUS_LABELS,
    agentStatus: AGENT_STATUS_LABELS,
    category: CATEGORY_LABELS,
    impact: IMPACT_LABELS,
    priority: PRIORITY_LABELS,
    resolution: RESOLUTION_LABELS,
    queue: QUEUE_LABELS,
}

export function useTicketLabel() {
    const t = useT()
    return useCallback((dict, value) => {
        const key = `ticketLabels.${dict}.${value}`
        const text = t(key)
        return text !== key ? text : labelOf(FALLBACK[dict] || {}, value)
    }, [t])
}

export default useTicketLabel
