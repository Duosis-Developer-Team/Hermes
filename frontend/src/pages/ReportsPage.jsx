/**
 * =============================================================================
 * HERMES PLATFORM - Reports & Analytics (Tempo-Style Unified Dashboard)
 * =============================================================================
 * JIRA Tempo mantığında dinamik filtre çubuğu ve reaktif tablo.
 * Tek bir unified görünüm: Date Range, Users, Customers, Projects, Types.
 * =============================================================================
 */

import { useState, useMemo, useCallback, useRef } from 'react'
import {
    DatePicker, Button, Select, Typography, Space,
    Row, Col, Table, message, Statistic, Tag, Empty, Spin
} from 'antd'
import {
    DownloadOutlined,
    BarChartOutlined,
    PieChartOutlined,
    FilterOutlined,
    CloseCircleOutlined,
    CalendarOutlined
} from '@ant-design/icons'
import { useQuery, useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
    reportsService,
    authService,
    customerService,
    projectService,
    workTypeService
} from '../services/api'
import { useAuthStore } from '../stores/authStore'

const { Text } = Typography
const { RangePicker } = DatePicker

// =============================================================================
// Helpers
// =============================================================================

const buildMultiParam = (urlParams, key, arr) => {
    if (Array.isArray(arr) && arr.length > 0) {
        arr.forEach(id => urlParams.append(key, id))
    }
}

// =============================================================================
// Main Component
// =============================================================================

function ReportsPage() {
    const { user } = useAuthStore()

    // ── Filter State ──────────────────────────────────────────────────────────
    const [dateRange, setDateRange] = useState([
        dayjs().startOf('month'),
        dayjs().endOf('month')
    ])
    const [selectedUsers, setSelectedUsers] = useState([])
    const [selectedCustomers, setSelectedCustomers] = useState([])
    const [selectedProjects, setSelectedProjects] = useState([])
    const [selectedTypes, setSelectedTypes] = useState([])

    // ── Dropdown Data ─────────────────────────────────────────────────────────
    const { data: usersData } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.getUsers(),
        enabled: !!user?.is_admin,
        staleTime: 5 * 60 * 1000
    })
    const users = useMemo(() => (usersData?.data || []).sort((a, b) =>
        (a.full_name || '').localeCompare(b.full_name || '', 'tr')
    ), [usersData])

    const { data: customersData } = useQuery({
        queryKey: ['customers-list'],
        queryFn: () => customerService.getAll(),
        enabled: !!user?.is_admin,
        staleTime: 5 * 60 * 1000
    })
    const customers = useMemo(() => {
        const raw = customersData?.data || customersData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'tr')) : []
    }, [customersData])

    const { data: projectsData } = useQuery({
        queryKey: ['projects-list'],
        queryFn: () => projectService.getAll(),
        enabled: !!user?.is_admin,
        staleTime: 5 * 60 * 1000
    })
    const projects = useMemo(() => {
        const raw = projectsData?.data || projectsData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'tr')) : []
    }, [projectsData])

    const { data: workTypesData } = useQuery({
        queryKey: ['work-types-list'],
        queryFn: () => workTypeService.getAll(),
        enabled: !!user?.is_admin,
        staleTime: 5 * 60 * 1000
    })
    const workTypes = useMemo(() => {
        const raw = workTypesData?.data || workTypesData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'tr')) : []
    }, [workTypesData])

    // ── Access Control ────────────────────────────────────────────────────────
    if (!user?.is_admin) {
        return <div style={{ padding: 40, textAlign: 'center', color: '#fff' }}>Access Restricted</div>
    }

    // ── Clear All Filters ─────────────────────────────────────────────────────
    const handleClearAll = () => {
        setDateRange([dayjs().startOf('month'), dayjs().endOf('month')])
        setSelectedUsers([])
        setSelectedCustomers([])
        setSelectedProjects([])
        setSelectedTypes([])
    }

    const hasActiveFilters = selectedUsers.length > 0 || selectedCustomers.length > 0 ||
        selectedProjects.length > 0 || selectedTypes.length > 0

    return (
        <div className="reports-page fade-in" style={{ padding: '24px 40px', maxWidth: 1600, margin: '0 auto', color: '#e5e5e5' }}>

            {/* ── Page Header ──────────────────────────────────────────────── */}
            <div style={{
                marginBottom: 32,
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                paddingBottom: 20,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end'
            }}>
                <div>
                    <h1 style={{
                        fontSize: '2rem',
                        fontWeight: 700,
                        margin: 0,
                        background: 'linear-gradient(90deg, #fff, #aaa)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        Reports &amp; Analytics
                    </h1>
                    <Text style={{ color: '#555', fontSize: '0.95rem', marginTop: 4, display: 'block' }}>
                        Real-time dashboard · Filter by date, user, customer, project or type
                    </Text>
                </div>

                {hasActiveFilters && (
                    <Button
                        icon={<CloseCircleOutlined />}
                        onClick={handleClearAll}
                        style={{ background: 'transparent', border: '1px solid #444', color: '#aaa' }}
                    >
                        Clear All Filters
                    </Button>
                )}
            </div>

            {/* ── Tempo Filter Bar ─────────────────────────────────────────── */}
            <div style={{
                marginBottom: 28,
                background: 'rgba(15, 15, 15, 0.85)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 16,
                padding: '20px 24px'
            }}>
                <div style={{
                    display: 'flex',
                    gap: 16,
                    flexWrap: 'wrap',
                    alignItems: 'flex-start'
                }}>

                    {/* Date Range */}
                    <FilterBlock label="Date Range" icon={<CalendarOutlined />}>
                        <RangePicker
                            value={dateRange}
                            onChange={setDateRange}
                            allowClear={false}
                            style={{ width: 260, height: 38 }}
                            className="modern-picker"
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
                            maxTagCount="responsive"
                            style={{ minWidth: 200, width: 220 }}
                            className="modern-select"
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
                            maxTagCount="responsive"
                            style={{ minWidth: 200, width: 220 }}
                            className="modern-select"
                        />
                    </FilterBlock>

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
                            maxTagCount="responsive"
                            style={{ minWidth: 200, width: 220 }}
                            className="modern-select"
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
                            maxTagCount="responsive"
                            style={{ minWidth: 180, width: 200 }}
                            className="modern-select"
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
            />

            {/* ── AntD Dark Overrides ───────────────────────────────────────── */}
            <style>{`
                /* Table */
                .dashboard-table .ant-table { background: transparent; color: #ccc; }
                .dashboard-table .ant-table-thead > tr > th {
                    background: #0d0d0d; color: #555; border-bottom: 1px solid #252525;
                    font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
                }
                .dashboard-table .ant-table-tbody > tr > td { border-bottom: 1px solid #1c1c1c; padding: 14px 16px; }
                .dashboard-table .ant-table-tbody > tr:hover > td { background: rgba(255,255,255,0.025) !important; }
                .dashboard-table .ant-table-pagination { padding: 12px 16px; }

                /* Summary Cards */
                .sum-card {
                    background: #0f0f0f; border: 1px solid #222; border-radius: 14px;
                    padding: 22px 24px; display: flex; flex-direction: column;
                    align-items: flex-start; height: 100%;
                    transition: border-color 0.2s, transform 0.2s;
                }
                .sum-card:hover { border-color: #383838; transform: translateY(-2px); }
                .sum-card .ant-statistic-title { color: #888 !important; font-size: 12px; margin-bottom: 4px; }
                .sum-card .ant-statistic-content-value { color: #fff !important; font-size: 1.9rem !important; font-weight: 600 !important; }
                .sum-card-icon {
                    width: 38px; height: 38px; border-radius: 10px;
                    display: flex; align-items: center; justify-content: center;
                    margin-bottom: 14px; font-size: 17px;
                }

                /* Filter Bar Inputs */
                .modern-picker, .modern-select .ant-select-selector {
                    background-color: #111 !important; border-color: #2e2e2e !important;
                    color: #e5e5e5 !important; border-radius: 8px !important;
                }
                .modern-picker:hover, .modern-select:hover .ant-select-selector { border-color: #555 !important; }
                .ant-picker-input > input, .ant-select-selection-item, .ant-select-selection-placeholder { color: #ccc !important; }
                .ant-select-arrow, .ant-picker-suffix { color: #444 !important; }
                .ant-picker-range-separator { color: #555 !important; }
                .filter-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #555; margin-bottom: 6px; display: flex; gap: 6px; align-items: center; }
                .filter-badge { background: #3b82f6; color: #fff; border-radius: 10px; padding: 1px 7px; font-size: 10px; font-weight: 700; }

                /* Export Card */
                .export-card {
                    background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.3);
                    border-radius: 14px; padding: 22px 24px; height: 100%;
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    cursor: pointer; transition: background 0.2s, border-color 0.2s, transform 0.2s;
                }
                .export-card:hover { background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.6); transform: translateY(-2px); }
            `}</style>
        </div>
    )
}

// =============================================================================
// FilterBlock — Reusable label + control wrapper
// =============================================================================

function FilterBlock({ label, icon, count, children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="filter-label">
                {icon && <span>{icon}</span>}
                {label}
                {count > 0 && <span className="filter-badge">{count}</span>}
            </div>
            {children}
        </div>
    )
}

// =============================================================================
// MainDashboard — Reactive table + stats
// =============================================================================

function MainDashboard({ dateRange, selectedUsers, selectedCustomers, selectedProjects, selectedTypes }) {
    const startDate = dateRange?.[0]?.format('YYYY-MM-DD')
    const endDate = dateRange?.[1]?.format('YYYY-MM-DD')

    // Query key includes all filters → any change triggers refetch
    const queryKey = [
        'tempo-logs',
        startDate,
        endDate,
        selectedUsers,
        selectedCustomers,
        selectedProjects,
        selectedTypes
    ]

    const { data: jsonResponse, isLoading, isFetching } = useQuery({
        queryKey,
        queryFn: () => reportsService.getJsonUserLogs({
            start_date: startDate,
            end_date: endDate,
            user_ids: selectedUsers,
            customer_ids: selectedCustomers,
            project_ids: selectedProjects,
            work_type_ids: selectedTypes
        }),
        enabled: !!startDate && !!endDate,
        keepPreviousData: true
    })

    const logs = jsonResponse?.data || []

    // Reactive computed stats — always reflect currently visible data
    const totalHours = useMemo(() => logs.reduce((sum, l) => sum + (l.duration || 0), 0), [logs])
    const entryCount = logs.length

    // Export handler — passes exact same filters
    const { mutate: exportCsv, isPending: exportLoading } = useMutation({
        mutationFn: () => reportsService.exportExcel({
            start_date: startDate,
            end_date: endDate,
            user_ids: selectedUsers,
            customer_ids: selectedCustomers,
            project_ids: selectedProjects,
            work_type_ids: selectedTypes
        }),
        onSuccess: () => message.success('CSV export started'),
        onError: () => message.error('Export failed')
    })

    const columns = [
        {
            title: 'Date',
            dataIndex: 'date',
            width: 130,
            sorter: (a, b) => a.date?.localeCompare(b.date),
            render: d => (
                <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 13 }}>
                    {dayjs(d).format('DD MMM YYYY')}
                </span>
            )
        },
        {
            title: 'User',
            dataIndex: 'user_name',
            width: 160,
            render: u => <span style={{ color: '#ccc', fontWeight: 500 }}>{u}</span>
        },
        {
            title: 'Customer',
            dataIndex: 'customer_name',
            width: 180,
            render: c => <span style={{ color: '#e5e5e5' }}>{c}</span>
        },
        {
            title: 'Project',
            dataIndex: 'project_name',
            width: 200,
            render: p => <span style={{ color: '#e5e5e5' }}>{p}</span>
        },
        {
            title: 'Type',
            dataIndex: 'work_type',
            width: 140,
            render: t => (
                <Tag style={{
                    background: 'rgba(87,157,255,0.12)',
                    border: '1px solid rgba(87,157,255,0.3)',
                    color: '#579dff',
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 600
                }}>
                    {t}
                </Tag>
            )
        },
        {
            title: 'Description',
            dataIndex: 'description',
            ellipsis: true,
            render: d => <span style={{ color: '#777', fontSize: 13 }}>{d || '—'}</span>
        },
        {
            title: 'Hours',
            dataIndex: 'duration',
            width: 90,
            align: 'right',
            sorter: (a, b) => (a.duration || 0) - (b.duration || 0),
            render: h => (
                <span style={{ color: '#4ade80', fontWeight: 700, fontFamily: 'monospace' }}>
                    {(h || 0).toFixed(2)}
                </span>
            )
        }
    ]

    return (
        <div className="fade-in">

            {/* ── Summary Cards ─────────────────────────────────────────────── */}
            <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
                <Col xs={24} sm={8}>
                    <div className="sum-card">
                        <div className="sum-card-icon" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>
                            <BarChartOutlined />
                        </div>
                        <Statistic
                            title="Total Hours"
                            value={totalHours}
                            precision={2}
                            suffix={<span style={{ fontSize: 13, color: '#555', marginLeft: 4 }}>h</span>}
                        />
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    <div className="sum-card">
                        <div className="sum-card-icon" style={{ background: 'rgba(255,255,255,0.06)', color: '#aaa' }}>
                            <PieChartOutlined />
                        </div>
                        <Statistic
                            title="Entries"
                            value={entryCount}
                        />
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    <div
                        className="export-card"
                        onClick={() => !exportLoading && exportCsv()}
                        title="Download filtered data as CSV"
                    >
                        {exportLoading
                            ? <Spin />
                            : <DownloadOutlined style={{ fontSize: 30, color: '#3b82f6', marginBottom: 10 }} />
                        }
                        <div style={{ color: '#3b82f6', fontWeight: 600, fontSize: 15 }}>Download CSV Report</div>
                        <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>Exports current filter view</div>
                    </div>
                </Col>
            </Row>

            {/* ── Data Table ────────────────────────────────────────────────── */}
            <div style={{
                background: '#0b0b0b',
                border: '1px solid #1e1e1e',
                borderRadius: 16,
                overflow: 'hidden'
            }}>
                {logs.length === 0 && !isLoading ? (
                    <div style={{ padding: 60, textAlign: 'center' }}>
                        <Empty
                            description={
                                <span style={{ color: '#444' }}>No entries match the current filters</span>
                            }
                        />
                    </div>
                ) : (
                    <Table
                        className="dashboard-table"
                        dataSource={logs}
                        columns={columns}
                        rowKey={(r, i) => `${r.date}-${r.user_name}-${r.project_name}-${i}`}
                        pagination={{
                            pageSize: 25,
                            showSizeChanger: true,
                            pageSizeOptions: ['25', '50', '100'],
                            showTotal: (total) => (
                                <span style={{ color: '#555' }}>{total} entries</span>
                            )
                        }}
                        loading={isLoading || isFetching}
                        scroll={{ y: 520 }}
                    />
                )}
            </div>
        </div>
    )
}

export default ReportsPage
