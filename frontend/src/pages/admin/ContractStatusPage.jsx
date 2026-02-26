/**
 * =============================================================================
 * HERMES PLATFORM - Contract Status Page
 * =============================================================================
 * Proje sözleşme sürelerini ve kalan günlerini gösteren dashboard.
 * Veri kaynağı: projectService (proje bazlı contract alanları).
 * Modern Dark UI Design.
 * =============================================================================
 */

import { useState } from 'react'
import { Card, Table, Tag, Typography, Progress, Row, Col, Input } from 'antd'
import { SearchOutlined, ClockCircleOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { projectService } from '../../services/api'
import dayjs from 'dayjs'

const { Text } = Typography

function ContractStatusPage() {
    const [searchText, setSearchText] = useState('')

    // Fetch Projects (include inactive to show all contracts)
    const { data: projects = [], isLoading } = useQuery({
        queryKey: ['projects', { include_inactive: false }],
        queryFn: () => projectService.getAll({ include_inactive: false }),
    })

    // Calculate Status Logic — only projects with contract data
    const processedData = projects.map(p => {
        if (!p.contract_start_date || !p.contract_duration_days) {
            return null
        }

        const startDateRaw = dayjs(p.contract_start_date)
        const startDate = startDateRaw.startOf('day')
        const today = dayjs().startOf('day')

        const daysPassed = today.diff(startDate, 'day')
        const remainingDays = p.contract_duration_days - daysPassed
        const endDate = startDateRaw.add(p.contract_duration_days, 'day')

        const totalDuration = p.contract_duration_days
        const effectiveElapsed = Math.max(0, Math.min(totalDuration, daysPassed))
        let progressPercent = (effectiveElapsed / totalDuration) * 100

        let status = 'safe'
        let color = '#4ade80'

        if (remainingDays < 0) {
            status = 'expired'
            color = '#ef4444'
            progressPercent = 100
        } else if (remainingDays <= 30) {
            status = 'critical'
            color = '#ef4444'
        } else if (remainingDays <= 90) {
            status = 'warning'
            color = '#f59e0b'
        }

        return {
            ...p,
            remainingDays,
            totalDays: p.contract_duration_days,
            endDate: endDate.format('YYYY-MM-DD'),
            status,
            color,
            progressPercent
        }
    }).filter(Boolean)
        .sort((a, b) => (a.remainingDays || 9999) - (b.remainingDays || 9999))

    // Filter by Search (customer name or project name)
    const filteredData = processedData.filter(p =>
        (p.customer_name || '').toLowerCase().includes(searchText.toLowerCase()) ||
        p.name.toLowerCase().includes(searchText.toLowerCase())
    )

    // Columns — Görev 7 sıralaması: Customer, Project, Status, Remaining Time, End Date
    const columns = [
        {
            title: 'CUSTOMER',
            dataIndex: 'customer_name',
            key: 'customer_name',
            width: 200,
            render: (name) => (
                <Text strong style={{ fontSize: '0.95rem', color: '#fff' }}>
                    {name || 'Internal Project'}
                </Text>
            )
        },
        {
            title: 'PROJECT',
            dataIndex: 'name',
            key: 'name',
            width: 200,
            render: (text) => (
                <Text style={{ fontSize: '0.95rem', color: '#ccc' }}>{text}</Text>
            )
        },
        {
            title: 'STATUS',
            key: 'status',
            width: 180,
            render: (_, record) => {
                if (record.status === 'expired') return <Tag color="error" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<WarningOutlined />}>EXPIRED</Tag>
                if (record.status === 'critical') return <Tag color="error" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<WarningOutlined />}>CRITICAL ({record.remainingDays} days)</Tag>
                if (record.status === 'warning') return <Tag color="warning" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<ClockCircleOutlined />}>WARNING ({record.remainingDays} days)</Tag>
                return <Tag color="success" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<CheckCircleOutlined />}>SAFE ({record.remainingDays} days)</Tag>
            }
        },
        {
            title: 'REMAINING TIME',
            key: 'remaining',
            width: 300,
            render: (_, record) => (
                <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ color: '#888', fontSize: 11 }}>
                            {record.remainingDays < 0
                                ? `${Math.abs(record.remainingDays)} days overdue`
                                : `${record.remainingDays} / ${record.totalDays} days left`}
                        </span>
                    </div>
                    <Progress
                        percent={record.progressPercent}
                        showInfo={false}
                        strokeColor={record.color}
                        trailColor="rgba(255,255,255,0.1)"
                        strokeWidth={6}
                        size="small"
                    />
                </div>
            )
        },
        {
            title: 'END DATE',
            dataIndex: 'endDate',
            key: 'endDate',
            width: 150,
            align: 'right',
            render: (date) => <Text style={{ color: '#ccc' }}>{dayjs(date).format('DD.MM.YYYY')}</Text>
        }
    ]

    // Statistics
    const criticalCount = processedData.filter(c => c.status === 'critical' || c.status === 'expired').length
    const warningCount = processedData.filter(c => c.status === 'warning').length
    const safeCount = processedData.filter(c => c.status === 'safe').length

    return (
        <div className="contract-status-page fade-in" style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', color: '#fff' }}>
            {/* Header Section */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
                <div>
                    <h1 style={{
                        margin: 0,
                        fontSize: '2rem',
                        background: 'linear-gradient(to right, #fff, #aaa)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        fontWeight: 800
                    }}>
                        Contract Status
                    </h1>
                    <Text style={{ color: '#666', fontSize: '1rem' }}>
                        Track project contract durations and renewals
                    </Text>
                </div>
            </div>

            {/* KPI Cards */}
            <Row gutter={[20, 20]} style={{ marginBottom: 32 }}>
                <Col xs={24} sm={8}>
                    <div className="modern-stat-card critical">
                        <div className="stat-icon-wrapper">
                            <WarningOutlined style={{ fontSize: 24, color: '#ef4444' }} />
                        </div>
                        <div>
                            <div className="stat-label">Critical / Expired</div>
                            <div className="stat-value" style={{ color: '#ef4444' }}>{criticalCount}</div>
                        </div>
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    <div className="modern-stat-card warning">
                        <div className="stat-icon-wrapper">
                            <ClockCircleOutlined style={{ fontSize: 24, color: '#f59e0b' }} />
                        </div>
                        <div>
                            <div className="stat-label">Approaching (30-90 Days)</div>
                            <div className="stat-value" style={{ color: '#f59e0b' }}>{warningCount}</div>
                        </div>
                    </div>
                </Col>
                <Col xs={24} sm={8}>
                    <div className="modern-stat-card safe">
                        <div className="stat-icon-wrapper">
                            <CheckCircleOutlined style={{ fontSize: 24, color: '#4ade80' }} />
                        </div>
                        <div>
                            <div className="stat-label">Safe (&gt;90 Days)</div>
                            <div className="stat-value" style={{ color: '#4ade80' }}>{safeCount}</div>
                        </div>
                    </div>
                </Col>
            </Row>

            {/* Filter Bar */}
            <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(10px)',
                padding: '16px 24px',
                borderRadius: 16,
                marginBottom: 24,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <SearchOutlined style={{ color: '#666', fontSize: 18 }} />
                    <Input
                        placeholder="Search by customer or project name..."
                        bordered={false}
                        onChange={e => setSearchText(e.target.value)}
                        style={{ color: '#fff', fontSize: 16, width: 350 }}
                        className="modern-search-input"
                    />
                </div>
                <div style={{ color: '#666' }}>
                    {filteredData.length} records found
                </div>
            </div>

            {/* Data Table */}
            <Card
                variant="borderless"
                styles={{ body: { padding: 0 } }}
                style={{
                    background: '#1f1f1f',
                    borderRadius: 16,
                    overflow: 'hidden',
                    border: '1px solid #303030'
                }}
            >
                <Table
                    dataSource={filteredData}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    pagination={{ pageSize: 10 }}
                    rowClassName="modern-row"
                    locale={{ emptyText: <div style={{ padding: 40, color: '#666' }}>No contract data found. Add contract duration to your projects.</div> }}
                />
            </Card>

            <style>{`
                .modern-stat-card {
                    background: #141414;
                    border: 1px solid #303030;
                    border-radius: 16px;
                    padding: 24px;
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    transition: transform 0.2s, border-color 0.2s;
                }
                .modern-stat-card:hover {
                    transform: translateY(-2px);
                    border-color: #444;
                }
                .modern-stat-card.critical { border-left: 4px solid #ef4444; }
                .modern-stat-card.warning { border-left: 4px solid #f59e0b; }
                .modern-stat-card.safe { border-left: 4px solid #4ade80; }

                .stat-icon-wrapper {
                    background: rgba(255,255,255,0.03);
                    width: 50px;
                    height: 50px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .stat-label {
                    color: #888;
                    font-size: 0.9rem;
                    margin-bottom: 4px;
                }
                .stat-value {
                    font-size: 2rem;
                    font-weight: 700;
                    line-height: 1;
                }

                .modern-row td {
                    background: transparent !important;
                    border-bottom: 1px solid #303030 !important;
                    padding: 20px 24px !important;
                    color: #ccc !important;
                }
                .modern-row:hover td {
                    background-color: rgba(255,255,255,0.03) !important;
                }
                .ant-table {
                    background: transparent !important;
                    color: white !important;
                }
                .ant-table-thead > tr > th {
                    background: #141414 !important;
                    color: #666 !important;
                    border-bottom: 1px solid #303030 !important;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    padding: 16px 24px !important;
                }
                .ant-pagination {
                    margin: 16px 24px !important;
                }
                .ant-pagination-item {
                    background: transparent !important;
                    border-color: #444 !important;
                }
                .ant-pagination-item a {
                    color: #888 !important;
                }
                .ant-pagination-item-active {
                    border-color: #1677ff !important;
                }
                .ant-pagination-item-active a {
                    color: #1677ff !important;
                }
                .modern-search-input::placeholder {
                    color: #555;
                }
                .modern-search-input:focus {
                     box-shadow: none !important;
                }
            `}</style>
        </div>
    )
}

export default ContractStatusPage
