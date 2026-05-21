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
    Tooltip,
    message,
} from 'antd'
import {
    LeftOutlined,
    RightOutlined,
    SyncOutlined,
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
    const isAdmin = user?.is_admin === true

    const [weekStart, setWeekStart] = useState(() =>
        dayjs().startOf('isoWeek')
    )
    const weekEnd = weekStart.endOf('isoWeek')
    const weekStartStr = weekStart.format('YYYY-MM-DD')
    const weekEndStr = weekEnd.format('YYYY-MM-DD')

    // Admin-only user selector — same pattern as Time Entry / Tasks.
    // Non-admin always sees their own meetings; backend coerces too.
    const [selectedUserId, setSelectedUserId] = useState(null)
    const viewedUserId = isAdmin ? selectedUserId || user?.id : user?.id

    const [reviewMeeting, setReviewMeeting] = useState(null)
    // Meeting to prefill the Log Time modal with. Independent of
    // reviewMeeting so the user can cancel the Log Time modal and
    // still see the review modal underneath.
    const [logTimeMeeting, setLogTimeMeeting] = useState(null)

    // Pull the meetings for the visible week. Admin passes user_id to
    // peek at someone else's calendar; non-admin's user_id is silently
    // ignored server-side.
    const { data: meetings = [], isLoading } = useQuery({
        queryKey: [
            'meetings',
            weekStartStr,
            viewedUserId,
        ],
        queryFn: () =>
            meetingService.list({
                start_date: weekStartStr,
                end_date: weekEndStr,
                user_id: isAdmin ? selectedUserId || undefined : undefined,
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
    // MeetingCard. Pulls the viewed user's work_logs for the visible
    // week and keeps the ones that link back to a meeting. Admin
    // viewing another user via the user selector sees that user's
    // logs (workLogService.getMyLogs forwards user_id; the backend
    // enforces the admin-only override).
    const { data: weekWorkLogsResponse } = useQuery({
        queryKey: ['workLogs', weekStartStr, viewedUserId],
        queryFn: () =>
            workLogService.getMyLogs({
                start_date: weekStartStr,
                end_date: weekEndStr,
                limit: 500,
                user_id: isAdmin ? selectedUserId || undefined : undefined,
            }),
        enabled: !!user?.id,
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

    // Auto-sync the caller's OWN calendar for the visible week. Runs
    // silently on load and whenever the week changes, so meetings show
    // up without anyone pressing "Sync Meetings". Only fires for
    // self-view — sync-me is scoped to the calling user's token, so it
    // can't pull another user's calendar (admins use the explicit Sync
    // button for that). Failures are swallowed: the page still renders
    // whatever is already in the database.
    const viewingSelf = !isAdmin || !selectedUserId
    useEffect(() => {
        if (!user?.id || !viewingSelf) return
        let cancelled = false
        meetingService
            .syncMe({ start_date: weekStartStr, end_date: weekEndStr })
            .then((res) => {
                if (!cancelled && res?.ok) {
                    queryClient.invalidateQueries({ queryKey: ['meetings'] })
                }
            })
            .catch(() => {
                /* silent — show whatever is already synced */
            })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, viewingSelf, weekStartStr, weekEndStr])

    // Admin-only — Graph sync trigger. Fails gracefully when Graph is
    // not configured; the backend already short-circuits to a clean
    // { ok: false, error } payload.
    const syncMutation = useMutation({
        mutationFn: () =>
            meetingService.sync({
                start_date: weekStartStr,
                end_date: weekEndStr,
                user_id: isAdmin ? selectedUserId || null : null,
            }),
        onSuccess: (result) => {
            if (result?.ok) {
                message.success(
                    `Synced ${result.meetings_upserted} meeting${
                        result.meetings_upserted === 1 ? '' : 's'
                    } across ${result.users_succeeded}/${
                        result.users_attempted
                    } users.`
                )
            } else {
                message.error(
                    result?.error ||
                        'Sync completed but no user succeeded.'
                )
            }
            queryClient.invalidateQueries({ queryKey: ['meetings'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to sync meetings.'
            )
        },
    })

    const handleSelectMeeting = (meeting) => {
        setReviewMeeting(meeting)
    }

    // Work log mutation — used by the Meeting → Log Time flow. Same
    // service Time Entry uses; admin acting on behalf of the selected
    // user honours target_user_id via the second arg (backend gates
    // on is_admin).
    const workLogMutation = useMutation({
        mutationFn: (data) =>
            workLogService.create(
                data,
                isAdmin ? selectedUserId || null : null,
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
                            value={viewedUserId}
                            onChange={(v) =>
                                setSelectedUserId(v === user?.id ? null : v)
                            }
                            style={{
                                width: 220,
                                fontSize: '1.2rem',
                                fontWeight: 600,
                            }}
                            bordered={false}
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
                                color: '#fff',
                                fontWeight: 500,
                                marginLeft: 4,
                            }}
                        >
                            {weekStart.format('DD MMM')} –{' '}
                            {weekEnd.format('DD MMM, YYYY')}
                        </span>
                    </Space>
                    {isAdmin && (
                        <Tooltip title="Pull this week's meetings from Microsoft Graph">
                            <Button
                                icon={<SyncOutlined spin={syncMutation.isPending} />}
                                loading={syncMutation.isPending}
                                onClick={() => syncMutation.mutate()}
                            >
                                Sync Meetings
                            </Button>
                        </Tooltip>
                    )}
                </div>
            </div>

            <div className="meetings-body">
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}>
                        <Spin />
                    </div>
                ) : meetings.length === 0 ? (
                    <Empty
                        description={
                            isAdmin
                                ? 'No meetings synced for this week. Click "Sync Meetings" to pull from Microsoft Graph.'
                                : 'No meetings for this week.'
                        }
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
