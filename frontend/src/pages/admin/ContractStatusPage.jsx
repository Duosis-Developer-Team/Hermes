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
import { projectService, workLogService } from '../../services/api'
import dayjs from 'dayjs'

const HOURS_PER_DAY = 8

const { Text } = Typography

function ContractStatusPage() {
    const [searchText, setSearchText] = useState('')

    // Fetch Projects (include inactive to show all contracts)
    const { data: projects = [], isLoading } = useQuery({
        queryKey: ['projects', { include_inactive: false }],
        queryFn: () => projectService.getAll({ include_inactive: false }),
    })

    // Fetch billable hours summary (project_id → total hours)
    const { data: billableSummaryResponse } = useQuery({
        queryKey: ['billable-summary'],
        queryFn: () => workLogService.getBillableSummary(),
    })
    const billableSummary = billableSummaryResponse?.data || {}

    // Calculate Status Logic — only projects with contract data (effort-based)
    const processedData = projects.map(p => {
        if (!p.contract_duration_days) {
            return null
        }

        const totalDays = p.contract_duration_days
        const totalBillableHours = billableSummary[p.id] || 0
        const usedDays = Math.floor(totalBillableHours / HOURS_PER_DAY)
        const remainingDays = Math.max(0, totalDays - usedDays)

        let progressPercent = Math.min(100, (usedDays / totalDays) * 100)

        let status = 'safe'
        let color = '#4ade80'

        if (usedDays >= totalDays) {
            status = 'expired'
            color = '#ef4444'
            progressPercent = 100
        } else if (progressPercent >= 80) {
            status = 'critical'
            color = '#ef4444'
        } else if (progressPercent >= 50) {
            status = 'warning'
            color = '#f59e0b'
        }

        return {
            ...p,
            usedDays,
            remainingDays,
            totalDays,
            status,
            color,
            progressPercent
        }
    }).filter(Boolean)
        .sort((a, b) => a.remainingDays - b.remainingDays)

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
                <Text strong style={{ fontSize: '0.95rem', color: 'var(--c-text-strong)' }}>
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
                <Text style={{ fontSize: '0.95rem', color: 'var(--c-text)' }}>{text}</Text>
            )
        },
        {
            title: 'STATUS',
            key: 'status',
            width: 180,
            render: (_, record) => {
                if (record.status === 'expired') return <Tag color="error" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<WarningOutlined />}>EXPIRED</Tag>
                if (record.status === 'critical') return <Tag color="error" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<WarningOutlined />}>CRITICAL</Tag>
                if (record.status === 'warning') return <Tag color="warning" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<ClockCircleOutlined />}>WARNING</Tag>
                return <Tag color="success" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }} icon={<CheckCircleOutlined />}>ACTIVE</Tag>
            }
        },
        {
            title: 'REMAINING TIME',
            key: 'remaining',
            width: 300,
            render: (_, record) => (
                <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ color: 'var(--c-text-muted)', fontSize: 11 }}>
                            {record.usedDays} days used
                        </span>
                        <span style={{ color: record.color, fontSize: 11, fontWeight: 600 }}>
                            {record.remainingDays} days left
                        </span>
                    </div>
                    <Progress
                        percent={record.progressPercent}
                        showInfo={false}
                        strokeColor={record.color}
                        trailColor="rgba(var(--overlay-rgb),0.1)"
                        strokeWidth={6}
                        size="small"
                    />
                </div>
            )
        },
        {
            title: 'START DATE',
            dataIndex: 'contract_start_date',
            key: 'contract_start_date',
            width: 150,
            align: 'right',
            render: (date) => date
                ? <Text style={{ color: 'var(--c-text)' }}>{dayjs(date).format('DD.MM.YYYY')}</Text>
                : <Text style={{ color: 'var(--c-text-faint)' }}>—</Text>
        }
    ]

    // Statistics
    const criticalCount = processedData.filter(c => c.status === 'critical' || c.status === 'expired').length
    const warningCount = processedData.filter(c => c.status === 'warning').length
    const safeCount = processedData.filter(c => c.status === 'safe').length

    return (
        <div className="contract-status-page fade-in" style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', color: 'var(--c-text-strong)' }}>
            {/* Header Section */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
                <div>
                    <h1 style={{
                        margin: 0,
                        fontSize: '2rem',
                        background: 'linear-gradient(to right, var(--c-text-strong), var(--c-text-muted))',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        fontWeight: 800
                    }}>
                        Contract Status
                    </h1>
                    <Text style={{ color: 'var(--c-text-faint)', fontSize: '1rem' }}>
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
                            <div className="stat-label">Approaching (50–80% used)</div>
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
                            <div className="stat-label">On Track (&lt;50% used)</div>
                            <div className="stat-value" style={{ color: '#4ade80' }}>{safeCount}</div>
                        </div>
                    </div>
                </Col>
            </Row>

            {/* Filter Bar */}
            <div style={{
                background: 'rgba(var(--overlay-rgb), 0.03)',
                backdropFilter: 'blur(10px)',
                padding: '16px 24px',
                borderRadius: 16,
                marginBottom: 24,
                border: '1px solid rgba(var(--overlay-rgb), 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <SearchOutlined style={{ color: 'var(--c-text-faint)', fontSize: 18 }} />
                    <Input
                        placeholder="Search by customer or project name..."
                        bordered={false}
                        onChange={e => setSearchText(e.target.value)}
                        style={{ color: 'var(--c-text-strong)', fontSize: 16, width: 350 }}
                        className="modern-search-input"
                    />
                </div>
                <div style={{ color: 'var(--c-text-faint)' }}>
                    {filteredData.length} records found
                </div>
            </div>

            {/* Data Table */}
            <Card
                variant="borderless"
                styles={{ body: { padding: 0 } }}
                style={{
                    background: 'var(--c-surface-2)',
                    borderRadius: 16,
                    overflow: 'hidden',
                    border: '1px solid var(--c-border)'
                }}
            >
                <Table
                    dataSource={filteredData}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    pagination={{ pageSize: 10 }}
                    rowClassName="modern-row"
                    locale={{ emptyText: <div style={{ padding: 40, color: 'var(--c-text-faint)' }}>No contract data found. Add contract duration to your projects.</div> }}
                />
            </Card>

            <style>{`
                .modern-stat-card {
                    background: var(--c-surface);
                    border: 1px solid var(--c-border);
                    border-radius: 16px;
                    padding: 24px;
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    transition: transform 0.2s, border-color 0.2s;
                }
                .modern-stat-card:hover {
                    transform: translateY(-2px);
                    border-color: var(--c-border-strong);
                }
                .modern-stat-card.critical { border-left: 4px solid #ef4444; }
                .modern-stat-card.warning { border-left: 4px solid #f59e0b; }
                .modern-stat-card.safe { border-left: 4px solid #4ade80; }

                .stat-icon-wrapper {
                    background: rgba(var(--overlay-rgb),0.03);
                    width: 50px;
                    height: 50px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .stat-label {
                    color: var(--c-text-muted);
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
                    border-bottom: 1px solid var(--c-border) !important;
                    padding: 20px 24px !important;
                    color: var(--c-text) !important;
                }
                .modern-row:hover td {
                    background-color: rgba(var(--overlay-rgb),0.03) !important;
                }
                .ant-table {
                    background: transparent !important;
                    color: var(--c-text-strong) !important;
                }
                .ant-table-thead > tr > th {
                    background: var(--c-surface) !important;
                    color: var(--c-text-faint) !important;
                    border-bottom: 1px solid var(--c-border) !important;
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
                    border-color: var(--c-border-strong) !important;
                }
                .ant-pagination-item a {
                    color: var(--c-text-muted) !important;
                }
                .ant-pagination-item-active {
                    border-color: #1677ff !important;
                }
                .ant-pagination-item-active a {
                    color: #1677ff !important;
                }
                .modern-search-input::placeholder {
                    color: var(--c-text-faint);
                }
                .modern-search-input:focus {
                     box-shadow: none !important;
                }
            `}</style>
        </div>
    )
}

export default ContractStatusPage
