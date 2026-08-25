/**
 * HERMES - Ticket durum rozeti.
 *
 * Durum UC kanaldan birden anlatilir: ikon + metin + renk tonu. Yalnizca
 * renge dayanan bir gosterim, renk korlugu olan kullanicilar ve
 * dusuk-kontrastli ekranlar icin okunamaz olurdu.
 */
import { StatusBadge } from '../../components/ui'
import {
    AGENT_STATUS_LABELS,
    PRIORITY_LABELS,
    PRIORITY_TONES,
    STATUS_ICONS,
    STATUS_LABELS,
    STATUS_TONES,
    labelOf,
} from './constants'

export function TicketStatusBadge({ status, surface = 'portal' }) {
    const labels = surface === 'hub' ? AGENT_STATUS_LABELS : STATUS_LABELS
    return (
        <StatusBadge tone={STATUS_TONES[status] ?? 'neutral'}>
            <span aria-hidden="true">{STATUS_ICONS[status] ?? '•'}</span>
            <span>{labelOf(labels, status)}</span>
        </StatusBadge>
    )
}

export function TicketPriorityBadge({ priority }) {
    return (
        <StatusBadge tone={PRIORITY_TONES[priority] ?? 'neutral'}>
            {labelOf(PRIORITY_LABELS, priority)}
        </StatusBadge>
    )
}

export default TicketStatusBadge
