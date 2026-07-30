/**
 * =============================================================================
 * HERMES PLATFORM - Reports & Analytics (Tempo-Style Unified Dashboard)
 * =============================================================================
 * JIRA Tempo mantığında dinamik filtre çubuğu ve reaktif tablo.
 * Atlassian Design System renk paletine uygun tasarım.
 * =============================================================================
 */

import { useState, useMemo } from 'react'
import {
    DatePicker, Button, Select, Row, Col, Table, message, Tag, Empty, Spin
} from 'antd'
import {
    DownloadOutlined,
    BarChartOutlined,
    PieChartOutlined,
    CloseCircleOutlined,
    CalendarOutlined
} from '@ant-design/icons'
import { keepPreviousData, useQuery, useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'

import { normalizeApiError } from '../features/admin/shared/normalizeApiError'
import {
    AdminErrorAlert, AdminRefreshHint,
} from '../features/admin/shared/AdminListStates'
import {
    reportsService,
    authService,
    customerService,
    projectService,
    workTypeService,
    platformService
} from '../services/api'
import { useAuthStore } from '../stores/authStore'

const { RangePicker } = DatePicker

// Converts decimal hours to human-readable duration: 0.75 → "45m", 2.75 → "2h 45m", 2.0 → "2h"
function formatDuration(decimalHours) {
    if (!decimalHours && decimalHours !== 0) return '—'
    const h = Math.floor(decimalHours)
    const m = Math.round((decimalHours - h) * 60)
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
}

// =============================================================================
// Main Component
// =============================================================================

function ReportsPage() {
    // RBAC R3: sayfa yetkisi reports.view iznine bakar.
    const canViewReports = useAuthStore((s) => s.can)('reports.view')
    const permissions = useAuthStore((s) => s.permissions)
    /*
     * `can()` izinler HENUZ YUKLENMEMISKEN (null) de `false` doner ve bu
     * sayfa bunu dogrudan "Access Restricted" olarak gosteriyordu:
     * yetkili kullanici, izinler gelene kadar YANLIS bir ret ekrani
     * goruyordu. Ucuncu durum gerekli — "henuz bilmiyoruz".
     */
    const permissionsLoaded = Array.isArray(permissions)

    // ── Filter State ──────────────────────────────────────────────────────────
    const [dateRange, setDateRange] = useState([
        dayjs().startOf('month'),
        dayjs().endOf('month')
    ])
    const [selectedUsers, setSelectedUsers] = useState([])
    const [selectedCustomers, setSelectedCustomers] = useState([])
    const [selectedProjects, setSelectedProjects] = useState([])
    const [selectedTypes, setSelectedTypes] = useState([])
    const [selectedPlatforms, setSelectedPlatforms] = useState([])

    // ── Dropdown Data ─────────────────────────────────────────────────────────
    const { data: usersData } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.getUsers(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const users = useMemo(() => (usersData?.data || []).sort((a, b) =>
        (a.full_name || '').localeCompare(b.full_name || '', 'en')
    ), [usersData])

    const { data: customersData } = useQuery({
        queryKey: ['customers-list'],
        queryFn: () => customerService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const customers = useMemo(() => {
        const raw = customersData?.data || customersData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [customersData])

    const { data: projectsData } = useQuery({
        queryKey: ['projects-list'],
        queryFn: () => projectService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const projects = useMemo(() => {
        const raw = projectsData?.data || projectsData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [projectsData])

    const { data: workTypesData } = useQuery({
        queryKey: ['work-types-list'],
        queryFn: () => workTypeService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const workTypes = useMemo(() => {
        const raw = workTypesData?.data || workTypesData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [workTypesData])

    const { data: platformsData } = useQuery({
        queryKey: ['platforms-list'],
        queryFn: () => platformService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const platforms = useMemo(() => {
        const raw = platformsData?.data || platformsData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [platformsData])

    // ── Access Control ────────────────────────────────────────────────────────
    if (!permissionsLoaded) {
        // Izinler bilinmiyor: NE rapor NE ret gosterilir.
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <Spin />
            </div>
        )
    }

    if (!canViewReports) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Access Restricted</div>
    }

    const hasActiveFilters = selectedUsers.length > 0 || selectedCustomers.length > 0 ||
        selectedProjects.length > 0 || selectedTypes.length > 0 || selectedPlatforms.length > 0

    const handleClearAll = () => {
        setDateRange([dayjs().startOf('month'), dayjs().endOf('month')])
        setSelectedUsers([])
        setSelectedCustomers([])
        setSelectedProjects([])
        setSelectedTypes([])
        setSelectedPlatforms([])
    }

    return (
        <div className="reports-page fade-in" style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>

            {/* ── Page Header ──────────────────────────────────────────────── */}
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1>Reports &amp; Analytics</h1>
                    <p>Real-time dashboard · Filter by date, user, customer, project or type</p>
                </div>
                {hasActiveFilters && (
                    <Button
                        icon={<CloseCircleOutlined />}
                        onClick={handleClearAll}
                        style={{ marginTop: 4 }}
                    >
                        Clear Filters
                    </Button>
                )}
            </div>

            {/* ── Tempo Filter Bar ─────────────────────────────────────────── */}
            <div style={{
                marginBottom: 24,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)',
                padding: '20px 24px'
            }}>
                {/* Row 1: Date Range + Users + Customers */}
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>

                    {/* Date Range */}
                    <FilterBlock label="Date Range" icon={<CalendarOutlined />}>
                        <RangePicker
                            value={dateRange}
                            onChange={setDateRange}
                            allowClear={false}
                            style={{ width: 260 }}
                            format="DD MMM YYYY"
                        />
                    </FilterBlock>

                    {/* Users */}
                    <FilterBlock label="Users" count={selectedUsers.length}>
                        <Select
                            mode="multiple"
                            placeholder="All users"
                            value={selectedUsers}
                            onChange={setSelectedUsers}
                            options={users.map(u => ({ value: u.id, label: u.full_name || u.email }))}
                            allowClear
                            showSearch
                            filterOption={(i, o) => (o?.label ?? '').toLowerCase().includes(i.toLowerCase())}
                            maxTagCount={2}
                            style={{ minWidth: 260, width: 280 }}
                        />
                    </FilterBlock>

                    {/* Customers */}
                    <FilterBlock label="Customers" count={selectedCustomers.length}>
                        <Select
                            mode="multiple"
                            placeholder="All customers"
                            value={selectedCustomers}
                            onChange={setSelectedCustomers}
                            options={customers.map(c => ({ value: c.id, label: c.name }))}
                            allowClear
                            showSearch
                            filterOption={(i, o) => (o?.label ?? '').toLowerCase().includes(i.toLowerCase())}
                            maxTagCount={2}
                            style={{ minWidth: 240, width: 260 }}
                        />
                    </FilterBlock>
                </div>

                {/* Row 2: Projects + Types (+ divider) */}
                <div style={{
                    display: 'flex',
                    gap: 20,
                    flexWrap: 'wrap',
                    alignItems: 'flex-end',
                    paddingTop: 16,
                    borderTop: '1px solid var(--border-subtle)'
                }}>
                    {/* Projects */}
                    <FilterBlock label="Projects" count={selectedProjects.length}>
                        <Select
                            mode="multiple"
                            placeholder="All projects"
                            value={selectedProjects}
                            onChange={setSelectedProjects}
                            options={projects.map(p => ({ value: p.id, label: p.name }))}
                            allowClear
                            showSearch
                            filterOption={(i, o) => (o?.label ?? '').toLowerCase().includes(i.toLowerCase())}
                            maxTagCount={2}
                            style={{ minWidth: 260, width: 300 }}
                        />
                    </FilterBlock>

                    {/* Types */}
                    <FilterBlock label="Types" count={selectedTypes.length}>
                        <Select
                            mode="multiple"
                            placeholder="All types"
                            value={selectedTypes}
                            onChange={setSelectedTypes}
                            options={workTypes.map(t => ({ value: t.id, label: t.name }))}
                            allowClear
                            showSearch
                            filterOption={(i, o) => (o?.label ?? '').toLowerCase().includes(i.toLowerCase())}
                            maxTagCount={3}
                            style={{ minWidth: 200, width: 240 }}
                        />
                    </FilterBlock>

                    {/* Platforms */}
                    <FilterBlock label="Platforms" count={selectedPlatforms.length}>
                        <Select
                            mode="multiple"
                            placeholder="All platforms"
                            value={selectedPlatforms}
                            onChange={setSelectedPlatforms}
                            options={platforms.map(p => ({ value: p.id, label: p.name }))}
                            allowClear
                            showSearch
                            filterOption={(i, o) => (o?.label ?? '').toLowerCase().includes(i.toLowerCase())}
                            maxTagCount={3}
                            style={{ minWidth: 200, width: 240 }}
                        />
                    </FilterBlock>
                </div>
            </div>

            {/* ── Main Dashboard ────────────────────────────────────────────── */}
            <MainDashboard
                dateRange={dateRange}
                selectedUsers={selectedUsers}
                selectedCustomers={selectedCustomers}
                selectedProjects={selectedProjects}
                selectedTypes={selectedTypes}
                selectedPlatforms={selectedPlatforms}
            />
        </div>
    )
}

// =============================================================================
// FilterBlock
// =============================================================================

function FilterBlock({ label, icon, count, children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 5
            }}>
                {icon && <span style={{ opacity: 0.7 }}>{icon}</span>}
                {label}
                {count > 0 && (
                    <span style={{
                        background: 'var(--Blue400)',
                        color: 'var(--c-text-strong)',
                        borderRadius: 10,
                        padding: '1px 7px',
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: '16px'
                    }}>
                        {count}
                    </span>
                )}
            </div>
            {children}
        </div>
    )
}

// =============================================================================
// MainDashboard
// =============================================================================

function MainDashboard({ dateRange, selectedUsers, selectedCustomers, selectedProjects, selectedTypes, selectedPlatforms }) {
    const startDate = dateRange?.[0]?.format('YYYY-MM-DD')
    const endDate = dateRange?.[1]?.format('YYYY-MM-DD')

    const queryKey = [
        'tempo-logs', startDate, endDate,
        selectedUsers, selectedCustomers, selectedProjects, selectedTypes, selectedPlatforms
    ]

    const {
        data: jsonResponse, isLoading, isFetching, isError, error, refetch,
    } = useQuery({
        queryKey,
        queryFn: () => reportsService.getJsonUserLogs({
            start_date: startDate,
            end_date: endDate,
            user_ids: selectedUsers,
            customer_ids: selectedCustomers,
            project_ids: selectedProjects,
            work_type_ids: selectedTypes,
            platform_ids: selectedPlatforms
        }),
        enabled: !!startDate && !!endDate,
        /*
         * TanStack Query v5'te `keepPreviousData` KALDIRILDI; buradaki
         * `keepPreviousData: true` sessizce yok sayiliyordu, yani her
         * filtre degisiminde tablo bosaliyor ve yeniden doluyordu.
         * v5 karsiligi `placeholderData`dir.
         *
         * Yaris konusunda ek onleme gerek YOK: filtreler query key'in
         * PARCASI oldugu icin her kombinasyon kendi cache girdisine
         * yazar; gecikmis bir yanit yeni secimin sonucunu EZEMEZ.
         */
        placeholderData: keepPreviousData,
    })

    /**
     * Satir anahtari VERIDEN turetilir. Eskiden `rowKey={(r, i) => ...}`
     * kullaniliyordu; AntD 5.x'te `rowKey`in `index` parametresi
     * DEPRECATED (siralama/filtreleme sonrasi ayni index farkli satiri
     * gosterebilir). Bu uc kayit `id` DONDURMUYOR, bu yuzden anahtar
     * satirin kendi alanlarindan uretilir; birebir ayni iki kayit varsa
     * deterministik bir sayac ile ayrilir.
     */
    const logs = useMemo(() => {
        const raw = jsonResponse?.data || []
        const seen = new Map()
        return raw.map((row) => {
            const base = [
                row.date, row.user_name, row.customer_name, row.project_name,
                row.work_type, row.activity_type, row.platform_name,
                row.duration, row.description,
            ].join('|')
            const n = (seen.get(base) || 0) + 1
            seen.set(base, n)
            return { ...row, _rowKey: n === 1 ? base : `${base}#${n}` }
        })
    }, [jsonResponse])
    const totalHours = useMemo(() => logs.reduce((sum, l) => sum + (l.duration || 0), 0), [logs])
    const entryCount = logs.length

    const exportMutation = useMutation({
        /*
         * Indirilen dosyanin filtresi ile EKRANDAKI filtre ayni kaynaktan
         * gelir: asagidaki parametreler tablonun `queryKey`iyle birebir
         * ayni degerleri kullanir.
         */
        mutationFn: () => reportsService.exportExcel({
            start_date: startDate,
            end_date: endDate,
            user_ids: selectedUsers,
            customer_ids: selectedCustomers,
            project_ids: selectedProjects,
            work_type_ids: selectedTypes,
            platform_ids: selectedPlatforms
        }),
        // Dosya gercekten uretildikten SONRA konusuruz: eskiden
        // "export started" deniyordu, oysa mutation cozüldügunde
        // indirme ya olmustu ya da olmamisti.
        onSuccess: (result) => {
            message.success(`Downloaded ${result?.filename || 'report'}`)
        },
        onError: (err) => {
            /*
             * Basarisiz indirme BASARI gibi gosterilmez.
             *
             * Indirme yardimcisi, sunucunun JSON hata govdesindeki
             * aciklamayi (orn. "Report window too large.") YEREL bir
             * Error olarak firlatir — HTTP yaniti tasimaz. Bu yuzden
             * dogrudan `normalizeApiError`e verilirse "sunucuya
             * ulasilamiyor" diye siniflanip domain mesaji KAYBOLUR.
             * Yardimci zaten teknik govdeyi disarida birakiyor, bu
             * yuzden onun mesaji guvenle gosterilebilir.
             */
            const local = err?.isDownloadError && err?.message
            message.error(local || normalizeApiError(err).message)
        },
    })
    const exportLoading = exportMutation.isPending
    const exportCsv = () => {
        // Cift tetikleme kilidi KAYNAKTA: butonun `disabled` olmasi bir
        // render GEC geldigi icin arada ikinci indirme baslayabiliyordu.
        if (exportLoading) return
        exportMutation.mutate()
    }

    const columns = [
        {
            title: 'Date',
            dataIndex: 'date',
            width: 130,
            sorter: (a, b) => (a.date || '').localeCompare(b.date || ''),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: d => (
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 13 }}>
                    {dayjs(d).format('DD MMM YYYY')}
                </span>
            )
        },
        {
            title: 'User',
            dataIndex: 'user_name',
            width: 160,
            sorter: (a, b) => (a.user_name || '').localeCompare(b.user_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: u => <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{u}</span>
        },
        {
            title: 'Customer',
            dataIndex: 'customer_name',
            width: 180,
            sorter: (a, b) => (a.customer_name || '').localeCompare(b.customer_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: c => <span style={{ color: 'var(--text-primary)' }}>{c}</span>
        },
        {
            title: 'Project',
            dataIndex: 'project_name',
            width: 200,
            sorter: (a, b) => (a.project_name || '').localeCompare(b.project_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: p => <span style={{ color: 'var(--text-primary)' }}>{p}</span>
        },
        {
            title: 'Type',
            dataIndex: 'work_type',
            width: 140,
            sorter: (a, b) => (a.work_type || '').localeCompare(b.work_type || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: t => (
                <Tag style={{
                    background: 'rgba(87,157,255,0.15)',
                    border: '1px solid rgba(87,157,255,0.25)',
                    color: 'var(--Blue400)',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600
                }}>
                    {t}
                </Tag>
            )
        },
        {
            title: 'Platform',
            dataIndex: 'platform_name',
            width: 130,
            sorter: (a, b) => (a.platform_name || '').localeCompare(b.platform_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: p => p
                ? <Tag style={{
                    background: 'rgba(160,100,255,0.15)',
                    border: '1px solid rgba(160,100,255,0.25)',
                    color: '#c084fc',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600
                }}>{p}</Tag>
                : <span style={{ color: 'var(--text-muted)' }}>—</span>
        },
        {
            title: 'Description',
            dataIndex: 'description',
            ellipsis: true,
            render: d => <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{d || '—'}</span>
        },
        {
            title: 'Hours',
            dataIndex: 'duration',
            width: 90,
            align: 'right',
            sorter: (a, b) => (a.duration || 0) - (b.duration || 0),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: h => (
                <span style={{ color: 'var(--Green400)', fontWeight: 700, fontFamily: 'monospace' }}>
                    {formatDuration(h || 0)}
                </span>
            )
        }
    ]

    return (
        <div className="fade-in">

            {/* ── KPI Cards ─────────────────────────────────────────────────── */}
            <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
                <Col xs={24} sm={8}>
                    <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <BarChartOutlined style={{ color: 'var(--Green400)', fontSize: 15 }} />
                            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                                Total Hours
                            </span>
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                            {formatDuration(totalHours)}
                        </div>
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <PieChartOutlined style={{ color: 'var(--Blue400)', fontSize: 15 }} />
                            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                                Entries
                            </span>
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                            {entryCount}
                        </div>
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    {/*
                      * Birincil aksiyon `<div onClick>` idi: klavyeyle
                      * ERISILEMIYOR, ekran okuyucuya buton olarak
                      * gorunmuyor ve adi yoktu. Gorsel duzen aynen
                      * korunarak gercek bir butona cevrildi.
                      */}
                    <button
                        type="button"
                        className="stat-card"
                        onClick={exportCsv}
                        disabled={exportLoading}
                        aria-busy={exportLoading}
                        aria-label="Download CSV — exports the current filter view"
                        style={{
                            border: '1px solid var(--Blue500)',
                            font: 'inherit',
                            textAlign: 'left',
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 12,
                            cursor: exportLoading ? 'not-allowed' : 'pointer',
                            borderColor: 'var(--Blue500)',
                            background: 'rgba(56,139,255,0.06)',
                            flexDirection: 'row',
                            height: '100%'
                        }}
                    >
                        {exportLoading
                            ? <Spin size="small" />
                            : <DownloadOutlined style={{ fontSize: 22, color: 'var(--Blue400)' }} />
                        }
                        <div>
                            <div style={{ color: 'var(--Blue400)', fontWeight: 600, fontSize: 14 }}>Download CSV</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>Exports current filter view</div>
                        </div>
                    </button>
                </Col>
            </Row>

            {/* ── Data Table ────────────────────────────────────────────────── */}
            <AdminErrorAlert error={isError ? error : null} onRetry={refetch} />

            <div className="content-card">
                {logs.length === 0 && !isLoading && !isError ? (
                    <div style={{ padding: 60, textAlign: 'center' }}>
                        <Empty
                            description={
                                <span style={{ color: 'var(--text-muted)' }}>No entries match the current filters</span>
                            }
                        />
                    </div>
                ) : (
                    <Table
                        dataSource={logs}
                        columns={columns}
                        rowKey="_rowKey"
                        pagination={{
                            defaultPageSize: 25,
                            showSizeChanger: true,
                            pageSizeOptions: [25, 50, 100],
                            showTotal: (total) => (
                                <span style={{ color: 'var(--text-muted)' }}>{total} entries</span>
                            )
                        }}
                        /*
                         * Ilk yukleme ile arkaplan yenilemesi AYRI: elde
                         * veri varken tablo spinner'in altinda kaybolmaz.
                         */
                        loading={isLoading && logs.length === 0}
                        showSorterTooltip={false}
                        scroll={{ x: 1100, y: 520 }}
                    />
                )}
                <AdminRefreshHint isFetching={isFetching} hasData={logs.length > 0} />
            </div>
        </div>
    )
}

export default ReportsPage
