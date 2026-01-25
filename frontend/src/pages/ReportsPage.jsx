/**
 * =============================================================================
 * HERMES PLATFORM - Reports Page (Interactive Dashboard)
 * =============================================================================
 * Entegre raporlama arayüzü.
 * Modern Dark UI Design.
 * =============================================================================
 */

import { useState, useMemo, useEffect } from 'react'
import {
    Card, DatePicker, Button, Select, Typography, Space,
    Row, Col, Table, message, Segmented, Statistic, Tag, Empty, Spin, ConfigProvider
} from 'antd'
import {
    DownloadOutlined,
    UserOutlined,
    GlobalOutlined,
    AppstoreOutlined,
    CalendarOutlined,
    FileExcelOutlined,
    FilterOutlined,
    PieChartOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import { useQuery, useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { reportsService, authService, customerService } from '../services/api'
import { useAuthStore } from '../stores/authStore'

const { Title, Text } = Typography

function ReportsPage() {
    const { user } = useAuthStore()
    const [viewMode, setViewMode] = useState('User Work Logs') // 'User Work Logs' | 'Global Monthly Export' | 'Customer x User Matrix'

    // Filters
    const [selectedMonth, setSelectedMonth] = useState(dayjs())
    const [selectedUser, setSelectedUser] = useState(null)

    // Data Fetching for Dropdowns
    const { data: usersResponse } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.getUsers(),
        enabled: !!user?.is_admin
    })
    const users = usersResponse?.data || []

    // Access Control
    if (!user?.is_admin) {
        return <div style={{ padding: 40, textAlign: 'center', color: '#fff' }}>Access Restricted</div>
    }

    return (
        <div className="reports-page fade-in" style={{ padding: '24px 40px', maxWidth: 1600, margin: '0 auto', color: '#e5e5e5' }}>

            {/* Header */}
            <div style={{ marginBottom: 40, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <h1 style={{
                        fontSize: '2rem',
                        fontWeight: 700,
                        margin: 0,
                        background: 'linear-gradient(90deg, #fff, #aaa)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        Reports & Analytics
                    </h1>
                    <Text style={{ color: '#666', fontSize: '1rem', marginTop: 4, display: 'block' }}>
                        Real-time dashboard and data exports
                    </Text>
                </div>
            </div>

            {/* Controls Bar */}
            <div style={{
                marginBottom: 32,
                background: 'rgba(20, 20, 20, 0.7)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 16,
                padding: '24px'
            }}>
                <Row gutter={[24, 24]} align="middle">
                    <Col xs={24} xl={9}>
                        <div style={{ marginBottom: 8, color: '#666', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Report Type</div>
                        <Segmented
                            options={[
                                { label: 'User Logs', value: 'User Work Logs', icon: <UserOutlined /> },
                                { label: 'Global Export', value: 'Global Monthly Export', icon: <GlobalOutlined /> },
                                { label: 'Matrix', value: 'Customer x User Matrix', icon: <AppstoreOutlined /> }
                            ]}
                            value={viewMode}
                            onChange={setViewMode}
                            block
                            size="large"
                            className="modern-segmented"
                        />
                    </Col>

                    <Col xs={24} xl={15}>
                        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            {/* Common Month Picker */}
                            <div style={{ flex: 1, minWidth: 200 }}>
                                <div style={{ marginBottom: 8, color: '#666', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Analysis Period</div>
                                <DatePicker
                                    picker="month"
                                    value={selectedMonth}
                                    onChange={setSelectedMonth}
                                    format="MMMM YYYY"
                                    allowClear={false}
                                    style={{ width: '100%', height: 40 }}
                                    className="modern-picker"
                                />
                            </div>

                            {/* User Selector (Only for User Work Logs) */}
                            {viewMode === 'User Work Logs' && (
                                <div style={{ flex: 1, minWidth: 200 }}>
                                    <div style={{ marginBottom: 8, color: '#666', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>User Filter</div>
                                    <Select
                                        placeholder="Select User"
                                        value={selectedUser}
                                        onChange={setSelectedUser}
                                        options={users.map(u => ({ value: u.id, label: u.full_name }))}
                                        allowClear
                                        style={{ width: '100%', height: 40 }}
                                        showSearch
                                        filterOption={(input, option) =>
                                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                        }
                                        className="modern-select"
                                    />
                                </div>
                            )}
                        </div>
                    </Col>
                </Row>
            </div>

            {/* Dashboard Content */}
            <div style={{ minHeight: 400 }}>
                {viewMode === 'User Work Logs' && (
                    <UserLogsDashboard
                        selectedMonth={selectedMonth}
                        selectedUser={selectedUser}
                    />
                )}

                {viewMode === 'Global Monthly Export' && (
                    <GlobalLogsDashboard
                        selectedMonth={selectedMonth}
                    />
                )}

                {viewMode === 'Customer x User Matrix' && (
                    <MatrixDashboard
                        selectedMonth={selectedMonth}
                    />
                )}
            </div>

            {/* Global Styles for AntD Overrides */}
            <style>{`
                .modern-segmented {
                    background: #000;
                    padding: 4px;
                    border: 1px solid #333;
                }
                .ant-segmented-item-selected {
                    background-color: #333 !important;
                    color: white !important;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important;
                }
                .ant-segmented-item {
                    color: #888;
                    font-weight: 500;
                }
                .ant-segmented-item:hover {
                    color: #fff;
                }
                
                /* Modern Table */
                .dashboard-table .ant-table {
                    background: transparent;
                    color: #ccc;
                }
                .dashboard-table .ant-table-thead > tr > th {
                    background: #111;
                    color: #666;
                    border-bottom: 1px solid #303030;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                .dashboard-table .ant-table-tbody > tr > td {
                    border-bottom: 1px solid #222;
                    padding: 16px;
                }
                .dashboard-table .ant-table-tbody > tr:hover > td {
                    background: rgba(255, 255, 255, 0.03) !important;
                }

                /* Modern Card */
                .sum-card {
                    background: #111;
                    border: 1px solid #262626;
                    border-radius: 16px;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    justify-content: center;
                    height: 100%;
                    transition: transform 0.2s, border-color 0.2s;
                }
                .sum-card:hover {
                    border-color: #444;
                    transform: translateY(-2px);
                }
                .sum-card-icon {
                   width: 40px; height: 40px; 
                   border-radius: 10px; 
                   display: flex; alignItems: center; justifyContent: center;
                   margin-bottom: 16px;
                   font-size: 18px;
                }
                
                /* Force Statistic Title Color */
                .sum-card .ant-statistic-title {
                    color: #e5e5e5 !important;
                    font-size: 13px;
                    opacity: 0.8;
                }

                /* Inputs */
                 .modern-picker, .modern-select .ant-select-selector {
                    background-color: #111 !important;
                    border-color: #333 !important;
                    color: #e5e5e5 !important;
                    border-radius: 8px !important;
                }
                .modern-picker:hover, .modern-select:hover .ant-select-selector {
                    border-color: #555 !important;
                }
                .ant-picker-input > input, .ant-select-selection-item {
                    color: #e5e5e5 !important;
                }
                .ant-select-arrow, .ant-picker-suffix {
                    color: #555 !important;
                }
            `}</style>
        </div>
    )
}

// =============================================================================
// SUB-COMPONENTS (Dashboards)
// =============================================================================

function UserLogsDashboard({ selectedMonth, selectedUser }) {
    const { data: jsonResponse, isLoading } = useQuery({
        queryKey: ['json-user-logs', selectedMonth.format('YYYY-MM'), selectedUser],
        queryFn: () => reportsService.getJsonUserLogs({
            start_date: selectedMonth.startOf('month').format('YYYY-MM-DD'),
            end_date: selectedMonth.endOf('month').format('YYYY-MM-DD'),
            user_id: selectedUser
        }),
        enabled: !!selectedMonth
    })

    const logs = jsonResponse?.data || []

    // Calculate Stats
    const totalHours = useMemo(() => logs.reduce((sum, log) => sum + log.duration, 0), [logs])
    const projectCount = useMemo(() => new Set(logs.map(l => l.project_name)).size, [logs])

    // Export Handler
    const { mutate: exportCsv, isPending: exportLoading } = useMutation({
        mutationFn: () => reportsService.exportExcel({
            start_date: selectedMonth.startOf('month').format('YYYY-MM-DD'),
            end_date: selectedMonth.endOf('month').format('YYYY-MM-DD'),
            user_id: selectedUser
        }),
        onSuccess: () => message.success('Export started'),
        onError: () => message.error('Export failed')
    })

    const columns = [
        { title: 'Date', dataIndex: 'date', width: 120, render: d => dayjs(d).format('DD MMM YYYY') },
        { title: 'User', dataIndex: 'user_name', width: 150 },
        { title: 'Customer', dataIndex: 'customer_name', width: 180 },
        { title: 'Project', dataIndex: 'project_name', width: 180 },
        { title: 'Type', dataIndex: 'work_type', width: 120, render: t => <Tag color="blue" style={{ borderRadius: 12 }}>{t}</Tag> },
        { title: 'Description', dataIndex: 'description', ellipsis: true },
        { title: 'Hours', dataIndex: 'duration', width: 100, align: 'right', render: h => <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{h.toFixed(2)}</span> }
    ]

    return (
        <div className="fade-in">
            {/* Stats Row */}
            <Row gutter={[20, 20]} style={{ marginBottom: 32 }}>
                <Col xs={24} sm={8}>
                    <div className="sum-card">
                        <div className="sum-card-icon" style={{ background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80' }}><BarChartOutlined /></div>
                        <Statistic title="Total Hours" value={totalHours} precision={2} valueStyle={{ color: '#fff', fontSize: '2rem', fontWeight: 600 }} titleStyle={{ color: '#e5e5e5' }} suffix={<span style={{ fontSize: 14, color: '#888' }}>hours</span>} />
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    <div className="sum-card">
                        <div className="sum-card-icon" style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#fff' }}><PieChartOutlined /></div>
                        <Statistic title="Entries" value={logs.length} valueStyle={{ color: '#fff', fontSize: '2rem', fontWeight: 600 }} titleStyle={{ color: '#e5e5e5' }} />
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    {/* Export Action Card */}
                    <div className="sum-card" style={{ borderColor: '#3b82f6', background: 'rgba(59, 130, 246, 0.05)', cursor: 'pointer', alignItems: 'center' }} onClick={() => exportCsv()}>
                        <div style={{ textAlign: 'center' }}>
                            {exportLoading ? <Spin /> : <DownloadOutlined style={{ fontSize: 32, color: '#3b82f6', marginBottom: 12 }} />}
                            <div style={{ color: '#3b82f6', fontWeight: 600, fontSize: 16 }}>Download CSV Report</div>
                            <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>Excel Compatible Format</div>
                        </div>
                    </div>
                </Col>
            </Row>

            <Card styles={{ body: { padding: 0 } }} style={{ background: '#111', border: '1px solid #303030', overflow: 'hidden', borderRadius: 16 }}>
                <Table
                    className="dashboard-table"
                    dataSource={logs}
                    columns={columns}
                    rowKey={(r) => `${r.date}-${r.user_name}-${r.project_name}` + Math.random()}
                    pagination={{ pageSize: 20 }}
                    loading={isLoading}
                    scroll={{ y: 500 }}
                />
            </Card>
        </div>
    )
}

function GlobalLogsDashboard({ selectedMonth }) {
    const { data: jsonResponse, isLoading } = useQuery({
        queryKey: ['json-global', selectedMonth.format('YYYY-MM')],
        queryFn: () => reportsService.getJsonGlobalDetailed(selectedMonth.format('YYYY-MM')),
        enabled: !!selectedMonth
    })

    const logs = jsonResponse?.data || []

    const totalHours = useMemo(() => logs.reduce((sum, log) => sum + log.duration, 0), [logs])
    const activeUsers = useMemo(() => new Set(logs.map(l => l.user_name)).size, [logs])

    const { mutate: exportCsv, isPending: exportLoading } = useMutation({
        mutationFn: () => reportsService.exportGlobalDetailed(selectedMonth.format('YYYY-MM')),
        onSuccess: () => message.success('Export started'),
        onError: () => message.error('Export failed')
    })

    const columns = [
        { title: 'Date', dataIndex: 'date', width: 120, render: d => dayjs(d).format('DD MMM') },
        { title: 'User', dataIndex: 'user_name', width: 150 },
        { title: 'Customer', dataIndex: 'customer_name', width: 150 },
        { title: 'Project', dataIndex: 'project_name', width: 150 },
        { title: 'Platform', dataIndex: 'platform', width: 100 },
        { title: 'Description', dataIndex: 'description', ellipsis: true },
        { title: 'Hours', dataIndex: 'duration', width: 80, align: 'right', render: h => <span style={{ color: '#4ade80' }}>{h.toFixed(2)}</span> }
    ]

    return (
        <div className="fade-in">
            <Row gutter={[20, 20]} style={{ marginBottom: 32 }}>
                <Col xs={24} md={8}>
                    <div className="sum-card">
                        <div className="sum-card-icon" style={{ background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80' }}><GlobalOutlined /></div>
                        <Statistic title="Total Organization Hours" value={totalHours} precision={2} valueStyle={{ color: '#fff', fontSize: '2rem', fontWeight: 600 }} titleStyle={{ color: '#e5e5e5' }} suffix={<span style={{ fontSize: 14, color: '#888' }}>hours</span>} />
                    </div>
                </Col>
                <Col xs={24} md={8}>
                    <div className="sum-card">
                        <div className="sum-card-icon" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}><UserOutlined /></div>
                        <Statistic title="Active Users" value={activeUsers} valueStyle={{ color: '#fff', fontSize: '2rem', fontWeight: 600 }} titleStyle={{ color: '#e5e5e5' }} />
                    </div>
                </Col>
                <Col xs={24} md={8}>
                    <div className="sum-card" style={{ borderColor: '#3b82f6', background: 'rgba(59, 130, 246, 0.05)', cursor: 'pointer', alignItems: 'center' }} onClick={() => exportCsv()}>
                        <div style={{ textAlign: 'center' }}>
                            {exportLoading ? <Spin /> : <DownloadOutlined style={{ fontSize: 32, color: '#3b82f6', marginBottom: 12 }} />}
                            <div style={{ color: '#3b82f6', fontWeight: 600, fontSize: 16 }}>Download Global Report</div>
                        </div>
                    </div>
                </Col>
            </Row>

            <Card styles={{ body: { padding: 0 } }} style={{ background: '#111', border: '1px solid #303030', overflow: 'hidden', borderRadius: 16 }}>
                <Table
                    className="dashboard-table"
                    dataSource={logs}
                    columns={columns}
                    rowKey={(r) => `${r.date}-${r.user_name}-${r.project_name}` + Math.random()}
                    pagination={{ pageSize: 20 }}
                    loading={isLoading}
                    scroll={{ y: 500 }}
                />
            </Card>
        </div>
    )
}

function MatrixDashboard({ selectedMonth }) {
    const { data: jsonResponse, isLoading } = useQuery({
        queryKey: ['json-matrix', selectedMonth.format('YYYY-MM')],
        queryFn: () => reportsService.getJsonMatrix(
            selectedMonth.startOf('month').format('YYYY-MM-DD'),
            selectedMonth.endOf('month').format('YYYY-MM-DD')
        ),
        enabled: !!selectedMonth
    })

    const rawData = jsonResponse?.data || []

    const { columns, dataSource, totalHours } = useMemo(() => {
        if (!rawData.length) return { columns: [], dataSource: [], totalHours: 0 }

        const users = Array.from(new Set(rawData.map(r => r.user_name))).sort()

        // Build Data Source Map
        const dataMap = {}
        let total = 0

        rawData.forEach(r => {
            if (!dataMap[r.customer_name]) dataMap[r.customer_name] = { key: r.customer_name, customer: r.customer_name }
            dataMap[r.customer_name][r.user_name] = (dataMap[r.customer_name][r.user_name] || 0) + r.total_hours

            // Fix total sum to be simpler
            total += r.total_hours
        })

        const dataSource = Object.values(dataMap)

        const cols = [
            {
                title: 'CUSTOMER',
                dataIndex: 'customer',
                key: 'customer',
                fixed: 'left',
                width: 250,
                render: t => <span style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{t}</span>
            },
            ...users.map(u => ({
                title: u.toUpperCase(),
                dataIndex: u,
                key: u,
                width: 140,
                align: 'center',
                render: (val) => val ? <span style={{ color: '#4ade80', fontWeight: 500 }}>{val.toFixed(2)}</span> : <span style={{ color: '#333' }}>-</span>
            })),
            {
                title: 'TOTAL',
                key: 'row_total',
                width: 100,
                fixed: 'right',
                align: 'right',
                render: (_, record) => {
                    const rowSum = users.reduce((acc, u) => acc + (record[u] || 0), 0)
                    return <span style={{ fontWeight: 'bold', color: '#fff' }}>{rowSum.toFixed(2)}</span>
                }
            }
        ]

        return { columns: cols, dataSource, totalHours: total }
    }, [rawData])

    const { mutate: exportCsv, isPending: exportLoading } = useMutation({
        mutationFn: () => reportsService.exportGlobalMatrix(
            selectedMonth.startOf('month').format('YYYY-MM-DD'),
            selectedMonth.endOf('month').format('YYYY-MM-DD')
        ),
        onSuccess: () => message.success('Export started'),
        onError: () => message.error('Export failed')
    })

    return (
        <div className="fade-in">
            <Row gutter={[20, 20]} style={{ marginBottom: 32 }}>
                <Col xs={24} md={16}>
                    <div className="sum-card" style={{ flexDirection: 'row', justifyContent: 'space-between', padding: '24px 40px', alignItems: 'center' }}>
                        <div>
                            <div style={{ color: '#888', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase', fontSize: 11, fontWeight: 700 }}>Total Matrix Hours</div>
                            <div style={{ color: '#4ade80', fontSize: '2.5rem', fontWeight: 600 }}>{totalHours.toFixed(2)}<span style={{ fontSize: 16, color: '#666', marginLeft: 8 }}>h</span></div>
                        </div>
                        <div style={{ borderLeft: '1px solid #333', height: 40, margin: '0 30px' }}></div>
                        <div style={{ display: 'flex', gap: 40 }}>
                            <Statistic title="Customers" value={dataSource.length} valueStyle={{ color: '#fff' }} titleStyle={{ color: '#e5e5e5' }} prefix={<AppstoreOutlined />} />
                            <Statistic title="Users Involved" value={columns.length - 2} valueStyle={{ color: '#fff' }} titleStyle={{ color: '#e5e5e5' }} prefix={<UserOutlined />} />
                        </div>
                    </div>
                </Col>
                <Col xs={24} md={8}>
                    <div className="sum-card" style={{ borderColor: '#3b82f6', background: 'rgba(59, 130, 246, 0.05)', cursor: 'pointer', alignItems: 'center' }} onClick={() => exportCsv()}>
                        <div style={{ textAlign: 'center' }}>
                            {exportLoading ? <Spin /> : <AppstoreOutlined style={{ fontSize: 32, color: '#3b82f6', marginBottom: 12 }} />}
                            <div style={{ color: '#3b82f6', fontWeight: 600, fontSize: 16 }}>Download Matrix CSV</div>
                            <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>Pivot Export</div>
                        </div>
                    </div>
                </Col>
            </Row>

            <Card styles={{ body: { padding: 0 } }} style={{ background: '#111', border: '1px solid #303030', overflow: 'hidden', borderRadius: 16 }}>
                {dataSource.length > 0 ? (
                    <Table
                        className="dashboard-table"
                        dataSource={dataSource}
                        columns={columns}
                        rowKey="key"
                        pagination={false}
                        loading={isLoading}
                        scroll={{ x: 'max-content', y: 600 }}
                    />
                ) : (
                    <div style={{ padding: 60, textAlign: 'center' }}>
                        {isLoading ? <Spin /> : <Empty description={<span style={{ color: '#666' }}>No data found for this period</span>} />}
                    </div>
                )}
            </Card>
        </div>
    )
}

export default ReportsPage
