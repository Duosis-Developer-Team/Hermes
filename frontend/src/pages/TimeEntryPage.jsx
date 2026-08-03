/**
 * =============================================================================
 * HERMES PLATFORM - Time Entry Page (Jira Tempo Style)
 * =============================================================================
 * Yeni tasarım: List ve Timesheet görünümleri, haftalık navigasyon,
 * Log Time ve Plan Time modal'ları.
 * =============================================================================
 */

import { useState, useMemo, useEffect } from 'react'
import { Button, Modal, message } from 'antd'
import {
    ExclamationCircleOutlined,
    DeleteOutlined
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import 'dayjs/locale/en'

import WeeklyListView from '../components/time-entry/WeeklyListView'
import TimesheetView from '../components/time-entry/TimesheetView'
import LogTimeModal from '../components/modals/LogTimeModal'
import PlanTimeModal from '../components/modals/PlanTimeModal'
import { workLogService, reportsService, authService, planTimeService } from '../services/api'
import { useAuthStore } from '../stores/authStore'
import {
    buildPastePayload, isEditableTarget, makeClipboardSnapshot,
} from '../features/time-entry/model/clipboard'
import WeekNavigator from '../features/time-entry/components/WeekNavigator'
import TimeEntryHeader from '../features/time-entry/components/TimeEntryHeader'
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
    const [selectedUserId, setSelectedUserId] = useState(null) // Admin override
    const [deletingLog, setDeletingLog] = useState(null)   // log pending delete confirmation
    const [deletingPlan, setDeletingPlan] = useState(null) // plan pending delete confirmation

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
    // RBAC R3: baskasi adina log/plan gorme worklogs.admin ister.
    // Kullanici listesi getUsers'tan (users.manage isteyen admin ucu)
    // DEGIL lookupUsers'tan gelir — worklogs.admin'i olan ama
    // users.manage'i olmayan rol de selector'u kullanabilsin.
    const canWorklogsAdmin = useAuthStore((s) => s.can)('worklogs.admin')
    useAuthStore((s) => s.permissions)
    const { data: usersResponse } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.lookupUsers(),
        enabled: canWorklogsAdmin,
    })

    const usersList = Array.isArray(usersResponse) ? usersResponse : (usersResponse?.data || [])
    const targetUserId = selectedUserId || user?.id

    // Fetch Work Logs
    const { data: workLogsResponse } = useQuery({
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
    const { data: planTimesResponse,  } = useQuery({
        queryKey: ['planTimes', weekStart.format('YYYY-MM-DD'), user?.id, canWorklogsAdmin],
        queryFn: () => canWorklogsAdmin
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
    // Admin için getAll dönüyor — assignments array'inden görüntülenen kullanıcının status'unu enrich et
    const planTimes = useMemo(() => {
        const raw = planTimesResponse?.data || []
        if (!canWorklogsAdmin) return raw

        // Hangi kullanıcının takvimi görüntüleniyor?
        const viewedId = selectedUserId || user.id
        const isViewingOwnCalendar = viewedId === user.id

        return raw.map(pt => {
            // Görüntülenen kullanıcının assignment'ı
            const viewedAssignment = pt.assignments?.find(a => a.user_id === viewedId)
            // Admin'in kendi assignment'ı (edit/delete yetkisi için)
            const myAssignment = pt.assignments?.find(a => a.user_id === user.id)

            if (viewedAssignment) {
                return {
                    ...pt,
                    // Accept/Reject sadece kendi takvimine bakarken çalışsın
                    assignment_id: isViewingOwnCalendar ? `${pt.id}_self` : undefined,
                    status: viewedAssignment.status,
                }
            }
            if (myAssignment && isViewingOwnCalendar) {
                return { ...pt, assignment_id: `${pt.id}_self`, status: myAssignment.status }
            }
            return pt
        })
        /*
         * `canWorklogsAdmin` GERCEK bir bagimlilik: izin sorgusu sonradan
         * cozuldugunde (false → true) admin zenginlestirmesi yeniden
         * hesaplanmali. Eksik oldugu icin izin geldiginde plan time
         * status'lari eski haliyle kaliyordu.
         */
    }, [planTimesResponse, user, selectedUserId, canWorklogsAdmin])

    /*
     * `workLogsResponse?.data || []` her render'da YENI bir dizi uretir.
     * Bu, asagidaki useMemo'yu ise yaramaz hale getiriyor ve klavye
     * kisayolu effect'ini HER RENDER'da yeniden baglatiyordu (listener
     * ekle/kaldir dongusu). Referans stabil tutulur.
     */
    const workLogs = useMemo(
        () => workLogsResponse?.data || [], [workLogsResponse]
    )

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
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'An error occurred')
        },
    })

    // Separate mutation for paste — no generic toast
    const pasteMutation = useMutation({
        mutationFn: (data) => workLogService.create(data, selectedUserId || null),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Paste failed')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => workLogService.update(id, data),
        onSuccess: () => {
            message.success('Time updated')
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'An error occurred')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: workLogService.delete,
        onSuccess: () => {
            message.success('Log entry deleted successfully')
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
            setDeletingLog(null)
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'An error occurred')
            setDeletingLog(null)
        },
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
            queryClient.invalidateQueries({ queryKey: ['planTimes'] })
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
            queryClient.invalidateQueries({ queryKey: ['planTimes'] })
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Failed to update plan')
        },
    })

    const deletePlanTimeMutation = useMutation({
        mutationFn: (id) => planTimeService.delete(id),
        onSuccess: () => {
            message.success('Plan deleted')
            setDeletingPlan(null)
            queryClient.invalidateQueries({ queryKey: ['planTimes'] })
        },
        onError: () => {
            message.error('Failed to delete plan')
            setDeletingPlan(null)
        },
    })

    const respondPlanTimeMutation = useMutation({
        mutationFn: ({ planTimeId, status }) => planTimeService.respond(planTimeId, status),
        onSuccess: (_, { status }) => {
            message.success(status === 'accepted' ? 'Accepted' : 'Rejected')
            queryClient.invalidateQueries({ queryKey: ['planTimes'] })
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

    const handleDeletePlanTime = (plan) => {
        setDeletingPlan(plan)
    }

    const handleDeletePlanConfirm = () => {
        if (deletingPlan) deletePlanTimeMutation.mutate(deletingPlan.id)
    }

    const handlePlanTimeRespond = (planTimeId, status) => {
        respondPlanTimeMutation.mutate({ planTimeId, status })
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
            // Guard: form alanindayken sayfa kisayollari calismaz.
            // Saf fonksiyon (features/time-entry/model/clipboard) — DOM'da
            // test edilemeyen contenteditable dali orada kapsanir.
            if (isEditableTarget(document.activeElement)) return

            const isMod = e.ctrlKey || e.metaKey

            // ── Ctrl+C — copy selected log ──────────────────────────────────
            if (isMod && e.key === 'c') {
                if (selectedLogId) {
                    const log = workLogs.find(l => l.id === selectedLogId)
                    if (log) {
                        // IMMUTABLE snapshot: kaynak kayit sonradan
                        // degisse/silinse bile pano icerigi korunur (§6).
                        const snapshot = makeClipboardSnapshot(log)
                        setCopiedLog(snapshot)
                        message.info(`"${snapshot.label}" copied — select a target day, then Ctrl+V`)
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

                const newLog = buildPastePayload(copiedLog, targetDate)
                if (pasteMutation.isPending) return // debounce double-paste

                try {
                    await pasteMutation.mutateAsync(newLog)
                    const formattedDate = dayjs(targetDate).format('DD MMM')
                    message.success(`"${copiedLog.label}" pasted to ${formattedDate} ✓`)
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
            {/* Kullanici basligi + ust aksiyonlar — Sprint 5: ayri
                bilesen (markup/handler sozlesmesi ayni). */}
            <TimeEntryHeader
                canSelectUser={canWorklogsAdmin}
                targetUserId={targetUserId}
                usersList={usersList}
                onSelectUser={setSelectedUserId}
                displayName={user?.full_name || user?.email}
                exportLoading={exportLoading}
                onExport={handleExportExcel}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
            />

            {/* Week Navigation + haftalik ozet — Sprint 5: ayri bilesen
                (davranis/markup ayni). */}
            <WeekNavigator
                weekLabel={weekLabel}
                totalLabel={formatDuration(weekTotalHours)}
                onPrevious={goToPreviousWeek}
                onNext={goToNextWeek}
                onToday={goToToday}
            />

            {/* Content */}
            <div className="time-entry-content">
                {viewMode === 'list' ? (
                    <WeeklyListView
                        weekStart={weekStart}
                        workLogs={workLogs}
                        planTimes={planTimes}
                        onLogTime={handleLogTime}
                        onPlanTime={canWorklogsAdmin ? handlePlanTime : undefined}
                        onEditLog={handleEditLog}
                        onDeleteLog={handleDeleteLog}
                        onPlanTimeRespond={handlePlanTimeRespond}
                        onDeletePlanTime={handleDeletePlanTime}
                        onEditPlanTime={handleEditPlanTime}
                        selectedLogId={selectedLogId}
                        copiedLogId={copiedLog?.sourceId ?? null}
                        copiedLog={copiedLog}
                        targetDate={targetDate}
                        onSelectLog={handleSelectLog}
                        onSelectDay={handleSelectDay}
                        onClearClipboard={handleClearClipboard}
                        isAdmin={canWorklogsAdmin}
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
                currentUserId={user?.id}
                loading={createPlanTimeMutation.isPending || updatePlanTimeMutation.isPending}
            />


            {/* Plan Time Delete Confirmation Modal */}
            <Modal
                open={!!deletingPlan}
                onCancel={() => setDeletingPlan(null)}
                footer={null}
                width={420}
                centered
                closable={false}
                styles={{
                    content: {
                        background: 'var(--c-surface-2)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 12,
                        padding: '28px 28px 24px',
                    }
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-text-strong)' }}>Delete Plan</div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 2 }}>All assignments will be removed</div>
                        </div>
                    </div>

                    {deletingPlan && (
                        <div style={{
                            background: 'var(--c-border)',
                            border: '1px solid var(--c-border-strong)',
                            borderRadius: 8,
                            padding: '10px 14px',
                        }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                                {deletingPlan.project_name || 'Plan Time'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 3 }}>
                                {deletingPlan.customer_name}
                            </div>
                        </div>
                    )}

                    <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                        Are you sure you want to delete this plan?
                    </p>

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                        <Button
                            onClick={() => setDeletingPlan(null)}
                            style={{ background: 'transparent', borderColor: 'var(--c-border-strong)', color: 'var(--c-text)', borderRadius: 8 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="primary"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={handleDeletePlanConfirm}
                            loading={deletePlanTimeMutation.isPending}
                            style={{ borderRadius: 8 }}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </Modal>

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
                        background: 'var(--c-surface-2)',
                        border: '1px solid var(--c-border)',
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
                            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-text-strong)' }}>
                                Confirm Deletion
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 2 }}>
                                This action cannot be undone
                            </div>
                        </div>
                    </div>

                    {/* Log preview */}
                    {deletingLog && (
                        <div style={{
                            background: 'var(--c-border)',
                            border: '1px solid var(--c-border-strong)',
                            borderRadius: 8,
                            padding: '10px 14px',
                        }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                                {deletingLog.project_name || 'Log Entry'}
                            </div>
                            {deletingLog.description && (
                                <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 3 }}>
                                    {deletingLog.description.length > 60
                                        ? deletingLog.description.substring(0, 60) + '…'
                                        : deletingLog.description}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Message */}
                    <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                        Are you sure you want to delete this time log?
                    </p>

                    {/* Buttons */}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                        <Button
                            onClick={handleDeleteCancel}
                            style={{
                                background: 'transparent',
                                borderColor: 'var(--c-border-strong)',
                                color: 'var(--c-text)',
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
