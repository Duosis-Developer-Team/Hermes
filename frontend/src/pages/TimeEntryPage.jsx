/**
 * =============================================================================
 * HERMES PLATFORM - Time Entry Page (Jira Tempo Style)
 * =============================================================================
 * Yeni tasarım: List ve Timesheet görünümleri, haftalık navigasyon,
 * Log Time ve Plan Time modal'ları.
 * =============================================================================
 */

import { useState, useMemo } from 'react'
import { Button, Segmented, Space, Popconfirm, message, Avatar, Tooltip } from 'antd'
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
    DownloadOutlined
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import 'dayjs/locale/tr'

import WeeklyListView from '../components/time-entry/WeeklyListView'
import TimesheetView from '../components/time-entry/TimesheetView'
import SubmitPeriodDropdown from '../components/time-entry/SubmitPeriodDropdown'
import LogTimeModal from '../components/modals/LogTimeModal'
import PlanTimeModal from '../components/modals/PlanTimeModal'
import SubmitPeriodModal from '../components/modals/SubmitPeriodModal'
import { workLogService, timesheetService, reportsService } from '../services/api'
import { useAuthStore } from '../stores/authStore'
import './TimeEntryPage.css'

dayjs.extend(isoWeek)
dayjs.locale('tr')

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
    const [submitModalOpen, setSubmitModalOpen] = useState(false)
    const [selectedPeriod, setSelectedPeriod] = useState(null)

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
    const { data: workLogsResponse, isLoading } = useQuery({
        queryKey: ['workLogs', weekStart.format('YYYY-MM-DD'), user?.id],
        queryFn: () => workLogService.getMyLogs({
            start_date: weekStart.format('YYYY-MM-DD'),
            end_date: weekEnd.format('YYYY-MM-DD'),
            limit: 500,
        }),
        enabled: !!user?.id, // Only fetch if user is logged in
    })

    // Fetch Period Status
    const { data: periodStatus, refetch: refetchPeriodStatus } = useQuery({
        queryKey: ['periodStatus', weekStart.format('YYYY-MM-DD'), user?.id],
        queryFn: () => timesheetService.getPeriodStatus(weekStart.format('YYYY-MM-DD')),
        enabled: !!user?.id,
    })

    const workLogs = workLogsResponse?.data || []

    // Haftalık toplam saat
    const weekTotalHours = useMemo(() => {
        const total = workLogs.reduce((sum, log) => {
            const duration = parseFloat(log.duration_hours) || 0
            return sum + duration
        }, 0)

        // Clean format: remove trailing zeros (1.00 -> 1, 2.50 -> 2.5)
        if (Number.isInteger(total)) return total
        return parseFloat(total.toFixed(2))
    }, [workLogs])

    // ==========================================================================
    // Mutations
    // ==========================================================================
    const createMutation = useMutation({
        mutationFn: workLogService.create,
        onSuccess: () => {
            message.success('Süre kaydedildi')
            queryClient.invalidateQueries(['workLogs'])
            refetchPeriodStatus() // Update period status (logged hours)
            setLogTimeModalOpen(false)
            setEditingLog(null)
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Bir hata oluştu')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => workLogService.update(id, data),
        onSuccess: () => {
            message.success('Süre güncellendi')
            queryClient.invalidateQueries(['workLogs'])
            refetchPeriodStatus()
            setLogTimeModalOpen(false)
            setEditingLog(null)
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Bir hata oluştu')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: workLogService.delete,
        onSuccess: () => {
            message.success('Süre silindi')
            queryClient.invalidateQueries(['workLogs'])
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Bir hata oluştu')
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
        setPlanTimeModalOpen(true)
    }

    const handleEditLog = (log) => {
        setEditingLog(log)
        setLogTimeModalOpen(true)
    }

    const handleDeleteLog = (log) => {
        deleteMutation.mutate(log.id)
    }

    const handleLogTimeSubmit = (data, editId) => {
        if (editId) {
            updateMutation.mutate({ id: editId, data })
        } else {
            createMutation.mutate(data)
        }
    }

    const handlePlanTimeSubmit = (data) => {
        // Plan time için backend henüz hazır değil, şimdilik normal log olarak kaydet
        createMutation.mutate({
            ...data,
            date_worked: data.start_date,
            duration_hours: data.planned_hours,
            description: `Planlanan: ${data.planned_hours} saat`,
        })
        setPlanTimeModalOpen(false)
    }

    const handleSubmitPeriod = (data) => {
        submitTimesheetMutation(data)
    }

    const [exportLoading, setExportLoading] = useState(false)

    const handleExportExcel = async () => {
        try {
            setExportLoading(true)
            await reportsService.exportExcel({
                start_date: weekStart.format('YYYY-MM-DD'),
                end_date: weekEnd.format('YYYY-MM-DD'),
            })
            message.success('Haftalık rapor indirildi')
        } catch (error) {
            console.error('Export error:', error)
            message.error('Rapor indirilirken bir hata oluştu')
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
                    <h1 className="user-header-name">{user?.full_name || 'User'}</h1>
                </div>

                <div className="user-header-right">
                    <Tooltip title="Excel Raporu">
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
                        <span className="summary-label">Hafta:</span>
                        <span className="summary-hours">{weekTotalHours}h</span>
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
                        onLogTime={handleLogTime}
                        onPlanTime={handlePlanTime}
                        onEditLog={handleEditLog}
                        onDeleteLog={handleDeleteLog}
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
                initialDate={selectedDate}
                editingLog={editingLog}
                loading={createMutation.isPending || updateMutation.isPending}
            />

            <PlanTimeModal
                open={planTimeModalOpen}
                onClose={() => setPlanTimeModalOpen(false)}
                onSubmit={handlePlanTimeSubmit}
                initialDate={selectedDate}
                loading={createMutation.isPending}
            />

            <SubmitPeriodModal
                open={submitModalOpen}
                onClose={() => setSubmitModalOpen(false)}
                period={selectedPeriod}
                onSubmit={handleSubmitPeriod}
                loading={isSubmitting}
            />
        </div>
    )
}

export default TimeEntryPage
