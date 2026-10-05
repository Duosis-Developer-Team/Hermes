/**
 * =============================================================================
 * HERMES PLATFORM - Contract Status Page
 * =============================================================================
 * Proje sözleşme sürelerini ve kalan günlerini gösteren dashboard.
 * Veri kaynağı: projectService (proje bazlı contract alanları).
 * Hermes Liquid (prototip): üç durum kartı + cam tablo; kalan süre
 * token renkli çubukla. Eski sayfa içi <style> bloğu (global !important
 * kurallar, TÜM uygulamaya sızıyordu) kaldırıldı.
 * =============================================================================
 */

import { useState } from 'react'
import { Alert, Button, Input, Table } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { projectService, workLogService } from '../../services/api'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import dayjs from 'dayjs'
import { useT } from '../../i18n'
import { CountUp, GlassCard, PageHero } from '../../components/liquid'
import './ContractStatusPage.css'
import { matchesAny } from '../../utils/searchText'

const HOURS_PER_DAY = 8

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
        if (usedDays >= totalDays) {
            status = 'expired'
            progressPercent = 100
        } else if (progressPercent >= 80) {
            status = 'critical'
        } else if (progressPercent >= 50) {
            status = 'warning'
        }

        return {
            ...p,
            usedDays,
            remainingDays,
            totalDays,
            status,
            progressPercent
        }
    }).filter(Boolean)
        .sort((a, b) => a.remainingDays - b.remainingDays)

    // Filter by Search (customer name or project name)
    // `p.name` null olabilir: ham `p.name.toLowerCase()` cagrisi tum
    // sayfayi COKERTIYORDU (arama yazilmasi bile gerekmiyordu).
    const query = searchText.trim()
    const filteredData = processedData.filter(p =>
        matchesAny([p.customer_name, p.name], query)
    )

    const STATUS_TONE = { expired: 'bad', critical: 'bad', warning: 'warn', safe: 'ok' }
    const columns = [
        {
            title: t('contracts.colCustomer'),
            dataIndex: 'customer_name',
            key: 'customer_name',
            width: 190,
            render: (name) => <span className="cs-customer">{name || t('contracts.internal')}</span>,
        },
        {
            title: t('contracts.colProject'),
            dataIndex: 'name',
            key: 'name',
            width: 200,
        },
        {
            title: t('contracts.colStatus'),
            key: 'status',
            width: 140,
            render: (_, record) => (
                <span className={`lq-tag lq-tag--${STATUS_TONE[record.status]}`}>
                    <span className="cs-dot" aria-hidden="true" />{t(`contracts.status.${record.status}`)}
                </span>
            ),
        },
        {
            title: t('contracts.remainingTime'),
            key: 'remaining',
            width: 360,
            render: (_, record) => (
                <div className={`cs-remaining cs-remaining--${STATUS_TONE[record.status]}`}>
                    <span className="cs-bar" aria-hidden="true"><i style={{ width: `${record.progressPercent}%` }} /></span>
                    <span className="cs-left">
                        {record.status === 'expired'
                            ? t('contracts.expiredLabel')
                            : t('contracts.daysLeft', { days: record.remainingDays })}
                    </span>
                    <span className="cs-used">{t('contracts.daysUsed', { days: record.usedDays })}</span>
                </div>
            ),
        },
        {
            title: t('contracts.startDate'),
            dataIndex: 'contract_start_date',
            key: 'contract_start_date',
            width: 140,
            align: 'right',
            render: (date) => date
                ? <span className="cs-date">{dayjs(date).format('D MMM YYYY')}</span>
                : <span className="cs-date">—</span>,
        },
    ]

    // Statistics
    const criticalCount = processedData.filter(c => c.status === 'critical' || c.status === 'expired').length
    const warningCount = processedData.filter(c => c.status === 'warning').length
    const safeCount = processedData.filter(c => c.status === 'safe').length

    const summary = [
        { key: 'critical', tone: 'bad', count: criticalCount, title: t('contracts.critical') },
        { key: 'warning', tone: 'warn', count: warningCount, title: t('contracts.approaching') },
        { key: 'safe', tone: 'ok', count: safeCount, title: t('contracts.onTrack') },
    ]

    return (
        <div className="contract-status-page">
            <PageHero
                title={t('contracts.title')}
                subtitle={t('contracts.subtitle')}
                actions={(
                    <div className="contract-filter-bar h-inline-toolbar">
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder={t('contracts.searchPlaceholder')}
                            aria-label={t('contracts.searchLabel')}
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="cs-search"
                        />
                        <span className="cs-count" role="status">
                            {isFetching && projects.length > 0
                                ? t('contracts.refreshing')
                                : t('contracts.recordsFound', { count: filteredData.length })}
                        </span>
                    </div>
                )}
            />

            {loadError && (
                <Alert
                    type="error"
                    showIcon
                    className="cs-alert"
                    message={loadError.message}
                    action={
                        <Button size="small" onClick={() => loadError.retry()}>{t('common.retry')}</Button>
                    }
                />
            )}

            {/* Saglik ozeti: uc cam kart (h-metric-strip rolu). */}
            <div className="cs-summary lq-enter h-metric-strip" role="group" aria-label={t('contracts.health')}>
                {summary.map((c) => (
                    <GlassCard key={c.key} className={`cs-card cs-card--${c.tone}`}>
                        <span className="cs-card__count"><CountUp value={c.count} /></span>
                        <span className="cs-card__text">
                            <b>{c.title}</b>
                            <small>{t('contracts.activeProjects')}</small>
                        </span>
                    </GlassCard>
                ))}
            </div>

            <GlassCard className="cs-table lq-card--flush">
                <Table
                    dataSource={filteredData}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading && projects.length === 0}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        // ILK KULLANIM boslugu ile FILTRE sonucu yoklugu
                        // AYRI mesajlanir: ikisi ayni sey degil.
                        emptyText: (
                            <div className="cs-empty">
                                {query
                                    ? t('contracts.noMatch', { query: searchText.trim() })
                                    : t('contracts.noData')}
                            </div>
                        ),
                    }}
                />
            </GlassCard>
        </div>
    )
}

export default ContractStatusPage
