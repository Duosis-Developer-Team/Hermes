/**
 * =============================================================================
 * HERMES PLATFORM - Zaman Girisi
 * =============================================================================
 * Hafta ve Cizelge gorunumleri, haftalik gezinme; efor girisi, inceleme ve
 * silme onayi pencereleri (Plan Time 29.09'da kaldirildi).
 * =============================================================================
 */

import { useState, useMemo, useEffect } from 'react'
import { message } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import WeeklyListView from '../components/time-entry/WeeklyListView'
import TimesheetView from '../components/time-entry/TimesheetView'
import LogTimeModal from '../components/modals/LogTimeModal'
import WorkLogReviewModal from '../components/modals/WorkLogReviewModal'
import DangerConfirmModal from '../components/common/DangerConfirmModal'
import { workLogService, reportsService, authService, capacityService } from '../services/api'
import { queryKeys } from '../query/queryKeys'
import { useAuthStore } from '../stores/authStore'
import {
    buildPastePayload, isEditableTarget, makeClipboardSnapshot,
} from '../features/time-entry/model/clipboard'
import WeekNavigator from '../features/time-entry/components/WeekNavigator'
import TimeEntryHeader from '../features/time-entry/components/TimeEntryHeader'
import './TimeEntryPage.css'
import { useT } from '../i18n'

dayjs.extend(isoWeek)

// 0.75 → "0h 45m", 2.75 → "2h 45m", 2.0 → "2h"
function formatDuration(decimal) {
    if (!decimal) return '0h'
    const h = Math.floor(decimal)
    const m = Math.round((decimal - h) * 60)
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
}

function TimeEntryPage() {
    const t = useT()
    const queryClient = useQueryClient()
    const { user } = useAuthStore()

    // ==========================================================================
    // State
    // ==========================================================================
    const [viewMode, setViewMode] = useState('list') // 'list' | 'timesheet'
    // PM rework P3: ana sayfa efor seridinden gelen `?date=` o gunun
    // haftasini acar ve Log Time'i o gune kurar (04-roller §4.1 "tiklayinca
    // o gune giris acilir"); parametre URL'den silinir ki yenilemede
    // modal tekrar acilmasin.
    const [searchParams, setSearchParams] = useSearchParams()
    const [weekStart, setWeekStart] = useState(() => {
        // `?week=` yalnizca haftayi acar (D4 plan satiri); `?date=` ayrica
        // Log Time'i o gune kurar.
        const wanted = searchParams.get('date') || searchParams.get('week')
        const parsed = wanted ? dayjs(wanted) : null
        return (parsed && parsed.isValid() ? parsed : dayjs()).startOf('isoWeek')
    })

    // Modal states
    const [logTimeModalOpen, setLogTimeModalOpen] = useState(false)
    const [selectedDate, setSelectedDate] = useState(null)
    const [editingLog, setEditingLog] = useState(null)
    const [selectedUserId, setSelectedUserId] = useState(null) // Admin override
    const [deletingLog, setDeletingLog] = useState(null)   // log pending delete confirmation
    const [reviewingLog, setReviewingLog] = useState(null) // incelenen efor kaydi

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


    /*
     * `workLogsResponse?.data || []` her render'da YENI bir dizi uretir.
     * Bu, asagidaki useMemo'yu ise yaramaz hale getiriyor ve klavye
     * kisayolu effect'ini HER RENDER'da yeniden baglatiyordu (listener
     * ekle/kaldir dongusu). Referans stabil tutulur.
     */
    const workLogs = useMemo(
        () => workLogsResponse?.data || [], [workLogsResponse]
    )

    /*
     * PM rework P0 / D2 — KAPASITE: beklenen saat, tatil/izin, eksik gun.
     * Tek sorgu; WeekNavigator (hafta ozeti) ve DayColumn (gun kutulari)
     * ayni veriyi okur. Baskasinin haftasi icin backend worklogs.admin
     * ister — burada ek kontrol yok, sunucu 403 verir.
     */
    const weekStartKey = weekStart.format('YYYY-MM-DD')
    const { data: capacityWeek } = useQuery({
        queryKey: queryKeys.capacity.week({ start: weekStartKey, user_id: targetUserId }),
        queryFn: () => capacityService.getWeek({
            start: weekStartKey, user_id: selectedUserId || null,
        }),
        enabled: !!user?.id,
    })
    const capacityDays = useMemo(() => {
        const map = {}
        for (const d of capacityWeek?.days || []) map[d.date] = d
        return map
    }, [capacityWeek])
    const invalidateCapacity = () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.capacity.all })

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
            message.success(t('timeEntry.timeLogged'))
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
            invalidateCapacity()
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
            invalidateCapacity()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Paste failed')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => workLogService.update(id, data),
        onSuccess: () => {
            message.success(t('timeEntry.timeUpdated'))
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
            invalidateCapacity()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'An error occurred')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: workLogService.delete,
        onSuccess: () => {
            message.success(t('timeEntry.logEntryDeleted'))
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
            invalidateCapacity()
            setDeletingLog(null)
        },
    })

    // Izin isaretle / kaldir — eksik gun kutusundaki "izinliysen isaretle".
    const markAbsenceMutation = useMutation({
        mutationFn: (dateKey) => capacityService.createAbsence({
            user_id: selectedUserId || undefined,
            start_date: dateKey, end_date: dateKey, absence_type: 'leave',
        }),
        onSuccess: () => {
            message.success(t('timeEntry.leaveMarked'))
            invalidateCapacity()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || t('timeEntry.leaveFailed'))
        },
    })
    const removeAbsenceMutation = useMutation({
        mutationFn: (absenceId) => capacityService.deleteAbsence(absenceId),
        onSuccess: () => {
            message.success(t('timeEntry.leaveRemoved'))
            invalidateCapacity()
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || t('timeEntry.leaveFailed'))
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

    useEffect(() => {
        const wanted = searchParams.get('date')
        if (!wanted && !searchParams.has('week')) return
        const parsed = wanted ? dayjs(wanted) : null
        if (parsed && parsed.isValid()) handleLogTime(parsed)
        const next = new URLSearchParams(searchParams)
        next.delete('date')
        next.delete('week')
        setSearchParams(next, { replace: true })
        // Derin baglanti tuketilince URL'den silinir; sayfa zaten acikken
        // gelen yeni ?date= (ornegin dock'taki "Efor gir") de islenir.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams])

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
                    message.warning(t('timeEntry.selectTargetDay'))
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
    }, [selectedLogId, copiedLog, targetDate, workLogs, pasteMutation, t])

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

            message.success(t('timeEntry.reportDownloaded'))
        } catch (error) {
            console.error('Export error:', error)
            message.error(t('timeEntry.reportFailed'))
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
                weekLabel={weekLabel}
                onLogToday={() => handleLogTime(dayjs())}
            />

            {/* Week Navigation + haftalik ozet — Sprint 5: ayri bilesen
                (davranis/markup ayni). */}
            <WeekNavigator
                weekLabel={weekLabel}
                totalLabel={formatDuration(weekTotalHours)}
                capacity={capacityWeek || null}
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
                        onLogTime={handleLogTime}
                        onEditLog={handleEditLog}
                        onDeleteLog={handleDeleteLog}
                        onReviewLog={setReviewingLog}
                        selectedLogId={selectedLogId}
                        copiedLogId={copiedLog?.sourceId ?? null}
                        copiedLog={copiedLog}
                        targetDate={targetDate}
                        onSelectLog={handleSelectLog}
                        onSelectDay={handleSelectDay}
                        onClearClipboard={handleClearClipboard}
                        capacityDays={capacityDays}
                        onMarkAbsence={(dateKey) => markAbsenceMutation.mutate(dateKey)}
                        onRemoveAbsence={(absenceId) => removeAbsenceMutation.mutate(absenceId)}
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

            {/* Efor inceleme: ayrintilar + Duzenle / Sil (is incelemesiyle ayni dil). */}
            <WorkLogReviewModal
                log={reviewingLog}
                onClose={() => setReviewingLog(null)}
                onEdit={(log) => { setReviewingLog(null); handleEditLog(log) }}
                onDelete={(log) => { setReviewingLog(null); handleDeleteLog(log) }}
            />

            {/* Silme onayi: ortak onay penceresi (kayit onizlemeli). */}
            <DangerConfirmModal
                open={!!deletingLog}
                title={t('timeEntry.confirmDeletion')}
                subtitle={t('timeEntry.cannotBeUndone')}
                itemName={deletingLog
                    ? [deletingLog.customer_name, deletingLog.project_name].filter(Boolean).join(' · ')
                    : undefined}
                itemSubtitle={deletingLog?.description
                    ? (deletingLog.description.length > 80
                        ? `${deletingLog.description.substring(0, 80)}…`
                        : deletingLog.description)
                    : undefined}
                body={t('timeEntry.deleteLogBody')}
                onCancel={handleDeleteCancel}
                onConfirm={handleDeleteConfirm}
                loading={deleteMutation.isPending}
            />
        </div>
    )
}

export default TimeEntryPage
