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


// Chart colors - Jira palette

// 0.75 → "0h 45m", 2.75 → "2h 45m", 2.0 → "2h"
function formatDuration(decimal) {
    if (!decimal) return '0h'
    const h = Math.floor(decimal)
    const m = Math.round((decimal - h) * 60)
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
}

function DashboardPage() {
    const [dateRange, setDateRange] = useState([
        dayjs().subtract(30, 'day'),
        dayjs(),
    ])

    // Dashboard data
    const { data, isLoading } = useQuery({
        queryKey: ['dashboard', dateRange[0]?.format('YYYY-MM-DD'), dateRange[1]?.format('YYYY-MM-DD')],
        queryFn: () => reportsService.getDashboard({
            start_date: dateRange[0]?.format('YYYY-MM-DD'),
            end_date: dateRange[1]?.format('YYYY-MM-DD'),
        }),
        enabled: !!dateRange[0] && !!dateRange[1],
    })

    console.log('Dashboard Data:', data)

    const { data: usersResponse = {} } = useQuery({
        queryKey: ['users'],
        queryFn: () => authService.getUsers(),
    })
    const users = usersResponse.data || []

    // Debug logging
    if (data) {
        console.log('Dashboard Data Raw:', data)
    }

    // Ensure numeric values for charts
    const customerData = (data?.by_customer || []).map(item => ({
        ...item,
        hours: Number(item.hours)
    }))

    const projectData = (data?.by_project || []).map(item => ({
        ...item,
        hours: Number(item.hours)
    }))

    const goToPreviousMonth = () => {
        setDateRange(prev => [prev[0].subtract(1, 'month').startOf('month'), prev[0].subtract(1, 'month').endOf('month')])
    }
    const goToNextMonth = () => {
        setDateRange(prev => [prev[0].add(1, 'month').startOf('month'), prev[0].add(1, 'month').endOf('month')])
    }
    const goToThisMonth = () => {
        setDateRange([dayjs().startOf('month'), dayjs().endOf('month')])
    }

    // Map user_id to name in dashboard data
    const dashboardData = {
        ...data,
        by_user: data?.by_user?.map(item => {
            const user = users.find(u => u.id === item.name) // item.name is user_id from backend
            return { ...item, name: user ? user.full_name : item.name }
        }) || []
    }

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: '#1C2127',
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
                            <Button type="text" icon={<LeftOutlined />} onClick={goToPreviousMonth} style={{ color: 'var(--c-text)' }} />
                            <span style={{ color: 'var(--c-text)', fontWeight: 500, minWidth: 160, textAlign: 'center' }}>
                                {dateRange[0].format('DD MMM')} - {dateRange[1].format('DD MMM, YYYY')}
                            </span>
                            <Button type="text" icon={<RightOutlined />} onClick={goToNextMonth} style={{ color: 'var(--c-text)' }} />
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
                        <div className="stat-value">{formatDuration(data?.total_hours)}</div>
                        <div className="stat-label">Total Hours</div>
                    </div>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <div className="stat-card">
                        <div className="stat-value">{data?.by_customer?.length || 0}</div>
                        <div className="stat-label">Customers</div>
                    </div>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <div className="stat-card">
                        <div className="stat-value">{data?.by_project?.length || 0}</div>
                        <div className="stat-label">Projects</div>
                    </div>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <div className="stat-card">
                        <div className="stat-value">{dashboardData?.by_user?.length || 0}</div>
                        <div className="stat-label">Active Members</div>
                    </div>
                </Col>
            </Row>

            {/* Charts */}
            <Row gutter={[24, 24]}>
                {/* By Customer - Pie Chart */}
                <Col xs={24} lg={12}>
                    <Card title="🏢 By Customer">
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={customerData.slice(0, 8)} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--N700)" />
                                <XAxis type="number" stroke="var(--N400)" />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--N400)" tick={{ fontSize: 12 }} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="hours" fill="#4BCE97" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>
                </Col>

                {/* By Project - Bar Chart */}
                <Col xs={24} lg={12}>
                    <Card title="📁 By Project">
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={projectData.slice(0, 8)} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--N700)" />
                                <XAxis type="number" stroke="var(--N400)" />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--N400)" tick={{ fontSize: 12 }} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                <Bar dataKey="hours" fill="#579DFF" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>
                </Col>

                {/* By User - Bar Chart */}
                <Col xs={24}>
                    <Card title="👥 By User">
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={dashboardData?.by_user || []}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--N700)" />
                                <XAxis dataKey="name" stroke="var(--N400)" />
                                <YAxis stroke="var(--N400)" />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                <Legend />
                                <Bar dataKey="hours" name="Hours" fill="#6CC3E0" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>
                </Col>
            </Row>
        </div>
    )
}

export default DashboardPage
