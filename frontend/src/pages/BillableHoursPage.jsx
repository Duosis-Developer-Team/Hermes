/**
 * =============================================================================
 * HERMES PLATFORM - Billable Hours Page (Admin Only)
 * =============================================================================
 * Admin page for managing user billable hours.
 * =============================================================================
 */

import { useState, useMemo } from 'react'
import {
    Table,
    Button,
    Select,
    message,
    Tooltip,
    Spin
} from 'antd'
import HoursMinutesPicker from '../components/common/HoursMinutesPicker'
import {
    CloseOutlined,
    LeftOutlined,
    RightOutlined,
    SaveOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { normalizeApiError } from '../features/admin/shared/normalizeApiError'
import {
    AdminErrorAlert, AdminRefreshHint,
} from '../features/admin/shared/AdminListStates'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import { workLogService, authService, customerService, projectService } from '../services/api'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../i18n'
import { Avatar as LqAvatar, CountUp, GlassCard, PageHero } from '../components/liquid'
import './BillableHoursPage.css'

dayjs.extend(isoWeek)

// Decimal hours → "2h 30m" display string (handles legacy data)
function formatDecimalToHM(decimal) {
    const num = parseFloat(decimal) || 0
    const h = Math.floor(num)
    const m = Math.round((num - h) * 60)
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

function BillableHoursPage() {
    const t = useT()
    const queryClient = useQueryClient()
    const { user } = useAuthStore()
    // RBAC R3: sayfa yetkisi reports.view iznine bakar.
    const canViewReports = useAuthStore((s) => s.can)('reports.view')
    // Baskasinin zaman girislerini gorme yetkisi: backend'in
    // list_work_logs ucunda uyguladigi izinle AYNI (worklogs.admin).
    const canViewOtherUsers = useAuthStore((s) => s.can)('worklogs.admin')
    const permissions = useAuthStore((s) => s.permissions)
    /*
     * `can()` izinler HENUZ YUKLENMEMISKEN (null) de `false` doner. Bu
     * sayfa bunu dogrudan "Access Denied" olarak gosteriyordu: yetkili
     * bir kullanici, izinler gelene kadar YANLIS bir ret ekrani
     * goruyordu. Ucuncu bir durum gerekiyor — "henuz bilmiyoruz".
     * (Rota zaten ProtectedRoute ile korunuyor; buradaki kontrol
     * savunma katmanidir ve artik yaniltmiyor.)
     */
    const permissionsLoaded = Array.isArray(permissions)

    // ==========================================================================
    // State
    // ==========================================================================
    const [weekStart, setWeekStart] = useState(() => dayjs().startOf('isoWeek'))
    const [selectedUserId, setSelectedUserId] = useState(user?.id)
    const [editingId, setEditingId] = useState(null)
    const [editValue, setEditValue] = useState(null)

    // ==========================================================================
    // Week Navigation
    // ==========================================================================
    const weekEnd = weekStart.endOf('isoWeek')
    // Format: Jan 19 - Jan 25, 2026
    const weekLabel = `${weekStart.format('D MMM')} – ${weekEnd.format('D MMM YYYY')}`

    const goToPreviousWeek = () => setWeekStart(prev => prev.subtract(1, 'week'))
    const goToNextWeek = () => setWeekStart(prev => prev.add(1, 'week'))
    const goToToday = () => setWeekStart(dayjs().startOf('isoWeek'))

    // ==========================================================================
    // Data Fetching
    // ==========================================================================
    /*
     * Kullanici listesi: EN AZ AYRICALIKLI uc.
     *
     * KAPATILAN KUSUR: RBAC cutover'inda (f6882f1) sayfa kapisi
     * `is_admin` yerine `reports.view` oldu, ama liste hala
     * `GET /api/v1/auth/users` (users.manage ZORUNLU) ucundan
     * geliyordu. `reports.view` olup `users.manage` olmayan kullanicida
     * istek 403 donuyor, liste bos kaliyor ve AntD Select secili
     * degeri eslestirecek option bulamayinca HAM UUID basiyordu.
     * `/users/lookup` her kimligi dogrulanmis kullaniciya aciktir,
     * yalniz (id, ad, e-posta) doner ve 100 kayitlik sayfalama
     * tavani yoktur.
     */
    const { data: usersResponse, isLoading: usersLoading } = useQuery({
        queryKey: ['users-lookup'],
        queryFn: () => authService.lookupUsers(),
        // Yalniz baskasini secebilen kullanici icin cekilir; aksi
        // halde tek secenek zaten kullanicinin kendisidir.
        enabled: !!canViewReports && !!canViewOtherUsers,
        staleTime: 5 * 60 * 1000,
    })

    // Fetch Customers
    const { data: customersResponse } = useQuery({
        queryKey: ['customers-list'],
        queryFn: () => customerService.getAll(),
        enabled: !!canViewReports,
    })

    // Fetch Projects
    const { data: projectsResponse } = useQuery({
        queryKey: ['projects-list'],
        queryFn: () => projectService.getAll(),
        enabled: !!canViewReports,
    })

    // Fetch Work Logs for selected user
    const {
        data: workLogsResponse, isLoading: logsLoading, isFetching: logsFetching,
        isError: logsError, error: logsErrObj, refetch: refetchLogs,
    } = useQuery({
        queryKey: ['workLogs', weekStart.format('YYYY-MM-DD'), selectedUserId],
        queryFn: () => workLogService.getMyLogs({
            start_date: weekStart.format('YYYY-MM-DD'),
            end_date: weekEnd.format('YYYY-MM-DD'),
            limit: 500,
            user_id: selectedUserId
        }),
        enabled: !!selectedUserId,
    })

    /*
     * Secili kullanici HER ZAMAN bir option'a sahip olmali. Liste
     * yuklenmemis, bos donmus veya istek basarisiz olmus olabilir;
     * bu durumlarin hicbirinde kullaniciya ham bir kimlik (UUID)
     * gosterilmez — en kotu durumda kendi adiyla kendini gorur.
     * `/users/lookup` duz dizi doner; zarfli sekil de tolere edilir.
     */
    const usersList = useMemo(() => {
        const list = Array.isArray(usersResponse)
            ? usersResponse
            : (usersResponse?.data || [])
        const byId = new Map(list.map((u) => [u.id, u]))
        if (user?.id && !byId.has(user.id)) {
            byId.set(user.id, {
                id: user.id,
                full_name: user.full_name || user.email,
            })
        }
        return [...byId.values()]
    }, [usersResponse, user])

    // Create maps for fast lookup
    const customersMap = useMemo(() => {
        const map = {}
        // Backend returns flat array for customers
        const list = Array.isArray(customersResponse) ? customersResponse : (customersResponse?.data || [])

        if (Array.isArray(list)) {
            list.forEach(c => { map[c.id] = c })
        }
        return map
    }, [customersResponse])

    const projectsMap = useMemo(() => {
        const map = {}
        // Backend returns flat array for projects
        const list = Array.isArray(projectsResponse) ? projectsResponse : (projectsResponse?.data || [])

        if (Array.isArray(list)) {
            list.forEach(p => { map[p.id] = p })
        }
        return map
    }, [projectsResponse])

    const workLogs = useMemo(() => {
        const rawLogs = workLogsResponse?.data || []

        // Enrich logs with names found in maps
        const enriched = rawLogs.map(log => {
            const customerName = log.customer?.name || customersMap[log.customer_id]?.name || 'Unknown'
            const projectName = log.project?.name || projectsMap[log.project_id]?.name || 'Unknown'

            return {
                ...log,
                customerName,
                projectName
            }
        })

        return enriched.sort((a, b) => dayjs(b.date_worked).diff(dayjs(a.date_worked)))
    }, [workLogsResponse, customersMap, projectsMap])

    const workedHours = useMemo(() => workLogs.reduce(
        (sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0,
    ), [workLogs])

    const totalHours = useMemo(() => {
        return workLogs.reduce((sum, log) => {
            // Use billable hours if available, otherwise worked hours
            const billable = log.billable_duration_hours !== null && log.billable_duration_hours !== undefined
                ? parseFloat(log.billable_duration_hours)
                : parseFloat(log.duration_hours)
            return sum + (billable || 0)
        }, 0)
    }, [workLogs])

    // ==========================================================================
    // Mutation
    // ==========================================================================
    const updateMutation = useMutation({
        // Only update billable_duration_hours, preserve duration_hours
        mutationFn: ({ id, billable_duration_hours }) => workLogService.update(id, { billable_duration_hours }),
        onSuccess: () => {
            message.success(t('billableHours.hoursUpdated'))
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
            setEditingId(null)
            setEditValue(null)
        },
        onError: (error) => {
            // Teknik govde kullaniciya sizmaz; sunucunun domain aciklamasi
            // korunur.
            message.error(normalizeApiError(error).message)
        },
    })

    // ==========================================================================
    // Handlers
    // ==========================================================================
    const handleEditStart = (record) => {
        setEditingId(record.id)
        // Set edit value to billable hours (or fallback to worked hours)
        const val = record.billable_duration_hours !== null && record.billable_duration_hours !== undefined
            ? record.billable_duration_hours
            : record.duration_hours
        setEditValue(val)
    }

    const handleSave = (id) => {
        // Cift gonderim kilidi KAYNAKTA: butonun `loading` olmasi bir
        // render GEC gelir.
        if (updateMutation.isPending) return
        if (editValue === null || editValue <= 0) return
        const mins = Math.round((editValue - Math.floor(editValue)) * 60)
        if (mins % 15 !== 0) {
            message.error(t('billableHours.minuteIncrement'))
            return
        }
        updateMutation.mutate({ id, billable_duration_hours: editValue })
    }

    // ==========================================================================
    // Columns
    // ==========================================================================
    const columns = [
        {
            title: t('billableHours.colDate'),
            dataIndex: 'date_worked',
            key: 'date_worked',
            width: 110,
            render: (text) => (
                <span className="bh-date">{dayjs(text).format('ddd D')}</span>
            ),
        },
        {
            title: t('billableHours.colCustomer'),
            key: 'customer',
            width: 170,
            render: (_, record) => <span className="bh-customer">{record.customerName}</span>,
        },
        {
            title: t('billableHours.colProject'),
            key: 'project',
            width: 170,
            render: (_, record) => <span className="lq-tag lq-tag--info">{record.projectName}</span>,
        },
        {
            title: t('billableHours.colDescription'),
            dataIndex: 'description',
            key: 'description',
            ellipsis: true,
            render: (text) => (
                <Tooltip title={text}>
                    <span className="bh-desc">{text || '-'}</span>
                </Tooltip>
            ),
        },
        {
            title: t('billableHours.colWorked'),
            key: 'duration_hours',
            width: 100,
            render: (_, record) => <span className="bh-worked">{formatDecimalToHM(record.duration_hours)}</span>,
        },
        {
            title: t('billableHours.title'),
            key: 'billable_duration_hours',
            width: 250,
            className: 'billable-col',
            render: (_, record) => {
                const isEditing = editingId === record.id
                const displayValue = record.billable_duration_hours !== null && record.billable_duration_hours !== undefined
                    ? record.billable_duration_hours
                    : record.duration_hours

                return isEditing ? (
                    <div className="bh-edit">
                        <HoursMinutesPicker value={editValue} onChange={setEditValue} size="small" />
                        <Button
                            aria-label={t('billableHours.save')}
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={() => handleSave(record.id)}
                            loading={updateMutation.isPending}
                        />
                        <Button
                            aria-label={t('common.cancel')}
                            size="small"
                            type="text"
                            icon={<CloseOutlined />}
                            onClick={() => { setEditingId(null); setEditValue(null) }}
                        />
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => handleEditStart(record)}
                        className="editable-duration-cell"
                        aria-label={`${t('common.edit')}: ${formatDecimalToHM(displayValue)}`}
                    >
                        {formatDecimalToHM(displayValue)}
                    </button>
                )
            },
        },
    ]

    // ==========================================================================
    // Render
    // ==========================================================================
    if (!permissionsLoaded) {
        // Izinler bilinmiyor: NE icerik NE ret. Aksi halde yetkili
        // kullaniciya bir an "Access Denied" gosteriliyordu.
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <Spin />
            </div>
        )
    }

    if (!canViewReports) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-strong)' }}>{t('billableHours.accessDenied')}</div>
    }

    const ratio = workedHours > 0 ? Math.round((totalHours / workedHours) * 100) : null

    return (
        <div className="billable-page">
            <PageHero
                title={t('billableHours.title')}
                subtitle={t('billableHours.subtitle')}
                actions={(
                    <>
                        <Select
                            className="bh-user-select"
                            value={selectedUserId}
                            onChange={setSelectedUserId}
                            loading={usersLoading}
                            /* Baskasinin kayitlarini gormek worklogs.admin
                               ister (backend kurali). Izin yoksa tek secenek
                               kullanicinin KENDISIDIR. */
                            disabled={!canViewOtherUsers}
                            aria-label={t('billableHours.selectUser')}
                            suffixIcon={<TeamOutlined />}
                            options={usersList.map(u => ({
                                label: u.full_name || u.email || 'Unknown user',
                                value: u.id,
                            }))}
                            optionRender={(option) => (
                                <span className="bh-user-option">
                                    <LqAvatar id={option.value} name={String(option.label)} size={22} />
                                    {option.label}
                                </span>
                            )}
                            showSearch
                            filterOption={(input, option) =>
                                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                            }
                        />
                        <div className="bh-toolbar h-inline-toolbar">
                            <Button shape="circle" aria-label={t('billableHours.previousWeek')} icon={<LeftOutlined />} onClick={goToPreviousWeek} />
                            <span className="bh-week">{weekLabel}</span>
                            <Button shape="circle" aria-label={t('billableHours.nextWeek')} icon={<RightOutlined />} onClick={goToNextWeek} />
                            <Button onClick={goToToday}>{t('billableHours.currentWeek')}</Button>
                        </div>
                    </>
                )}
            />

            {/* Ozet (prototip): toplam · faturalanabilir · oran cubugu */}
            <div className="bh-kpis lq-enter">
                <GlassCard className="lq-kpi">
                    <span className="lq-kpi__value"><CountUp value={workedHours} decimals={2} format={formatDecimalToHM} /></span>
                    <span className="lq-kpi__label">{t('billableHours.weekTotal')}</span>
                </GlassCard>
                <GlassCard className="lq-kpi bh-kpi--billable">
                    <span className="lq-kpi__value"><CountUp value={totalHours} decimals={2} format={formatDecimalToHM} /></span>
                    <span className="lq-kpi__label">{t('billableHours.title')}</span>
                </GlassCard>
                <GlassCard className="bh-ratio">
                    <span className="bh-ratio__track" aria-hidden="true">
                        <i style={{ width: `${Math.min(100, ratio ?? 0)}%` }} />
                    </span>
                    <b className="bh-ratio__value" aria-label={t('billableHours.ratio')}>{ratio === null ? '—' : `%${ratio}`}</b>
                </GlassCard>
            </div>

            <GlassCard className="bh-table lq-card--flush">
                <AdminErrorAlert
                    error={logsError ? logsErrObj : null}
                    onRetry={refetchLogs}
                />
                <Table
                    dataSource={workLogs}
                    columns={columns}
                    rowKey="id"
                    /* Ilk yukleme ile arkaplan yenilemesi AYRI. */
                    loading={logsLoading && workLogs.length === 0}
                    pagination={false}
                    scroll={{ x: 800 }}
                    locale={{
                        emptyText: (
                            <div className="bh-empty">
                                {logsError
                                    ? t('billableHours.loadFailed')
                                    : t('billableHours.emptyWeek', { week: weekLabel })}
                            </div>
                        ),
                    }}
                />
                <AdminRefreshHint
                    isFetching={logsFetching}
                    hasData={workLogs.length > 0}
                />
            </GlassCard>
        </div>
    )
}

export default BillableHoursPage
