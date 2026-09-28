/**
 * HERMES - Ticket durum rozeti.
 *
 * Durum UC kanaldan birden anlatilir: ikon + metin + renk tonu. Yalnizca
 * renge dayanan bir gosterim, renk korlugu olan kullanicilar ve
 * dusuk-kontrastli ekranlar icin okunamaz olurdu.
 */
import { StatusBadge } from '../../components/ui'
import { PRIORITY_TONES, STATUS_ICONS, STATUS_TONES } from './constants'
import { useTicketLabel } from './useTicketLabel'

export function TicketStatusBadge({ status, surface = 'portal' }) {
    const tl = useTicketLabel()
    return (
        <StatusBadge tone={STATUS_TONES[status] ?? 'neutral'}>
            <span aria-hidden="true">{STATUS_ICONS[status] ?? '•'}</span>
            <span>{tl(surface === 'hub' ? 'agentStatus' : 'status', status)}</span>
        </StatusBadge>
    )
}

export function TicketPriorityBadge({ priority }) {
    const tl = useTicketLabel()
    return (
        <StatusBadge tone={PRIORITY_TONES[priority] ?? 'neutral'}>
            {tl('priority', priority)}
        </StatusBadge>
    )
}

export default TicketStatusBadge
