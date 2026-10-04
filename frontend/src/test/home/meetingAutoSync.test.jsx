/**
 * =============================================================================
 * Toplanti otomatik senkronu (kabuk acilisi)
 * =============================================================================
 *   1. Ilk yuklemede bu haftanin takvimi BIR KEZ cekilir (Pzt–Paz).
 *   2. Basariliysa ana sayfa sorgulari tazelenir (Takvimim bos kalmaz).
 *   3. 15 dk icinde ikinci yukleme yeniden cekmez; hata sessizdir.
 * =============================================================================
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'

const meetingService = { syncMe: vi.fn() }
vi.mock('../../services/api', () => ({ meetingService }))

const { useMeetingAutoSync, MEETING_SYNC_KEY } = await import('../../features/home/hooks/useMeetingAutoSync')
const { makeTestQueryClient } = await import('../utils')

const run = (client, userId = 'u1') => renderHook(() => useMeetingAutoSync(userId), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
})

beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
})

describe('useMeetingAutoSync', () => {
    it('bu haftayi bir kez ceker ve ana sayfayi tazeler', async () => {
        meetingService.syncMe.mockResolvedValue({ ok: true })
        const client = makeTestQueryClient()
        const spy = vi.spyOn(client, 'invalidateQueries')
        run(client)
        await waitFor(() => expect(meetingService.syncMe).toHaveBeenCalledTimes(1))
        const { start_date, end_date } = meetingService.syncMe.mock.calls[0][0]
        expect(dayjs(start_date).isoWeekday()).toBe(1)
        expect(dayjs(end_date).diff(dayjs(start_date), 'day')).toBe(6)
        await waitFor(() => expect(spy).toHaveBeenCalled())
        expect(spy.mock.calls.some(([arg]) => JSON.stringify(arg.queryKey).includes('home'))).toBe(true)
    })

    it('15 dk icinde tekrar cekmez; baska kullanici icin ceker', async () => {
        meetingService.syncMe.mockResolvedValue({ ok: true })
        run(makeTestQueryClient())
        await waitFor(() => expect(meetingService.syncMe).toHaveBeenCalledTimes(1))
        run(makeTestQueryClient())
        await new Promise((r) => setTimeout(r, 20))
        expect(meetingService.syncMe).toHaveBeenCalledTimes(1)
        run(makeTestQueryClient(), 'u2')
        await waitFor(() => expect(meetingService.syncMe).toHaveBeenCalledTimes(2))
        expect(JSON.parse(window.sessionStorage.getItem(MEETING_SYNC_KEY)).user).toBe('u2')
    })

    it('Graph hatasi sessizce yutulur, tazeleme yok', async () => {
        meetingService.syncMe.mockRejectedValue(new Error('graph down'))
        const client = makeTestQueryClient()
        const spy = vi.spyOn(client, 'invalidateQueries')
        run(client)
        await waitFor(() => expect(meetingService.syncMe).toHaveBeenCalledTimes(1))
        await new Promise((r) => setTimeout(r, 20))
        expect(spy).not.toHaveBeenCalled()
    })
})
