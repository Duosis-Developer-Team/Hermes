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
    Avatar,
    Button,
    Empty,
    Select,
    Space,
    Spin,
    message,
} from 'antd'
import {
    LeftOutlined,
    RightOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import { useAuthStore } from '../stores/authStore'
import {
    authService,
    meetingService,
    workLogService,
} from '../services/api'
import MeetingsWeeklyView from '../components/meetings/MeetingsWeeklyView'
import MeetingReviewModal from '../components/modals/MeetingReviewModal'
import LogTimeModal from '../components/modals/LogTimeModal'
import './MeetingsPage.css'

dayjs.extend(isoWeek)


function MeetingsPage() {
    const { user } = useAuthStore()
    const queryClient = useQueryClient()
    // RBAC R3: baskalarinin toplantilarini gorme/sync yetkisi
    const can = useAuthStore((s) => s.can)
    useAuthStore((s) => s.permissions) // izinler degisince re-render
    const isAdmin = can('meetings.admin')

    const [weekStart, setWeekStart] = useState(() =>
        dayjs().startOf('isoWeek')
    )
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

    return (
        <div className="meetings-page">
            {/* Header — avatar + identity + admin user-selector left,
                week nav + sync (admin) right. Tight padding matches
                Tasks. */}
            <div className="meetings-user-header">
                <div className="meetings-user-header-left">
                    <Avatar
                        size={40}
                        icon={<UserOutlined />}
                        className="meetings-user-avatar"
                    />
                    {isAdmin ? (
                        <Select
                            mode="multiple"
                            value={selectedUserIds}
                            onChange={setSelectedUserIds}
                            placeholder="All users"
                            allowClear
                            maxTagCount="responsive"
                            style={{ minWidth: 260, maxWidth: 520 }}
                            loading={!allActiveUsers.length}
                            options={userSelectorOptions}
                            showSearch
                            filterOption={(input, option) =>
                                (option?.label ?? '')
                                    .toLowerCase()
                                    .includes(input.toLowerCase())
                            }
                        />
                    ) : (
                        <h1 className="meetings-user-name">
                            {user?.full_name || user?.email}
                        </h1>
                    )}
                </div>

                <div className="meetings-user-header-right">
                    <Space wrap>
                        <Button
                            icon={<LeftOutlined />}
                            onClick={() =>
                                setWeekStart((p) => p.subtract(1, 'week'))
                            }
                        />
                        <Button
                            onClick={() =>
                                setWeekStart(dayjs().startOf('isoWeek'))
                            }
                        >
                            Today
                        </Button>
                        <Button
                            icon={<RightOutlined />}
                            onClick={() =>
                                setWeekStart((p) => p.add(1, 'week'))
                            }
                        />
                        <span
                            style={{
                                color: 'var(--c-text-strong)',
                                fontWeight: 500,
                                marginLeft: 4,
                            }}
                        >
                            {weekStart.format('DD MMM')} –{' '}
                            {weekEnd.format('DD MMM, YYYY')}
                        </span>
                    </Space>
                </div>
            </div>

            <div className="meetings-body">
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}>
                        <Spin />
                    </div>
                ) : meetings.length === 0 ? (
                    <Empty
                        description="No meetings for this week."
                        style={{ marginTop: 60 }}
                    />
                ) : (
                    <MeetingsWeeklyView
                        weekStart={weekStart}
                        meetings={meetings}
                        loggedMeetingIds={loggedMeetingIds}
                        onSelectMeeting={handleSelectMeeting}
                    />
                )}
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
