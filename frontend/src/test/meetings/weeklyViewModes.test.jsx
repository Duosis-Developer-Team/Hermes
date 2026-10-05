/**
 * Toplanti takvimi gorunumleri (CTO 05.10): Outlook gibi "Is haftasi"
 * (5 gun) ve "Hafta" (7 gun, hafta sonu dahil) ayri secenekler.
 */
import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'

import MeetingsWeeklyView from '../../components/meetings/MeetingsWeeklyView'
import { renderWithProviders } from '../utils'

const meeting = {
    id: 'm1', subject: 'Standup', start_datetime: '2026-09-15T09:00:00', end_datetime: '2026-09-15T09:30:00',
}

const dayCount = (container) => container.querySelectorAll('.meetings-grid__day').length

describe('MeetingsWeeklyView modes', () => {
    it('workweek 5 gun, week 7 gun', () => {
        const ww = renderWithProviders(
            <MeetingsWeeklyView weekStart={dayjs('2026-09-14')} meetings={[meeting]} loggedMeetingIds={new Set()} mode="workweek" />,
        )
        expect(dayCount(ww.container)).toBe(5)
        ww.unmount()
        const w = renderWithProviders(
            <MeetingsWeeklyView weekStart={dayjs('2026-09-14')} meetings={[meeting]} loggedMeetingIds={new Set()} mode="week" />,
        )
        expect(dayCount(w.container)).toBe(7)
    })
})
