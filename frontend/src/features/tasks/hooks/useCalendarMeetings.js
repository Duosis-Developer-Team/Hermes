/**
 * =============================================================================
 * HERMES - Takvim yerlesimi icin toplantilar (PM rework P3.5 / E5)
 * =============================================================================
 * Ana sayfanin /home/week verisi (kullanicinin kendi toplantilari)
 * yalnizca takvim yerlesimi acikken cekilir; yazma yok.
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'

import { homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'

export function useCalendarMeetings({ enabled, weekStart }) {
    const start = dayjs(weekStart).format('YYYY-MM-DD')
    const query = useQuery({
        queryKey: queryKeys.home.week({ start }),
        queryFn: () => homeService.week({ start }),
        enabled: !!enabled,
        staleTime: 5 * 60 * 1000,
    })
    return { meetings: enabled ? (query.data || null) : null }
}

export default useCalendarMeetings
