/**
 * =============================================================================
 * HERMES PLATFORM - Reports Page (Admin Only)
 * =============================================================================
 * Professional, enterprise-grade interface for generating reports.
 * =============================================================================
 */

import { useState } from 'react'
import {
    Card,
    DatePicker,
    Button,
    Form,
    Select,
    Typography,
    Space,
    Row,
    Col,
    message,
    Divider,
    Descriptions,
    Tag
} from 'antd'
import {
    FileExcelOutlined,
    TableOutlined,
    AppstoreOutlined,
    DownloadOutlined,
    CalendarOutlined,
    UserOutlined,
    FileTextOutlined,
    AreaChartOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useQuery, useMutation } from '@tanstack/react-query'
import { reportsService, authService, customerService } from '../services/api'
import { useAuthStore } from '../stores/authStore'

const { Title, Text, Paragraph } = Typography

function ReportsPage() {
    const { user } = useAuthStore()

    // Access Control
    if (!user?.is_admin) {
        return (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexDirection: 'column' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
                <Title level={3} style={{ color: '#fff' }}>Access Restricted</Title>
                <Text style={{ color: '#888' }}>This area is for administrators only.</Text>
            </div>
        )
    }

    return (
        <div style={{ padding: '40px', maxWidth: 1600, margin: '0 auto', color: '#e5e5e5', minHeight: '100%' }}>

            {/* Header Section */}
            <div style={{ marginBottom: 40, borderBottom: '1px solid #333', paddingBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <Title level={2} style={{ color: '#fff', margin: 0, fontWeight: 600, letterSpacing: '-0.5px' }}>
                            Reports & Exports
                        </Title>
                        <Text style={{ color: '#888', fontSize: '14px', marginTop: 8, display: 'block' }}>
                            Generate and download system-wide data exports for analysis.
                        </Text>
                    </div>
                </div>
            </div>

            {/* Reports Grid */}
            <Row gutter={[24, 24]}>

                {/* 1. Weekly/Daily User Report */}
                <Col xs={24} lg={8}>
                    <ProReportCard
                        title="User Work Logs"
                        icon={<FileExcelOutlined />}
                        tag="Detailed"
                        description="Export granular time entries for specific users. Includes project details, descriptions, and durations."
                    >
                        <WeeklyUserReportForm />
                    </ProReportCard>
                </Col>

                {/* 2. Monthly Global Report */}
                <Col xs={24} lg={8}>
                    <ProReportCard
                        title="Global Monthly Export"
                        icon={<TableOutlined />}
                        tag="Organization"
                        description="Complete dump of all organization work logs for a selected month. Ideal for payroll and broad analysis."
                    >
                        <MonthlyGlobalReportForm />
                    </ProReportCard>
                </Col>

                {/* 3. Matrix Report */}
                <Col xs={24} lg={8}>
                    <ProReportCard
                        title="Customer x User Matrix"
                        icon={<AppstoreOutlined />}
                        tag="Pivot"
                        description="Cross-tabulation of Users vs. Customers showing total hours. Useful for resource allocation and billing."
                    >
                        <MatrixReportForm />
                    </ProReportCard>
                </Col>
            </Row>

            {/* Global Styles for AntD overrides */}
            <style>{`
                .pro-card {
                    background: #141414;
                    border: 1px solid #303030;
                    border-radius: 8px;
                    transition: all 0.2s ease;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }
                .pro-card:hover {
                    border-color: #555;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                .ant-form-item-label > label {
                    color: #888 !important;
                    font-size: 12px;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .ant-picker, .ant-select-selector {
                    background-color: #0a0a0a !important;
                    border-color: #333 !important;
                    color: #e5e5e5 !important;
                    border-radius: 6px !important;
                }
                .ant-picker:hover, .ant-select-selector:hover {
                    border-color: #555 !important;
                }
                .ant-picker-input > input, .ant-select-selection-item {
                    color: #e5e5e5 !important;
                }
                /* Custom Premium Button */
                .btn-premium {
                    background: linear-gradient(180deg, #f3f4f6 0%, #d1d5db 100%);
                    color: #111827 !important;
                    border: 1px solid #9ca3af;
                    height: 38px;
                    font-weight: 600;
                    border-radius: 6px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    text-shadow: 0 1px 0 rgba(255,255,255,0.5);
                    transition: all 0.2s ease;
                }
                .btn-premium:hover {
                    background: linear-gradient(180deg, #ffffff 0%, #e5e7eb 100%) !important;
                    color: #000 !important;
                    border-color: #fff;
                    box-shadow: 0 4px 12px rgba(255,255,255,0.15);
                    transform: translateY(-1px);
                }
                .ant-tag-custom {
                    background: #262626;
                    border: 1px solid #424242;
                    color: #888;
                    border-radius: 4px;
                    font-size: 11px;
                    text-transform: uppercase;
                    font-weight: 600;
                }
            `}</style>
        </div>
    )
}

/**
 * Professional Card Component
 */
function ProReportCard({ title, icon, description, children, tag }) {
    return (
        <div className="pro-card">
            <div style={{ padding: '24px', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div style={{
                        width: 40,
                        height: 40,
                        background: '#262626',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        border: '1px solid #333',
                        fontSize: 18
                    }}>
                        {icon}
                    </div>
                    {tag && <Tag className="ant-tag-custom">{tag}</Tag>}
                </div>

                <Title level={4} style={{ color: '#fff', margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>
                    {title}
                </Title>
                <div style={{ color: '#888', fontSize: '14px', lineHeight: '1.5', marginBottom: 24, minHeight: 42 }}>
                    {description}
                </div>

                <div style={{ marginTop: 'auto' }}>
                    {children}
                </div>
            </div>
        </div>
    )
}

// -----------------------------------------------------------------------------
// Form 1: Detailed Customer Report
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Form 1: User Work Logs Report
// -----------------------------------------------------------------------------
function WeeklyUserReportForm() {
    const [form] = Form.useForm()
    const { mutate: exportReport, isPending } = useMutation({
        mutationFn: (values) => {
            const monthObj = values.month || dayjs()
            const params = {
                start_date: monthObj.startOf('month').format('YYYY-MM-DD'),
                end_date: monthObj.endOf('month').format('YYYY-MM-DD'),
                user_id: values.user_id
            }
            return reportsService.exportExcel(params)
        },
        onSuccess: () => message.success('Download started'),
        onError: () => message.error('Download failed')
    })

    const { data: usersResponse } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.getUsers(),
    })
    const users = usersResponse?.data || []

    return (
        <Form form={form} layout="vertical" onFinish={exportReport} initialValues={{ month: dayjs() }}>
            <Form.Item
                name="user_id"
                label="Select User"
                rules={[{ required: true, message: 'Required' }]}
                style={{ marginBottom: 16 }}
            >
                <Select
                    placeholder="Select User"
                    options={users.map(u => ({ value: u.id, label: u.full_name }))}
                    allowClear
                    suffixIcon={<UserOutlined style={{ color: '#555' }} />}
                    style={{ width: '100%' }}
                />
            </Form.Item>

            <Form.Item
                name="month"
                label="Select Month"
                rules={[{ required: true, message: 'Required' }]}
                style={{ marginBottom: 24 }}
            >
                <DatePicker
                    picker="month"
                    style={{ width: '100%' }}
                    format="MMMM YYYY"
                    allowClear={false}
                />
            </Form.Item>

            <Button
                type="primary"
                htmlType="submit"
                block
                icon={<DownloadOutlined />}
                loading={isPending}
                className="btn-premium"
            >
                Export CSV
            </Button>
        </Form>
    )
}

// -----------------------------------------------------------------------------
// Form 2: Monthly Global Report
// -----------------------------------------------------------------------------
function MonthlyGlobalReportForm() {
    const [month, setMonth] = useState(dayjs())
    const { mutate: exportReport, isPending } = useMutation({
        mutationFn: () => {
            const monthStr = month.format('YYYY-MM')
            return reportsService.exportGlobalDetailed(monthStr)
        },
        onSuccess: () => message.success('Download started'),
        onError: () => message.error('Download failed')
    })

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Form layout="vertical" style={{ flex: 1 }}>
                <Form.Item label="Select Period" style={{ marginBottom: 24 }}>
                    <DatePicker
                        picker="month"
                        value={month}
                        onChange={setMonth}
                        allowClear={false}
                        style={{ width: '100%' }}
                        format="MMMM YYYY"
                    />
                </Form.Item>
                <div style={{ flex: 1 }}></div>
                <Button
                    type="primary"
                    onClick={() => exportReport()}
                    block
                    icon={<DownloadOutlined />}
                    loading={isPending}
                    className="btn-premium"
                >
                    Export CSV
                </Button>
            </Form>
        </div>
    )
}

// -----------------------------------------------------------------------------
// Form 3: Matrix Report (Now Monthly Selection)
// -----------------------------------------------------------------------------
function MatrixReportForm() {
    const [month, setMonth] = useState(dayjs())
    const { mutate: exportReport, isPending } = useMutation({
        mutationFn: () => {
            const params = {
                start: month.startOf('month').format('YYYY-MM-DD'),
                end: month.endOf('month').format('YYYY-MM-DD')
            }
            return reportsService.exportGlobalMatrix(params.start, params.end)
        },
        onSuccess: () => message.success('Download started'),
        onError: () => message.error('Download failed')
    })

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Form layout="vertical" style={{ flex: 1 }}>
                <Form.Item label="Analysis Period" style={{ marginBottom: 24 }}>
                    <DatePicker
                        picker="month"
                        value={month}
                        onChange={setMonth}
                        allowClear={false}
                        style={{ width: '100%' }}
                        format="MMMM YYYY"
                    />
                </Form.Item>
                <div style={{ flex: 1 }}></div>
                <Button
                    type="primary"
                    onClick={() => exportReport()}
                    block
                    icon={<DownloadOutlined />}
                    loading={isPending}
                    className="btn-premium"
                >
                    Export Matrix
                </Button>
            </Form>
        </div>
    )
}

export default ReportsPage
