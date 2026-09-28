/**
 * =============================================================================
 * HERMES - Meetings Page
 * =============================================================================
 * Weekly calendar of Microsoft Teams / Outlook meetings synced into
 * Hermes. Header + week-nav rhythm mirrors Time Entry / Tasks. A
 * read-only Meeting Review modal opens on card click — Log Time is
 * wired in Stage 5.
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Empty,
    Select,
    Spin,
    message,
} from 'antd'
import {
    LeftOutlined,
    RightOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import { useAuthStore } from '../stores/authStore'
import {
    authService,
    meetingService,
    workLogService,
} from '../services/api'
import MeetingsWeeklyView from '../components/meetings/MeetingsWeeklyView'
import MeetingsRail from '../components/meetings/MeetingsRail'
import { passesMeetingFilters } from '../components/meetings/meetingsModel'
import { GlassCard, LiquidSegmented, PageHero } from '../components/liquid'
import MeetingReviewModal from '../components/modals/MeetingReviewModal'
import LogTimeModal from '../components/modals/LogTimeModal'
import { useT } from '../i18n'
import './MeetingsPage.css'

dayjs.extend(isoWeek)


function MeetingsPage() {
    const t = useT()
    const { user } = useAuthStore()
    const queryClient = useQueryClient()
    // RBAC R3: baskalarinin toplantilarini gorme/sync yetkisi
    const can = useAuthStore((s) => s.can)
    useAuthStore((s) => s.permissions) // izinler degisince re-render
    const isAdmin = can('meetings.admin')

    // PM rework P3 / D4: ana sayfa takvim seridinden `?date=` o gunun
    // haftasini acar (derin baglanti; state URL'den bir kez okunur).
    const [searchParams] = useSearchParams()
    const [weekStart, setWeekStart] = useState(() => {
        const wanted = searchParams.get('date')
        const parsed = wanted ? dayjs(wanted) : null
        return (parsed && parsed.isValid() ? parsed : dayjs()).startOf('isoWeek')
    })
    const weekEnd = weekStart.endOf('isoWeek')
    const weekStartStr = weekStart.format('YYYY-MM-DD')
    const weekEndStr = weekEnd.format('YYYY-MM-DD')

    // Admin-only user selector — now MULTI-select. Each id added shows
    // that user's calendar; the week view is the union of all selected
    // users' meetings. Empty selection = every meeting in the system
    // (the admin's existing "see everyone" default). Non-admin never
    // sees the selector and is always scoped to themselves server-side.
    const [selectedUserIds, setSelectedUserIds] = useState([])
    // Stable key for the meetings query — order-independent so the same
    // set of users doesn't refetch just because tag order changed.
    const selectedKey = isAdmin
        ? selectedUserIds.slice().sort().join(',')
        : 'self'
    // When exactly one user is selected (or non-admin self), single-user
    // features stay meaningful: the green "Logged" pills and the
    // Log-Time-on-behalf target follow that user. With zero (everyone)
    // or multiple selected, those fall back to the admin's own context.
    const singleSelectedUserId =
        isAdmin && selectedUserIds.length === 1 ? selectedUserIds[0] : null

    const [reviewMeeting, setReviewMeeting] = useState(null)
    // Hermes Liquid: takvim gorunumu ve sol raydaki takvim filtreleri.
    const [calendarMode, setCalendarMode] = useState('week')
    const [calendarFilters, setCalendarFilters] = useState({
        online: true, offline: true, logged: true, cancelled: false,
    })
    // Meeting to prefill the Log Time modal with. Independent of
    // reviewMeeting so the user can cancel the Log Time modal and
    // still see the review modal underneath.
    const [logTimeMeeting, setLogTimeMeeting] = useState(null)

    // Pull the meetings for the visible week. Admin passes a comma-
    // separated user_ids list to union several calendars; empty list
    // falls through to "all meetings". Non-admin's filter is ignored
    // server-side (always scoped to self).
    const { data: meetings = [], isLoading } = useQuery({
        queryKey: ['meetings', weekStartStr, selectedKey],
        queryFn: () =>
            meetingService.list({
                start_date: weekStartStr,
                end_date: weekEndStr,
                user_ids:
                    isAdmin && selectedUserIds.length
                        ? selectedUserIds.join(',')
                        : undefined,
            }),
        enabled: !!user?.id,
    })

    // Admin-only — user selector options. Resolves names via
    // auth-service so the dropdown matches the rest of Hermes.
    const { data: allActiveUsers = [] } = useQuery({
        queryKey: ['auth-users-lookup', { include_inactive: false }],
        queryFn: () => authService.lookupUsers(),
        enabled: isAdmin,
        staleTime: 60 * 1000,
    })

    // Logged-meeting set — drives the green "Logged" pill on
    // MeetingCard. Only meaningful for a single viewed user, so it's
    // fetched for non-admins (self) and for admins who have narrowed to
    // exactly one user. With everyone / multiple selected we skip it.
    const { data: weekWorkLogsResponse } = useQuery({
        queryKey: [
            'workLogs',
            weekStartStr,
            isAdmin ? singleSelectedUserId : user?.id,
        ],
        queryFn: () =>
            workLogService.getMyLogs({
                start_date: weekStartStr,
                end_date: weekEndStr,
                limit: 500,
                user_id:
                    singleSelectedUserId && singleSelectedUserId !== user?.id
                        ? singleSelectedUserId
                        : undefined,
            }),
        enabled:
            !!user?.id && (!isAdmin || singleSelectedUserId !== null),
    })
    const loggedMeetingIds = useMemo(() => {
        const set = new Set()
        const logs = weekWorkLogsResponse?.data || weekWorkLogsResponse || []
        for (const l of Array.isArray(logs) ? logs : []) {
            if (l?.meeting_id) set.add(l.meeting_id)
        }
        return set
    }, [weekWorkLogsResponse])

    const userSelectorOptions = useMemo(() => {
        if (!user?.id) return []
        const me = { value: user.id, label: user.full_name || 'Me' }
        if (!isAdmin) return [me]
        const others = allActiveUsers
            .filter((u) => u.id !== user.id)
            .map((u) => ({ value: u.id, label: u.full_name || u.email }))
        return [me, ...others]
    }, [user, isAdmin, allActiveUsers])

    // Auto-sync the visible calendar(s) for the visible week —
    // silently, on load / week change / selection change, so meetings
    // appear without pressing a button. Self uses the token-scoped
    // /sync-me; each other selected user uses /sync-user with their
    // id+email (from the loaded lookup). Admin with an empty selection
    // ("everyone") syncs nothing — there's no per-user list to pull —
    // and just shows whatever is already in the DB. Failures swallowed.
    useEffect(() => {
        if (!user?.id) return
        let cancelled = false

        // Build the set of (id, email|self) targets to sync.
        const targets = []
        if (!isAdmin) {
            targets.push({ id: user.id, self: true })
        } else {
            for (const id of selectedUserIds) {
                if (id === user.id) {
                    targets.push({ id, self: true })
                } else {
                    const email = allActiveUsers.find(
                        (u) => u.id === id
                    )?.email
                    if (email) targets.push({ id, email, self: false })
                }
            }
        }
        if (targets.length === 0) return // "everyone" view: nothing to pull

        const requests = targets.map((t) =>
            t.self
                ? meetingService.syncMe({
                      start_date: weekStartStr,
                      end_date: weekEndStr,
                  })
                : meetingService.syncUser({
                      user_id: t.id,
                      email: t.email,
                      start_date: weekStartStr,
                      end_date: weekEndStr,
                  })
        )
        Promise.allSettled(requests).then((results) => {
            if (cancelled) return
            const anyOk = results.some(
                (r) => r.status === 'fulfilled' && r.value?.ok
            )
            if (anyOk) {
                queryClient.invalidateQueries({ queryKey: ['meetings'] })
            }
        })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        user?.id,
        isAdmin,
        selectedKey,
        allActiveUsers,
        weekStartStr,
        weekEndStr,
    ])

    const handleSelectMeeting = (meeting) => {
        setReviewMeeting(meeting)
    }

    // Work log mutation — used by the Meeting → Log Time flow. Same
    // service Time Entry uses; when the admin has narrowed to exactly
    // one user, the log is created on that user's behalf (second arg,
    // backend gates on is_admin). With everyone / multiple selected it
    // logs as the admin themselves.
    const workLogMutation = useMutation({
        mutationFn: (data) =>
            workLogService.create(
                data,
                singleSelectedUserId && singleSelectedUserId !== user?.id
                    ? singleSelectedUserId
                    : null,
            ),
        onSuccess: (_created, variables) => {
            const dateStr = variables?.date_worked
            message.success(
                dateStr
                    ? `Time logged for ${dateStr}.`
                    : 'Time logged.'
            )
            setLogTimeMeeting(null)
            // Invalidate every query that might surface the new log:
            //   - workLogs    → Time Entry calendar
            //   - periodStatus → Time Entry header progress bar
            //   - meetings    → Meetings page (Logged badge piggy-
            //     backs on the workLogs query keyed by week, so
            //     invalidating workLogs is what actually flips the
            //     pill; we also nudge meetings for safety).
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
            queryClient.invalidateQueries({ queryKey: ['periodStatus'] })
            queryClient.invalidateQueries({ queryKey: ['meetings'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to log time.'
            )
        },
    })

    const handleOpenLogTime = (meeting) => {
        setReviewMeeting(null)
        setLogTimeMeeting(meeting)
    }

    const handleLogTimeSubmit = async (data) => {
        // Attach meeting_id outside the modal so the modal itself
        // stays generic (same pattern Tasks uses for task_id).
        const payload = {
            ...data,
            meeting_id: logTimeMeeting?.id || null,
        }
        await workLogMutation.mutateAsync(payload)
    }

    const visibleMeetings = meetings.filter((m) =>
        passesMeetingFilters(m, loggedMeetingIds.has(m.id), calendarFilters))
    const focusDate = dayjs().isSame(weekStart, 'isoWeek') ? dayjs() : weekStart

    return (
        <div className="meetings-page">
            <PageHero
                className="meetings-user-header"
                title={t('nav.meetings')}
                subtitle={t('meetingsPage.subtitle')}
                actions={isAdmin ? (
                    <Select
                        className="meetings-user-select"
                        mode="multiple"
                        value={selectedUserIds}
                        onChange={setSelectedUserIds}
                        placeholder={t('meetings.allUsers')}
                        allowClear
                        maxTagCount="responsive"
                        loading={!allActiveUsers.length}
                        options={userSelectorOptions}
                        suffixIcon={<TeamOutlined />}
                        showSearch
                        filterOption={(input, option) =>
                            (option?.label ?? '')
                                .toLowerCase()
                                .includes(input.toLowerCase())
                        }
                    />
                ) : null}
            />

            <div className="meetings-body">
                <MeetingsRail
                    weekStart={weekStart}
                    meetings={meetings}
                    loggedMeetingIds={loggedMeetingIds}
                    filters={calendarFilters}
                    onFiltersChange={setCalendarFilters}
                    onPickWeek={setWeekStart}
                />

                <GlassCard className="meetings-calendar">
                    <div className="meetings-calendar__bar">
                        <Button
                            shape="circle"
                            aria-label={t('meetings.previousWeek')}
                            icon={<LeftOutlined />}
                            onClick={() => setWeekStart((p) => p.subtract(1, 'week'))}
                        />
                        <Button
                            shape="circle"
                            aria-label={t('meetings.nextWeek')}
                            icon={<RightOutlined />}
                            onClick={() => setWeekStart((p) => p.add(1, 'week'))}
                        />
                        <b className="meetings-calendar__range">
                            {weekStart.format('D MMMM')} – {weekEnd.format('D MMMM YYYY')}
                        </b>
                        <Button size="small" onClick={() => setWeekStart(dayjs().startOf('isoWeek'))}>
                            {t('meetings.today')}
                        </Button>
                        <span className="meetings-calendar__spacer" />
                        <LiquidSegmented
                            ariaLabel={t('misc.view')}
                            value={calendarMode}
                            onChange={setCalendarMode}
                            options={[
                                { value: 'day', label: t('meetingsPage.modeDay') },
                                { value: 'week', label: t('meetingsPage.modeWeek') },
                                { value: 'agenda', label: t('meetingsPage.modeAgenda') },
                            ]}
                        />
                    </div>
                    {isLoading ? (
                        <div className="meetings-calendar__state"><Spin /></div>
                    ) : visibleMeetings.length === 0 ? (
                        <Empty description={t('meetings.noMeetings')} className="meetings-calendar__state" />
                    ) : (
                        <MeetingsWeeklyView
                            weekStart={weekStart}
                            meetings={visibleMeetings}
                            loggedMeetingIds={loggedMeetingIds}
                            onSelectMeeting={handleSelectMeeting}
                            mode={calendarMode}
                            focusDate={focusDate}
                        />
                    )}
                </GlassCard>
            </div>

            <MeetingReviewModal
                open={!!reviewMeeting}
                meeting={reviewMeeting}
                onClose={() => setReviewMeeting(null)}
                onLogTime={handleOpenLogTime}
                isLogged={
                    !!reviewMeeting &&
                    loggedMeetingIds.has(reviewMeeting.id)
                }
            />

            {/* Log Time modal — opens from the Meeting Review modal.
                The meeting stays in the calendar after the log; the
                green Logged pill appears once workLogs invalidate
                completes. */}
            <LogTimeModal
                open={!!logTimeMeeting}
                onClose={() => setLogTimeMeeting(null)}
                onSubmit={handleLogTimeSubmit}
                prefillMeeting={logTimeMeeting}
                loading={workLogMutation.isPending}
            />
        </div>
    )
}

export default MeetingsPage
