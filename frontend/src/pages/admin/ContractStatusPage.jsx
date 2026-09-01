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
import {
    Alert, Button, Card, Input, Progress, Table, Tag, Typography,
} from 'antd'
import { SearchOutlined, ClockCircleOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { projectService, workLogService } from '../../services/api'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import dayjs from 'dayjs'
import { useT } from '../../i18n'

const HOURS_PER_DAY = 8

const { Text } = Typography

function ContractStatusPage() {
    const t = useT()
    const [searchText, setSearchText] = useState('')

    // Fetch Projects (include inactive to show all contracts)
    const {
        data: projects = [], isLoading, isFetching,
        isError: projectsError, error: projectsErrObj, refetch: refetchProjects,
    } = useQuery({
        queryKey: ['projects', { include_inactive: false }],
        queryFn: () => projectService.getAll({ include_inactive: false }),
    })

    // Fetch billable hours summary (project_id → total hours)
    const {
        data: billableSummaryResponse,
        isError: billableError, error: billableErrObj, refetch: refetchBillable,
    } = useQuery({
        queryKey: ['billable-summary'],
        queryFn: () => workLogService.getBillableSummary(),
    })
    const billableSummary = billableSummaryResponse?.data || {}

    /**
     * Iki sorgudan HANGISI basarisiz olursa tablo yaniltir: proje verisi
     * gelmezse "sozlesme yok", kullanim verisi gelmezse "hic gun
     * harcanmamis" gibi gorunur. Ikisi de acikca bildirilir ve yeniden
     * denenebilir — sessiz bos tablo YOK.
     */
    const loadError = projectsError
        ? { message: normalizeApiError(projectsErrObj).message, retry: refetchProjects }
        : billableError
            ? {
                message: `${normalizeApiError(billableErrObj).message} `
                    + 'Contract usage cannot be calculated without it.',
                retry: refetchBillable,
            }
            : null

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
    // `p.name` null olabilir: ham `p.name.toLowerCase()` cagrisi tum
    // sayfayi COKERTIYORDU (arama yazilmasi bile gerekmiyordu).
    const query = searchText.trim().toLowerCase()
    const filteredData = processedData.filter(p =>
        (p.customer_name || '').toLowerCase().includes(query) ||
        (p.name || '').toLowerCase().includes(query)
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
            title: t('contracts.remainingTime'),
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
                        /*
                         * AntD 5.x: `strokeWidth` deprecated → `size`.
                         * Onceki deger cifti (`size="small"` + strokeWidth 6)
                         * antd icinde height=6'ya cozuluyordu; nesne bicimi
                         * ayni yuksekligi ACIKCA korur, genislik otomatik
                         * kalir.
                         */
                        size={{ height: 6 }}
                    />
                </div>
            )
        },
        {
            title: t('contracts.startDate'),
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
                    }}>{t('contracts.title')}</h1>
                    <Text style={{ color: 'var(--c-text-faint)', fontSize: '1rem' }}>{t('contracts.subtitle')}</Text>
                </div>
            </div>

            {loadError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 24 }}
                    message={loadError.message}
                    action={
                        <Button size="small" onClick={() => loadError.retry()}>{t('common.retry')}</Button>
                    }
                />
            )}

            {/* Premium: uc buyuk status karti yerine TEK health strip —
                ince dikey ayiricilar, ikon + sayi + label hiyerarsisi. */}
            <div className="h-metric-strip" role="group" aria-label={t('contracts.health')}>
                <div className="h-metric-strip__item">
                    <div className="h-metric-strip__value" style={{ color: 'var(--h-danger)' }}>
                        <WarningOutlined style={{ fontSize: 18, marginRight: 8 }} />{criticalCount}
                    </div>
                    <div className="h-metric-strip__label">{t('contracts.critical')}</div>
                </div>
                <div className="h-metric-strip__item">
                    <div className="h-metric-strip__value" style={{ color: 'var(--h-warning)' }}>
                        <ClockCircleOutlined style={{ fontSize: 18, marginRight: 8 }} />{warningCount}
                    </div>
                    <div className="h-metric-strip__label">Approaching (50–80% used)</div>
                </div>
                <div className="h-metric-strip__item">
                    <div className="h-metric-strip__value" style={{ color: 'var(--h-success)' }}>
                        <CheckCircleOutlined style={{ fontSize: 18, marginRight: 8 }} />{safeCount}
                    </div>
                    <div className="h-metric-strip__label">On Track (&lt;50% used)</div>
                </div>
            </div>

            {/* Premium: gri search paneli KALKTI — search + kayit sayisi
                tek ince toolbar'da. */}
            <div className="contract-filter-bar h-inline-toolbar" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <SearchOutlined style={{ color: 'var(--c-text-faint)', fontSize: 18 }} />
                    <Input
                        placeholder={t('contracts.searchPlaceholder')}
                        aria-label={t('contracts.searchLabel')}
                        /* AntD 5.x: bordered deprecated → variant. */
                        variant="borderless"
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        style={{ color: 'var(--c-text-strong)', fontSize: 16, width: 350 }}
                        className="modern-search-input"
                    />
                </div>
                <div style={{ color: 'var(--c-text-faint)' }} role="status">
                    {isFetching && projects.length > 0
                        ? 'Refreshing…'
                        : `${filteredData.length} records found`}
                </div>
            </div>

            {/* Data Table */}
            <Card
                variant="borderless"
                styles={{ body: { padding: 0 } }}
                className="h-dataview"
                style={{ background: 'transparent' }}
            >
                <Table
                    dataSource={filteredData}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading && projects.length === 0}
                    pagination={{ pageSize: 10 }}
                    rowClassName="modern-row"
                    scroll={{ x: 'max-content' }}
                    locale={{
                        // ILK KULLANIM boslugu ile FILTRE sonucu yoklugu
                        // AYRI mesajlanir: ikisi ayni sey degil.
                        emptyText: (
                            <div style={{ padding: 20, color: 'var(--c-text-faint)' }}>
                                {query
                                    ? `No contracts match “${searchText.trim()}”.`
                                    : 'No contract data found. Add contract duration to your projects.'}
                            </div>
                        ),
                    }}
                />
            </Card>

            <style>{`
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

                /* Mobile: filter bar stacks; the 350px search input
                   flexes to the remaining row width instead. */
                @media (max-width: 480px) {
                    .contract-filter-bar {
                        flex-direction: column;
                        align-items: stretch;
                        gap: 8px;
                    }
                    .contract-filter-bar .modern-search-input {
                        width: auto !important;
                        flex: 1 1 auto;
                        min-width: 0;
                    }
                }
            `}</style>
        </div>
    )
}

export default ContractStatusPage
