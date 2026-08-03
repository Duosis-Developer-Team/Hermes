/**
 * =============================================================================
 * HERMES PLATFORM - Dashboard Page
 * =============================================================================
 * Admin dashboard - zaman verilerinin görselleştirilmesi (FR 5.x).
 * =============================================================================
 */

import { useState } from 'react'
import { Card, Row, Col, Spin, Button } from 'antd'
import {
    
    LeftOutlined, RightOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import dayjs from 'dayjs'
import { reportsService, authService } from '../services/api'
import { queryKeys } from '../query/queryKeys'
import {
    chartState, dashboardSummary, resolveUserNames, toChartSeries,
} from '../features/dashboard/model/dashboardData'

// Grafik renkleri SEMANTIC token'dan gelir; ham hex tekrarlanmaz.
// Recharts SVG attribute'lari CSS degiskenini dogrudan kabul ettigi icin
// var(--...) referansi yeterli — tema degisiminde renk kendiliginde
// dogru tarafa gecer.
const CHART_SERIES_COLOR = {
    customer: 'var(--h-success)',
    project: 'var(--h-brand)',
    user: 'var(--h-info)',
}

function DashboardPage() {
    const [dateRange, setDateRange] = useState([
        dayjs().subtract(30, 'day'),
        dayjs(),
    ])

    // Dashboard data
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.dashboard.range(
            dateRange[0]?.format('YYYY-MM-DD'),
            dateRange[1]?.format('YYYY-MM-DD')
        ),
        queryFn: () => reportsService.getDashboard({
            start_date: dateRange[0]?.format('YYYY-MM-DD'),
            end_date: dateRange[1]?.format('YYYY-MM-DD'),
        }),
        enabled: !!dateRange[0] && !!dateRange[1],
    })

    const { data: usersResponse = {} } = useQuery({
        queryKey: queryKeys.users.all,
        queryFn: () => authService.getUsers(),
    })
    const users = usersResponse.data || []

    // Donusumler TEST EDILEBILIR adaptorden gelir (features/dashboard/
    // model): sayisal olmayan degerler NaN olarak grafige gitmez, ham
    // UUID ekrana sizmaz.
    const customerData = toChartSeries(data?.by_customer, { limit: 8 })
    const projectData = toChartSeries(data?.by_project, { limit: 8 })

    const goToPreviousMonth = () => {
        setDateRange(prev => [prev[0].subtract(1, 'month').startOf('month'), prev[0].subtract(1, 'month').endOf('month')])
    }
    const goToNextMonth = () => {
        setDateRange(prev => [prev[0].add(1, 'month').startOf('month'), prev[0].add(1, 'month').endOf('month')])
    }
    const goToThisMonth = () => {
        setDateRange([dayjs().startOf('month'), dayjs().endOf('month')])
    }

    // Backend `by_user.name` alaninda user_id gonderir; adaptor onu
    // goruntulenen ada cevirir ve cozulemezse notr tire yazar.
    const userData = resolveUserNames(data?.by_user, users)
    const summary = dashboardSummary(data, userData)

    /**
     * Grafik cercevesi: veri yoksa veya tamami sifir saatse GRAFIK
     * CIZILMEZ, durumu anlatan bir mesaj gosterilir. "Veri yok" ile
     * "kayit var ama sifir saat" ayri mesajlardir — ikisini ayni
     * gostermek kullaniciyi yanlis yonlendirirdi.
     */
    const ChartFrame = ({ series, children }) => {
        const state = chartState(series)
        if (state === 'ready') return children
        return (
            /* Premium UI: 300px bos gri alan yerine kompakt, ferah bos
               durum — ikon + kisa metin; panel yuksekligi iceriktir. */
            <div
                role="status"
                style={{
                    padding: '40px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'center',
                    color: 'var(--c-text-muted)',
                    fontSize: 13,
                }}
            >
                <span aria-hidden="true" style={{ fontSize: 22, opacity: 0.5 }}>📊</span>
                {state === 'empty'
                    ? 'No data for the selected date range.'
                    : 'Records exist but no hours were logged in this range.'}
            </div>
        )
    }

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: 'var(--c-surface-2)',
                    border: '1px solid var(--c-border)',
                    borderRadius: '4px',
                    padding: '8px 12px',
                    color: 'var(--c-text)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}>
                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--c-text-strong)' }}>{label}</p>
                    <p style={{ margin: 0 }}>{`${payload[0].value} h`}</p>
                </div>
            )
        }
        return null
    }

    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
                <Spin size="large" />
            </div>
        )
    }

    return (
        <div className="dashboard-page fade-in">
            {/* Page Header */}
            <div className="page-header">
                <Row justify="space-between" align="middle">
                    <Col>
                        <h1>Dashboard</h1>
                        <p>Team performance and time distribution</p>
                    </Col>
                    <Col>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--c-chip)', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--c-border)' }}>
                            <Button type="text" aria-label="Previous month" icon={<LeftOutlined />} onClick={goToPreviousMonth} style={{ color: 'var(--c-text)' }} />
                            <span style={{ color: 'var(--c-text)', fontWeight: 500, minWidth: 160, textAlign: 'center' }}>
                                {dateRange[0].format('DD MMM')} - {dateRange[1].format('DD MMM, YYYY')}
                            </span>
                            <Button type="text" aria-label="Next month" icon={<RightOutlined />} onClick={goToNextMonth} style={{ color: 'var(--c-text)' }} />
                            <div style={{ width: 1, height: 20, background: 'var(--c-border)', margin: '0 4px' }} />
                            <Button type="text" onClick={goToThisMonth} style={{ color: 'var(--c-text)' }}>Today</Button>
                        </div>
                    </Col>
                </Row>
            </div>

            {/* KPI Cards */}
            <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={12} lg={6}>
                    <div className="stat-card">
                        <div className="stat-value">{summary.totalHours}</div>
                        <div className="stat-label">Total Hours</div>
                    </div>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <div className="stat-card">
                        <div className="stat-value">{summary.customerCount}</div>
                        <div className="stat-label">Customers</div>
                    </div>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <div className="stat-card">
                        <div className="stat-value">{summary.projectCount}</div>
                        <div className="stat-label">Projects</div>
                    </div>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <div className="stat-card">
                        <div className="stat-value">{summary.memberCount}</div>
                        <div className="stat-label">Active Members</div>
                    </div>
                </Col>
            </Row>

            {/* Charts */}
            <Row gutter={[24, 24]}>
                {/* By Customer - Pie Chart */}
                <Col xs={24} lg={12}>
                    <Card title="🏢 By Customer">
                        <ChartFrame series={customerData}>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={customerData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--N700)" />
                                <XAxis type="number" stroke="var(--N400)" />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--N400)" tick={{ fontSize: 12 }} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="hours" fill={CHART_SERIES_COLOR.customer} radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                        </ChartFrame>
                    </Card>
                </Col>

                {/* By Project - Bar Chart */}
                <Col xs={24} lg={12}>
                    <Card title="📁 By Project">
                        <ChartFrame series={projectData}>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={projectData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--N700)" />
                                <XAxis type="number" stroke="var(--N400)" />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--N400)" tick={{ fontSize: 12 }} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="hours" fill={CHART_SERIES_COLOR.project} radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                        </ChartFrame>
                    </Card>
                </Col>

                {/* By User - Bar Chart */}
                <Col xs={24}>
                    <Card title="👥 By User">
                        <ChartFrame series={userData}>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={userData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--N700)" />
                                <XAxis dataKey="name" stroke="var(--N400)" />
                                <YAxis stroke="var(--N400)" />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                <Legend />
                                <Bar dataKey="hours" name="Hours" fill={CHART_SERIES_COLOR.user} radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                        </ChartFrame>
                    </Card>
                </Col>
            </Row>
        </div>
    )
}

export default DashboardPage
