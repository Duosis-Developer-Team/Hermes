/**
 * =============================================================================
 * HERMES PLATFORM - Time Entry Page (Jira Tempo Style)
 * =============================================================================
 * Yeni tasarım: List ve Timesheet görünümleri, haftalık navigasyon,
 * Log Time ve Plan Time modal'ları.
 * =============================================================================
 */

import { useState, useMemo, useEffect } from 'react'
import { Button, Modal, Space, message, Avatar, Tooltip, Select } from 'antd'
import {
    UnorderedListOutlined,
    TableOutlined,
    LeftOutlined,
    RightOutlined,
    UserOutlined,
    AppstoreOutlined,
    CalendarOutlined,
    FilterOutlined,
    SettingOutlined,
    FileExcelOutlined,
    DownloadOutlined,
    ExclamationCircleOutlined,
    DeleteOutlined
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import 'dayjs/locale/en'

import WeeklyListView from '../components/time-entry/WeeklyListView'
import TimesheetView from '../components/time-entry/TimesheetView'
import SubmitPeriodDropdown from '../components/time-entry/SubmitPeriodDropdown'
import LogTimeModal from '../components/modals/LogTimeModal'
import PlanTimeModal from '../components/modals/PlanTimeModal'
import SubmitPeriodModal from '../components/modals/SubmitPeriodModal'
import { workLogService, timesheetService, reportsService, authService, planTimeService } from '../services/api'
import { useAuthStore } from '../stores/authStore'
import './TimeEntryPage.css'

dayjs.extend(isoWeek)
dayjs.locale('en')

// 0.75 → "0h 45m", 2.75 → "2h 45m", 2.0 → "2h"
function formatDuration(decimal) {
    if (!decimal) return '0h'
    const h = Math.floor(decimal)
    const m = Math.round((decimal - h) * 60)
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
}

function TimeEntryPage() {
    const queryClient = useQueryClient()
    const { user } = useAuthStore()

    // ==========================================================================
    // State
    // ==========================================================================
    const [viewMode, setViewMode] = useState('list') // 'list' | 'timesheet'
    const [weekStart, setWeekStart] = useState(() => dayjs().startOf('isoWeek'))

    // Modal states
    const [logTimeModalOpen, setLogTimeModalOpen] = useState(false)
    const [planTimeModalOpen, setPlanTimeModalOpen] = useState(false)
    const [selectedDate, setSelectedDate] = useState(null)
    const [editingLog, setEditingLog] = useState(null)
    const [editingPlan, setEditingPlan] = useState(null)
    const [submitModalOpen, setSubmitModalOpen] = useState(false)
    const [selectedPeriod, setSelectedPeriod] = useState(null)
    const [selectedUserId, setSelectedUserId] = useState(null) // Admin override
    const [deletingLog, setDeletingLog] = useState(null)   // log pending delete confirmation

    // ==========================================================================
    // Week Navigation
    // ==========================================================================
    const weekEnd = weekStart.endOf('isoWeek')
    const weekLabel = `${weekStart.format('DD MMM')} - ${weekEnd.format('DD MMM, YYYY')}`

    const goToPreviousWeek = () => setWeekStart(prev => prev.subtract(1, 'week'))
    const goToNextWeek = () => setWeekStart(prev => prev.add(1, 'week'))
    const goToToday = () => setWeekStart(dayjs().startOf('isoWeek'))

    // ==========================================================================
    // Data Fetching
    // ==========================================================================
    // Admin: Fetch all users
    const { data: usersResponse } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.getUsers(),
        enabled: !!user?.is_admin,
    })

    const usersList = usersResponse?.data || []
    const targetUserId = selectedUserId || user?.id

    // Fetch Work Logs
    const { data: workLogsResponse, isLoading } = useQuery({
        queryKey: ['workLogs', weekStart.format('YYYY-MM-DD'), targetUserId],
        queryFn: () => workLogService.getMyLogs({
            start_date: weekStart.format('YYYY-MM-DD'),
            end_date: weekEnd.format('YYYY-MM-DD'),
            limit: 500,
            user_id: selectedUserId // Backend handles this (admin check)
        }),
        enabled: !!user?.id,
    })

    // Fetch Plan Times (haftalık takvim için)
    // Admin: getAll → oluşturduğu dahil tüm plan time'lar görünür
    // User: getMyPlanTimes → yalnızca kendisine atananlar
    const { data: planTimesResponse, refetch: refetchPlanTimes } = useQuery({
        queryKey: ['planTimes', weekStart.format('YYYY-MM-DD'), user?.id, user?.is_admin],
        queryFn: () => user?.is_admin
            ? planTimeService.getAll({
                start_date: weekStart.format('YYYY-MM-DD'),
                end_date: weekEnd.format('YYYY-MM-DD'),
            })
            : planTimeService.getMyPlanTimes({
                start_date: weekStart.format('YYYY-MM-DD'),
                end_date: weekEnd.format('YYYY-MM-DD'),
            }),
        enabled: !!user?.id,
    })
    // Admin için getAll dönüyor — assignments array'inden kendi atamasını enrich et
    const planTimes = useMemo(() => {
        const raw = planTimesResponse?.data || []
        if (!user?.is_admin) return raw
        return raw.map(pt => {
            const myAssignment = pt.assignments?.find(a => a.user_id === user.id)
            if (myAssignment) {
                // Admin aynı zamanda assignee — butonlar gösterilsin
                return { ...pt, assignment_id: `${pt.id}_self`, status: myAssignment.status }
            }
            // Admin yalnızca organizer — buton yok
            return pt
        })
    }, [planTimesResponse, user])

    // Fetch Period Status
    const { data: periodStatus, refetch: refetchPeriodStatus } = useQuery({
        queryKey: ['periodStatus', weekStart.format('YYYY-MM-DD'), user?.id],
        queryFn: () => timesheetService.getPeriodStatus(weekStart.format('YYYY-MM-DD')),
        enabled: !!user?.id,
    })

    const workLogs = workLogsResponse?.data || []

    // Haftalık toplam saat
    const weekTotalHours = useMemo(() =>
        workLogs.reduce((sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0)
    , [workLogs])

    // ==========================================================================
    // Mutations
    // ==========================================================================
    const createMutation = useMutation({
        mutationFn: (data) => workLogService.create(data, selectedUserId || null),
        onSuccess: () => {
            message.success('Time logged')
            queryClient.invalidateQueries(['workLogs'])
            refetchPeriodStatus()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'An error occurred')
        },
    })

    // Separate mutation for paste — no generic toast
    const pasteMutation = useMutation({
        mutationFn: (data) => workLogService.create(data, selectedUserId || null),
        onSuccess: () => {
            queryClient.invalidateQueries(['workLogs'])
            refetchPeriodStatus()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Paste failed')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => workLogService.update(id, data),
        onSuccess: () => {
            message.success('Time updated')
            queryClient.invalidateQueries(['workLogs'])
            refetchPeriodStatus()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'An error occurred')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: workLogService.delete,
        onSuccess: () => {
            message.success('Log entry deleted successfully')
            queryClient.invalidateQueries(['workLogs'])
            setDeletingLog(null)
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'An error occurred')
            setDeletingLog(null)
        },
    })

    const {
        mutate: submitTimesheetMutation,
        isPending: isSubmitting
    } = useMutation({
        mutationFn: timesheetService.submitTimesheet,
        onSuccess: () => {
            message.success('Timesheet submitted successfully')
            setSubmitModalOpen(false)
            refetchPeriodStatus() // Update status to SUBMITTED
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Submission failed')
        }
    })

    // ==========================================================================
    // Handlers
    // ==========================================================================
    const handleLogTime = (date) => {
        setSelectedDate(date)
        setEditingLog(null)
        setLogTimeModalOpen(true)
    }

    const handlePlanTime = (date) => {
        setSelectedDate(date)
        setEditingPlan(null)
        setPlanTimeModalOpen(true)
    }

    const handleEditLog = (log) => {
        setEditingLog(log)
        setLogTimeModalOpen(true)
    }

    const handleDeleteLog = (log) => {
        setDeletingLog(log)
    }

    const handleDeleteConfirm = () => {
        if (deletingLog) deleteMutation.mutate(deletingLog.id)
    }

    const handleDeleteCancel = () => {
        setDeletingLog(null)
    }

    const handleLogTimeSubmit = async (data, editId) => {
        if (editId) {
            return await updateMutation.mutateAsync({ id: editId, data })
        } else {
            return await createMutation.mutateAsync(data)
        }
    }

    const createPlanTimeMutation = useMutation({
        mutationFn: (data) => planTimeService.create(data),
        onSuccess: () => {
            message.success('Meeting invite sent')
            setPlanTimeModalOpen(false)
            refetchPlanTimes()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Failed to create plan time')
        },
    })

    const updatePlanTimeMutation = useMutation({
        mutationFn: ({ id, data }) => planTimeService.update(id, data),
        onSuccess: () => {
            message.success('Plan updated')
            setPlanTimeModalOpen(false)
            setEditingPlan(null)
            refetchPlanTimes()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Failed to update plan')
        },
    })

    const deletePlanTimeMutation = useMutation({
        mutationFn: (id) => planTimeService.delete(id),
        onSuccess: () => {
            message.success('Plan deleted')
            refetchPlanTimes()
        },
        onError: () => {
            message.error('Failed to delete plan')
        },
    })

    const respondPlanTimeMutation = useMutation({
        mutationFn: ({ planTimeId, status }) => planTimeService.respond(planTimeId, status),
        onSuccess: (_, { status }) => {
            message.success(status === 'accepted' ? 'Accepted' : 'Rejected')
            refetchPlanTimes()
        },
        onError: () => {
            message.error('Failed to respond')
        },
    })

    const handlePlanTimeSubmit = (data) => {
        if (editingPlan) {
            updatePlanTimeMutation.mutate({ id: editingPlan.id, data })
        } else {
            createPlanTimeMutation.mutate(data)
        }
    }

    const handleEditPlanTime = (plan) => {
        setEditingPlan(plan)
        setPlanTimeModalOpen(true)
    }

    const handleDeletePlanTime = (id) => {
        deletePlanTimeMutation.mutate(id)
    }

    const handlePlanTimeRespond = (planTimeId, status) => {
        respondPlanTimeMutation.mutate({ planTimeId, status })
    }

    const handleSubmitPeriod = (data) => {
        submitTimesheetMutation(data)
    }

    // ==========================================================================
    // Copy-Paste State
    // ==========================================================================
    const [selectedLogId, setSelectedLogId] = useState(null)
    const [copiedLog, setCopiedLog] = useState(null)
    const [targetDate, setTargetDate] = useState(null)

    const handleSelectLog = (logId) => {
        setSelectedLogId(prev => {
            if (prev === logId) return null // toggle off
            return logId
        })
        setTargetDate(null) // starting a new selection clears paste target
    }

    const handleSelectDay = (dateStr) => {
        setTargetDate(prev => prev === dateStr ? null : dateStr) // toggle
    }

    const handleClearClipboard = () => {
        setSelectedLogId(null)
        setCopiedLog(null)
        setTargetDate(null)
    }

    // Keyboard shortcut listener — Ctrl/Cmd + C/V/Escape
    useEffect(() => {
        const handleKeyDown = async (e) => {
            // Guard: don't intercept when typing in a form field
            const tag = document.activeElement?.tagName?.toUpperCase()
            const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
                document.activeElement?.isContentEditable === true
            if (isEditable) return

            const isMod = e.ctrlKey || e.metaKey

            // ── Ctrl+C — copy selected log ──────────────────────────────────
            if (isMod && e.key === 'c') {
                if (selectedLogId) {
                    const log = workLogs.find(l => l.id === selectedLogId)
                    if (log) {
                        setCopiedLog(log)
                        const label = log.project_name || log.description?.substring(0, 25) || 'Log'
                        message.info(`"${label}" copied — select a target day, then Ctrl+V`)
                        e.preventDefault()
                    }
                }
                return
            }

            // ── Ctrl+V — paste to target day ────────────────────────────────
            if (isMod && e.key === 'v') {
                if (!copiedLog) return // nothing in clipboard, let browser handle

                e.preventDefault()

                if (!targetDate) {
                    message.warning('Select a target day first, then paste')
                    return
                }

                const newLog = {
                    customer_id: copiedLog.customer_id,
                    project_id: copiedLog.project_id,
                    work_type_id: copiedLog.work_type_id,
                    activity_type_id: copiedLog.activity_type_id || null,
                    platform_id: copiedLog.platform_id || null,
                    work_line_id: copiedLog.work_line_id || null,
                    date_worked: targetDate,
                    duration_hours: copiedLog.duration_hours,
                    description: copiedLog.description,
                }
                if (pasteMutation.isPending) return // debounce double-paste

                try {
                    await pasteMutation.mutateAsync(newLog)
                    const formattedDate = dayjs(targetDate).format('DD MMM')
                    message.success(`"${copiedLog.project_name || 'Log'}" pasted to ${formattedDate} ✓`)
                    setTargetDate(null) // clear target; copiedLog stays for multiple pastes
                } catch {
                    // error handled by pasteMutation.onError
                }
                return
            }

            // ── Escape — clear clipboard & selection ────────────────────────
            if (e.key === 'Escape') {
                setSelectedLogId(null)
                setCopiedLog(null)
                setTargetDate(null)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectedLogId, copiedLog, targetDate, workLogs, pasteMutation])

    const [exportLoading, setExportLoading] = useState(false)

    const handleExportExcel = async () => {
        try {
            setExportLoading(true)

            // Determine user name for filename
            const targetId = selectedUserId || user?.id
            // Try to find in loaded list (Admin) or fallback to current user
            const targetUser = usersList.find(u => u.id === targetId) || (targetId === user?.id ? user : null)

            let userNameSlug = 'User'
            if (targetUser && targetUser.full_name) {
                // Remove spaces and special chars, camelCase-ish
                userNameSlug = targetUser.full_name
                    .replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ ]/g, '') // Keep Turkish chars/spaces
                    .split(' ')
                    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
                    .join('')
            }

            // Format dates: 19Oca_25Oca (Turkish locale is active)
            const dateRangeSlug = `${weekStart.format('DDMMM')}_${weekEnd.format('DDMMM')}`

            const customFilename = `HermesRapor_${userNameSlug}_${dateRangeSlug}.csv`

            await reportsService.exportExcel({
                start_date: weekStart.format('YYYY-MM-DD'),
                end_date: weekEnd.format('YYYY-MM-DD'),
                user_id: selectedUserId // Pass the selected user (or null)
            }, customFilename)

            message.success('Weekly report (CSV) downloaded')
        } catch (error) {
            console.error('Export error:', error)
            message.error('Failed to download report')
        } finally {
            setExportLoading(false)
        }
    }

    const handleCellClick = (record, dateKey) => {
        handleLogTime(dateKey)
    }

    // ==========================================================================
    // Render
    // ==========================================================================
    return (
        <div className="time-entry-page">
            {/* Header */}
            {/* User Header (Jira Tempo Style) */}
            <div className="user-header">
                <div className="user-header-left">
                    <Avatar
                        size={40}
                        icon={<UserOutlined />}
                        className="user-avatar-large"
                    />
                    {/* Admin User Selector */}
                    {user?.is_admin ? (
                        <div className="admin-user-selector">
                            <Select
                                className="user-select-dropdown"
                                value={targetUserId}
                                onChange={setSelectedUserId}
                                style={{ width: 200, fontSize: '1.2rem', fontWeight: 600 }}
                                bordered={false}
                                loading={!usersList.length}
                                options={[
                                    { value: user.id, label: user.full_name || 'Me' }, // Always show self first
                                    ...usersList
                                        .filter(u => u.id !== user.id)
                                        .map(u => ({ value: u.id, label: u.full_name }))
                                ]}
                                showSearch
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        </div>
                    ) : (
                        <h1 className="user-header-name">{user?.full_name || 'User'}</h1>
                    )}
                </div>

                <div className="user-header-right">
                    <Tooltip title="Export CSV">
                        <Button
                            type="primary"
                            shape="circle"
                            icon={<FileExcelOutlined />}
                            loading={exportLoading}
                            onClick={handleExportExcel}
                            style={{
                                background: '#16a34a !important',
                                borderColor: '#16a34a !important',
                                backgroundColor: '#16a34a', // Fallback
                                marginRight: 8,
                                minWidth: 32,
                                width: 32,
                                height: 32,
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        />
                    </Tooltip>

                    <SubmitPeriodDropdown
                        periods={periodStatus ? [{
                            id: 'current',
                            name: 'Current Period',
                            status: periodStatus.status,
                            statusColor: periodStatus.status === 'OPEN' ? 'blue' : 'orange',
                            startDate: dayjs(periodStatus.period_start),
                            endDate: dayjs(periodStatus.period_end),
                            hoursLogged: periodStatus.logged_hours,
                            hoursRequired: periodStatus.required_hours,
                            behind: Math.max(0, periodStatus.required_hours - periodStatus.logged_hours)
                        }] : []}
                        onOpenSubmitModal={(period) => {
                            setSelectedPeriod(period)
                            setSubmitModalOpen(true)
                        }}
                    />

                    <div className="view-switchers">
                        <span
                            className={`view-link ${viewMode === 'list' ? 'active' : ''}`}
                            onClick={() => setViewMode('list')}
                        >
                            List
                        </span>
                        <span
                            className={`view-link ${viewMode === 'timesheet' ? 'active' : ''}`}
                            onClick={() => setViewMode('timesheet')}
                        >
                            Timesheet
                        </span>
                    </div>
                </div>
            </div>

            {/* Week Navigation Header */}
            <div className="time-entry-header">
                <div className="header-left">
                    {/* Week Navigation */}
                    <div className="week-nav">
                        <Button
                            type="text"
                            icon={<LeftOutlined />}
                            onClick={goToPreviousWeek}
                            className="nav-btn"
                        />
                        <span className="week-label">{weekLabel}</span>
                        <Button
                            type="text"
                            icon={<RightOutlined />}
                            onClick={goToNextWeek}
                            className="nav-btn"
                        />
                    </div>
                    <Button onClick={goToToday} className="today-btn">
                        Today
                    </Button>
                </div>

                <div className="header-right">
                    {/* Week Summary */}
                    <div className="week-summary">
                        <span className="summary-label">Week:</span>
                        <span className="summary-hours">{formatDuration(weekTotalHours)}</span>
                        <span className="summary-target">/ 40h</span>
                    </div>

                    {/* View Toggle - Removed in favor of top header switchers */}
                    {/* Kept commented out just in case or we can remove completely */}
                    {/* <Segmented ... /> */}
                </div>
            </div>

            {/* Content */}
            <div className="time-entry-content">
                {viewMode === 'list' ? (
                    <WeeklyListView
                        weekStart={weekStart}
                        workLogs={workLogs}
                        planTimes={planTimes}
                        onLogTime={handleLogTime}
                        onPlanTime={user?.is_admin ? handlePlanTime : undefined}
                        onEditLog={handleEditLog}
                        onDeleteLog={handleDeleteLog}
                        onPlanTimeRespond={handlePlanTimeRespond}
                        onDeletePlanTime={handleDeletePlanTime}
                        onEditPlanTime={handleEditPlanTime}
                        selectedLogId={selectedLogId}
                        copiedLog={copiedLog}
                        targetDate={targetDate}
                        onSelectLog={handleSelectLog}
                        onSelectDay={handleSelectDay}
                        onClearClipboard={handleClearClipboard}
                        isAdmin={user?.is_admin}
                    />
                ) : (
                    <TimesheetView
                        weekStart={weekStart}
                        workLogs={workLogs}
                        onCellClick={handleCellClick}
                        onLogTime={handleLogTime}
                    />
                )}
            </div>

            {/* Modals */}
            <LogTimeModal
                open={logTimeModalOpen}
                onClose={() => {
                    setLogTimeModalOpen(false)
                    setEditingLog(null)
                }}
                onSubmit={handleLogTimeSubmit}
                onLogAnother={() => setEditingLog(null)}
                initialDate={selectedDate}
                editingLog={editingLog}
                loading={createMutation.isPending || updateMutation.isPending}
            />

            <PlanTimeModal
                open={planTimeModalOpen}
                onClose={() => { setPlanTimeModalOpen(false); setEditingPlan(null) }}
                onSubmit={handlePlanTimeSubmit}
                initialDate={selectedDate}
                editingPlan={editingPlan}
                loading={createPlanTimeMutation.isPending || updatePlanTimeMutation.isPending}
            />

            <SubmitPeriodModal
                open={submitModalOpen}
                onClose={() => setSubmitModalOpen(false)}
                period={selectedPeriod}
                onSubmit={handleSubmitPeriod}
                loading={isSubmitting}
            />

            {/* Delete Confirmation Modal */}
            <Modal
                open={!!deletingLog}
                onCancel={handleDeleteCancel}
                footer={null}
                width={420}
                centered
                closable={false}
                styles={{
                    content: {
                        background: '#1e1e1e',
                        border: '1px solid #303030',
                        borderRadius: 12,
                        padding: '28px 28px 24px',
                    }
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Icon + Title */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 10,
                            background: 'rgba(239,68,68,0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0
                        }}>
                            <ExclamationCircleOutlined style={{ color: '#ef4444', fontSize: 20 }} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
                                Confirm Deletion
                            </div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                This action cannot be undone
                            </div>
                        </div>
                    </div>

                    {/* Log preview */}
                    {deletingLog && (
                        <div style={{
                            background: '#2a2a2a',
                            border: '1px solid #383838',
                            borderRadius: 8,
                            padding: '10px 14px',
                        }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>
                                {deletingLog.project_name || 'Log Entry'}
                            </div>
                            {deletingLog.description && (
                                <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
                                    {deletingLog.description.length > 60
                                        ? deletingLog.description.substring(0, 60) + '…'
                                        : deletingLog.description}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Message */}
                    <p style={{ margin: 0, color: '#aaa', fontSize: 14, lineHeight: 1.6 }}>
                        Are you sure you want to delete this time log?
                    </p>

                    {/* Buttons */}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                        <Button
                            onClick={handleDeleteCancel}
                            style={{
                                background: 'transparent',
                                borderColor: '#444',
                                color: '#ccc',
                                borderRadius: 8,
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="primary"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={handleDeleteConfirm}
                            loading={deleteMutation.isPending}
                            style={{ borderRadius: 8 }}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

export default TimeEntryPage
