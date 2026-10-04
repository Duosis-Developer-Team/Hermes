/**
 * =============================================================================
 * HERMES - Toplanti otomatik senkronu (kabuk acilisinda)
 * =============================================================================
 * Toplantilar Microsoft takviminden yalniz Toplantilar sayfasi acilinca
 * cekiliyordu (`/meetings/sync-me`); ana sayfadaki "Takvimim" ve adanin
 * "siradaki toplanti" yuvasi o ana kadar DB'de ne varsa onu gosteriyor,
 * sayfa ziyaret edilmeden "Nothing planned" diyordu (05.10).
 *
 * Kabuk (MainLayout) yuklenince bu haftanin takvimi arka planda BIR KEZ
 * cekilir, basariliysa ana sayfa ve toplanti sorgulari tazelenir. Kisitlama:
 * ayni tarayici oturumunda 15 dakikada en fazla bir senkron (sekme/yenileme
 * tekrarlari Graph'i yormasin). Hata sessizce yutulur (Graph kapali olabilir).
 * =============================================================================
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import { meetingService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'

dayjs.extend(isoWeek)

export const MEETING_SYNC_KEY = 'hermes.meetingAutoSync'
export const MEETING_SYNC_INTERVAL_MS = 15 * 60 * 1000

function lastSyncAt(userId) {
    try {
        const raw = JSON.parse(window.sessionStorage.getItem(MEETING_SYNC_KEY) || 'null')
        return raw && raw.user === userId ? Number(raw.at) || 0 : 0
    } catch {
        return 0
    }
}

function markSynced(userId) {
    try {
        window.sessionStorage.setItem(MEETING_SYNC_KEY, JSON.stringify({ user: userId, at: Date.now() }))
    } catch {
        // depolama kapali: kisitlama yalniz bu sayfa omrunde gecerli
    }
}

/** Ana sayfa + toplanti sorgulari (senkron sonrasi tazelenecek aileler). */
export function invalidateMeetingViews(queryClient) {
    queryClient.invalidateQueries({ queryKey: queryKeys.home.all })
    queryClient.invalidateQueries({ queryKey: ['meetings'] })
}

export function useMeetingAutoSync(userId) {
    const queryClient = useQueryClient()
    useEffect(() => {
        if (!userId) return undefined
        if (Date.now() - lastSyncAt(userId) < MEETING_SYNC_INTERVAL_MS) return undefined
        let cancelled = false
        markSynced(userId)
        const start = dayjs().startOf('isoWeek')
        Promise.resolve()
            .then(() => meetingService.syncMe({
                start_date: start.format('YYYY-MM-DD'),
                end_date: start.add(6, 'day').format('YYYY-MM-DD'),
            }))
            .then((res) => {
                if (!cancelled && res?.ok) invalidateMeetingViews(queryClient)
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [userId, queryClient])
}
