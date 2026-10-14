/**
 * =============================================================================
 * HERMES - "Talep cozuldu → efor gir" (gorevdeki useTaskWorkLog'un esi)
 * =============================================================================
 * Iki giris noktasi, ayni durum:
 *   1. Talep cozuldugunde (detay ya da kanbana birakma) akis otomatik acilir,
 *   2. Cozulmus/kapanmis talepte "Efor gir" eylemi.
 * Kayit, Time Entry kaydiyla AYNI uctan yazilir; `ticket_id` ile talebe
 * baglanir (detayda toplam saat). Aciklamanin ilk satiri musteriye gore
 * numaradir ("Defacto Ticket-001"). Zaman girisi modulu kapaliysa acilmaz.
 * =============================================================================
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { message } from 'antd'

import { workLogService } from '../../services/api'
import { queryKeys } from '../../query/queryKeys'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'

export function useTicketWorkLog() {
    const t = useT()
    const queryClient = useQueryClient()
    const [logTicket, setLogTicket] = useState(null)
    const canLogTime = useAuthStore((s) => s.hasModule('time_entry'))

    const mutation = useMutation({
        mutationFn: (data) => workLogService.create(data, null),
        onSuccess: (_created, data) => {
            message.success(t('ticketLog.saved', { date: data?.date_worked ?? '' }))
            const ticketId = logTicket?.id
            setLogTicket(null)
            queryClient.invalidateQueries({ queryKey: queryKeys.workLogs.all })
            queryClient.invalidateQueries({ queryKey: queryKeys.periodStatus.all })
            if (ticketId) queryClient.invalidateQueries({ queryKey: queryKeys.tickets.detail(ticketId) })
        },
        onError: (err) => message.error(err?.response?.data?.detail || t('ticketLog.failed')),
    })

    return {
        canLogTime,
        logTicket,
        prefill: logTicket ? {
            ref: logTicket.customer_ref || logTicket.ticket_number,
            title: logTicket.title,
            customerId: logTicket.source_tenant?.customer_id || null,
        } : null,
        openLogTime: (ticket) => { if (canLogTime && ticket) setLogTicket(ticket) },
        closeLogTime: () => setLogTicket(null),
        submitWorkLog: async (data) => {
            await mutation.mutateAsync({ ...data, ticket_id: logTicket?.id || null })
        },
        isLoggingTime: mutation.isPending,
    }
}

export default useTicketWorkLog
