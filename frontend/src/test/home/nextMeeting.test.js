/**
 * Hermes Liquid — adanin canli yuvasi: yalniz BUGUNUN, henuz bitmemis
 * ilk toplantisi; baslamissa "simdi", degilse kalan dakika. Veri yoksa
 * yuva hic gorunmez (uydurma zamanlayici yok).
 */
import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { pickNextMeeting } from '../../features/home/hooks/useNextMeeting'

const now = dayjs('2026-09-28T10:00:00')
const m = (id, start, end, subject = id) => ({
    id, subject, start_datetime: `2026-09-28T${start}:00`, end_datetime: `2026-09-28T${end}:00`, join_url: null,
})
const week = (meetings, isToday = true) => ({ days: [{ date: '2026-09-28', is_today: isToday, meetings }] })

describe('pickNextMeeting', () => {
    it('bitmis toplantilari atlar, en erken gelecegi secer', () => {
        const r = pickNextMeeting(week([m('late', '14:00', '15:00'), m('past', '08:00', '08:30'), m('soon', '10:20', '10:50')]), now)
        expect(r).toMatchObject({ id: 'soon', status: 'soon', minutes: 20 })
    })
    it('devam eden toplanti "simdi"', () => {
        expect(pickNextMeeting(week([m('live', '09:45', '10:15')]), now)).toMatchObject({ id: 'live', status: 'now', minutes: 0 })
    })
    it('bugun yoksa ya da veri yoksa null', () => {
        expect(pickNextMeeting(week([m('x', '11:00', '12:00')], false), now)).toBeNull()
        expect(pickNextMeeting(undefined, now)).toBeNull()
        expect(pickNextMeeting(week([m('done', '07:00', '08:00')]), now)).toBeNull()
    })
})
