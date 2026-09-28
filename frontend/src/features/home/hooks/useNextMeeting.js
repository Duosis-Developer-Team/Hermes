/**
 * HERMES LIQUID — adanin canli yuvasi: bugunun SIRADAKI toplantisi.
 *
 * Prototipteki "calisan zamanlayici" yuvasinin GERCEK veri karsiligi:
 * backend'de zamanlayici yok (uydurulmaz), toplantilar var. Kaynak ana
 * sayfa takvimiyle AYNI sorgu (queryKeys.home.week) — ek istek yapilmaz,
 * onbellek paylasilir. Her 30 sn'de bir yeniden hesaplanir.
 *
 * Donus: null | { id, subject, status: 'now' | 'soon', minutes, joinUrl }
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'

import { homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'

export function pickNextMeeting(week, now = dayjs()) {
    const today = (week?.days || []).find((d) => d.is_today)
    const upcoming = (today?.meetings || [])
        .filter((m) => m.start_datetime && m.end_datetime && dayjs(m.end_datetime).isAfter(now))
        .sort((a, b) => dayjs(a.start_datetime).diff(dayjs(b.start_datetime)))
    const m = upcoming[0]
    if (!m) return null
    const start = dayjs(m.start_datetime)
    const live = !start.isAfter(now)
    return {
        id: m.id,
        subject: m.subject,
        status: live ? 'now' : 'soon',
        minutes: live ? 0 : Math.max(1, Math.ceil(start.diff(now, 'minute', true))),
        joinUrl: m.join_url || null,
    }
}

export function useNextMeeting({ enabled = true } = {}) {
    const { data } = useQuery({
        queryKey: queryKeys.home.week({}),
        queryFn: () => homeService.week(),
        enabled,
        staleTime: 5 * 60 * 1000,
    })
    const [now, setNow] = useState(() => dayjs())
    useEffect(() => {
        const id = setInterval(() => setNow(dayjs()), 30 * 1000)
        return () => clearInterval(id)
    }, [])
    return pickNextMeeting(data, now)
}
