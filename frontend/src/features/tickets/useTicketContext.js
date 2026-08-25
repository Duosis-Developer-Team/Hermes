/**
 * HERMES - Ticket yuzey baglami.
 *
 * "Hangi ekrani gostereceğiz?" sorusunun cevabi SUNUCUDAN gelir. Tenant
 * kimliğini frontend'e gömmek (ör. "Duosis UUID'si buysa hub göster")
 * hem kırılgan hem de yanlış olurdu: support tenant'ı bir ConfigMap
 * değeridir ve ortama göre değişir.
 */
import { useQuery } from '@tanstack/react-query'

import { ticketContextService } from '../../api/ticketsApi'
import { queryKeys } from '../../query/queryKeys'

export function useTicketContext() {
    const query = useQuery({
        queryKey: queryKeys.ticketContext.all,
        queryFn: ticketContextService.get,
        staleTime: 60_000,
        retry: 1,
    })
    const data = query.data
    return {
        ...query,
        context: data,
        surface: data?.surface ?? null,
        isHub: data?.surface === 'hub',
        isPortal: data?.surface === 'portal',
        permissions: data?.permissions ?? [],
        can: (code) => (data?.permissions ?? []).includes(code),
        canCreate: Boolean(data?.can_create),
        hasScope: data?.has_scope !== false,
        route: data?.route ?? null,
        attachmentsEnabled: Boolean(data?.attachments_enabled),
    }
}

export default useTicketContext
