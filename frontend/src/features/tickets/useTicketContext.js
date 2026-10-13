/**
 * HERMES - Ticket yuzey baglami.
 *
 * "Hangi ekrani gostereceğiz?" sorusunun cevabi SUNUCUDAN gelir. Tenant
 * kimliğini frontend'e gömmek (ör. "Duosis UUID'si buysa hub göster")
 * hem kırılgan hem de yanlış olurdu: support tenant'ı bir ConfigMap
 * değeridir ve ortama göre değişir.
 */
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'

import { ticketContextService } from '../../api/ticketsApi'
import { queryKeys } from '../../query/queryKeys'
import { useAuthStore } from '../../stores/authStore'

/** Ayar katalogunun ihtiyac duydugu ticket yetenekleri. Ayar sayfalari
 *  react-query'ye bagimli olmasin diye baglam yuklenince buraya yazilir;
 *  `null` = henuz bilinmiyor (filtre uygulanmaz). */
export const useTicketCaps = create(() => ({ integrations: null, hub: null }))

export const ticketSettingsCaps = (caps) =>
    (!caps || caps.integrations === null || caps.integrations === undefined
        ? null : { ticketIntegrations: Boolean(caps.integrations), ticketHub: Boolean(caps.hub) })

/** Saglayici listesi. Eski sunucu (`providers` yok) icin tek saglayici
 *  `route`tan turetilir — frontend ile core ayri anda yayina cikmayabilir. */
const providersOf = (data) => {
    if (Array.isArray(data?.providers)) return data.providers
    if (data?.surface !== 'portal') return []
    return [{
        tenant_id: null, display_name: null, is_active: true,
        can_create: Boolean(data.can_create), route: data.route ?? null,
    }]
}

export function useTicketContext() {
    // Talepler MODULU kapali tenant'ta baglam sorulmaz (yuzey yok).
    const ticketsEnabled = useAuthStore((s) => s.hasModule('tickets'))
    const query = useQuery({
        queryKey: queryKeys.ticketContext.all,
        queryFn: ticketContextService.get,
        staleTime: 60_000,
        retry: 1,
        enabled: ticketsEnabled,
    })
    const data = ticketsEnabled ? query.data : undefined
    // Talep agi: bir tenant hem saglayici (hub) hem talep eden (portal)
    // olabilir. Eski sunucu `surfaces` gondermezse `surface`tan turetilir.
    const surfaces = Array.isArray(data?.surfaces) && data.surfaces.length
        ? data.surfaces
        : (data?.surface && data.surface !== 'unavailable' ? [data.surface] : [])
    useEffect(() => {
        if (data) {
            useTicketCaps.setState({
                integrations: Boolean(data.integrations),
                hub: (data.surfaces || [data.surface]).includes('hub'),
            })
        }
    }, [data])
    const isHub = surfaces.includes('hub')
    const isPortal = surfaces.includes('portal')
    return {
        ...query,
        context: data,
        surface: data?.surface ?? null,
        surfaces,
        isHub,
        isPortal,
        isDual: isHub && isPortal,
        providers: providersOf(data),
        integrations: Boolean(data?.integrations),
        permissions: data?.permissions ?? [],
        can: (code) => (data?.permissions ?? []).includes(code),
        canCreate: Boolean(data?.can_create),
        hasScope: data?.has_scope !== false,
        route: data?.route ?? null,
        attachmentsEnabled: Boolean(data?.attachments_enabled),
    }
}

export default useTicketContext
