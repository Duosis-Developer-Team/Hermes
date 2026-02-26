/**
 * =============================================================================
 * HERMES PLATFORM - Billable Hours Page (Admin Only)
 * =============================================================================
 * Admin page for managing user billable hours.
 * =============================================================================
 */

import { useState, useMemo } from 'react'
import {
    Table,
    Button,
    Select,
    InputNumber,
    Avatar,
    message,
    Typography,
    Space,
    Card,
    Tooltip,
    Tag
} from 'antd'
import {
    LeftOutlined,
    RightOutlined,
    UserOutlined,
    SaveOutlined,
    ClockCircleOutlined,
    CalendarOutlined
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import 'dayjs/locale/en'

import { workLogService, authService, customerService, projectService } from '../services/api'
import { useAuthStore } from '../stores/authStore'

dayjs.extend(isoWeek)
dayjs.locale('en')

const { Title, Text } = Typography

function BillableHoursPage() {
    const queryClient = useQueryClient()
    const { user } = useAuthStore()

    // ==========================================================================
    // State
    // ==========================================================================
    const [weekStart, setWeekStart] = useState(() => dayjs().startOf('isoWeek'))
    const [selectedUserId, setSelectedUserId] = useState(user?.id)
    const [editingId, setEditingId] = useState(null)
    const [editValue, setEditValue] = useState(null)

    // ==========================================================================
    // Week Navigation
    // ==========================================================================
    const weekEnd = weekStart.endOf('isoWeek')
    // Format: Jan 19 - Jan 25, 2026
    const weekLabel = `${weekStart.format('MMM DD')} - ${weekEnd.format('MMM DD, YYYY')}`

    const goToPreviousWeek = () => setWeekStart(prev => prev.subtract(1, 'week'))
    const goToNextWeek = () => setWeekStart(prev => prev.add(1, 'week'))
    const goToToday = () => setWeekStart(dayjs().startOf('isoWeek'))

    // ==========================================================================
    // Data Fetching
    // ==========================================================================
    // Fetch all users (Admin only)
    const { data: usersResponse, isLoading: usersLoading } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.getUsers(),
        enabled: !!user?.is_admin,
    })

    // Fetch Customers
    const { data: customersResponse } = useQuery({
        queryKey: ['customers-list'],
        queryFn: () => customerService.getAll(),
        enabled: !!user?.is_admin,
    })

    // Fetch Projects
    const { data: projectsResponse } = useQuery({
        queryKey: ['projects-list'],
        queryFn: () => projectService.getAll(),
        enabled: !!user?.is_admin,
    })

    // Fetch Work Logs for selected user
    const { data: workLogsResponse, isLoading: logsLoading } = useQuery({
        queryKey: ['workLogs', weekStart.format('YYYY-MM-DD'), selectedUserId],
        queryFn: () => workLogService.getMyLogs({
            start_date: weekStart.format('YYYY-MM-DD'),
            end_date: weekEnd.format('YYYY-MM-DD'),
            limit: 500,
            user_id: selectedUserId
        }),
        enabled: !!selectedUserId,
    })

    // Lists & Maps
    const usersList = usersResponse?.data || []

    // Create maps for fast lookup
    const customersMap = useMemo(() => {
        const map = {}
        // Backend returns flat array for customers
        const list = Array.isArray(customersResponse) ? customersResponse : (customersResponse?.data || [])

        if (Array.isArray(list)) {
            list.forEach(c => { map[c.id] = c })
        }
        return map
    }, [customersResponse])

    const projectsMap = useMemo(() => {
        const map = {}
        // Backend returns flat array for projects
        const list = Array.isArray(projectsResponse) ? projectsResponse : (projectsResponse?.data || [])

        if (Array.isArray(list)) {
            list.forEach(p => { map[p.id] = p })
        }
        return map
    }, [projectsResponse])

    const workLogs = useMemo(() => {
        const rawLogs = workLogsResponse?.data || []

        // Enrich logs with names found in maps
        const enriched = rawLogs.map(log => {
            const customerName = log.customer?.name || customersMap[log.customer_id]?.name || 'Unknown'
            const projectName = log.project?.name || projectsMap[log.project_id]?.name || 'Unknown'

            return {
                ...log,
                customerName,
                projectName
            }
        })

        return enriched.sort((a, b) => dayjs(b.date_worked).diff(dayjs(a.date_worked)))
    }, [workLogsResponse, customersMap, projectsMap])

    const totalHours = useMemo(() => {
        return workLogs.reduce((sum, log) => {
            // Use billable hours if available, otherwise worked hours
            const billable = log.billable_duration_hours !== null && log.billable_duration_hours !== undefined
                ? parseFloat(log.billable_duration_hours)
                : parseFloat(log.duration_hours)
            return sum + (billable || 0)
        }, 0)
    }, [workLogs])

    // ==========================================================================
    // Mutation
    // ==========================================================================
    const updateMutation = useMutation({
        // Only update billable_duration_hours, preserve duration_hours
        mutationFn: ({ id, billable_duration_hours }) => workLogService.update(id, { billable_duration_hours }),
        onSuccess: () => {
            message.success('Hours updated')
            queryClient.invalidateQueries(['workLogs'])
            setEditingId(null)
            setEditValue(null)
        },
        onError: (error) => {
            message.error(error.response?.data?.detail || 'Update failed')
        },
    })

    // ==========================================================================
    // Handlers
    // ==========================================================================
    const handleEditStart = (record) => {
        setEditingId(record.id)
        // Set edit value to billable hours (or fallback to worked hours)
        const val = record.billable_duration_hours !== null && record.billable_duration_hours !== undefined
            ? record.billable_duration_hours
            : record.duration_hours
        setEditValue(val)
    }

    const handleSave = (id) => {
        if (editValue === null || editValue < 0) return
        updateMutation.mutate({ id, billable_duration_hours: editValue })
    }

    // ==========================================================================
    // Columns
    // ==========================================================================
    const columns = [
        {
            title: 'DATE',
            dataIndex: 'date_worked',
            key: 'date_worked',
            width: 140,
            render: (text) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        background: '#333',
                        padding: '6px 10px',
                        borderRadius: 8,
                        textAlign: 'center',
                        minWidth: 50
                    }}>
                        <div style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', lineHeight: 1 }}>
                            {dayjs(text).format('DD')}
                        </div>
                        <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase' }}>
                            {dayjs(text).format('MMM')}
                        </div>
                    </div>
                    <div>
                        <Text style={{ color: '#ccc', display: 'block' }}>{dayjs(text).format('dddd')}</Text>
                        <Text style={{ color: '#666', fontSize: 12 }}>{dayjs(text).format('YYYY')}</Text>
                    </div>
                </div>
            )
        },
        {
            title: 'CUSTOMER',
            key: 'customer',
            width: 200,
            render: (_, record) => (
                <Text strong style={{ color: '#fff', fontSize: '1rem' }}>
                    {record.customerName}
                </Text>
            )
        },
        {
            title: 'PROJECT',
            key: 'project',
            width: 200,
            render: (_, record) => (
                <Tag color="geekblue" style={{ border: 'none', margin: 0, fontSize: '0.9rem', padding: '4px 10px' }}>
                    {record.projectName}
                </Tag>
            )
        },
        {
            title: 'DESCRIPTION',
            dataIndex: 'description',
            key: 'description',
            ellipsis: true,
            render: (text) => (
                <Tooltip title={text}>
                    <span style={{ color: '#aaa', maxWidth: 400, display: 'inline-block' }}>
                        {text || '-'}
                    </span>
                </Tooltip>
            )
        },
        {
            title: 'BILLABLE HOURS',
            key: 'billable_duration_hours',
            width: 160,
            align: 'right',
            render: (_, record) => {
                const isEditing = editingId === record.id

                // Determine display value
                const displayValue = record.billable_duration_hours !== null && record.billable_duration_hours !== undefined
                    ? record.billable_duration_hours
                    : record.duration_hours

                return isEditing ? (
                    <Space style={{ justifyContent: 'flex-end' }}>
                        <InputNumber
                            min={0}
                            step={0.5}
                            value={editValue}
                            onChange={setEditValue}
                            onPressEnter={() => handleSave(record.id)}
                            autoFocus
                            style={{ width: 70 }}
                            variant="filled"
                        />
                        <Button
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={() => handleSave(record.id)}
                            loading={updateMutation.isPending}
                        />
                        <Button
                            size="small"
                            type="text"
                            onClick={() => {
                                setEditingId(null)
                                setEditValue(null)
                            }}
                        >
                            x
                        </Button>
                    </Space>
                ) : (
                    <div
                        onClick={() => handleEditStart(record)}
                        className="editable-duration-cell"
                    >
                        <span style={{ fontSize: '1.2rem', fontWeight: 600, color: '#4ade80' }}>
                            {parseFloat(displayValue).toFixed(2)}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#9FADBC', marginLeft: 4 }}>h</span>
                    </div>
                )
            }
        }
    ]

    // ==========================================================================
    // Render
    // ==========================================================================
    if (!user?.is_admin) {
        return <div style={{ padding: 40, textAlign: 'center', color: '#fff' }}>Access Denied</div>
    }

    return (
        <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', color: '#fff' }}>

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
                        Billable Hours
                    </h1>
                    <Text style={{ color: '#666', fontSize: '1rem' }}>
                        Manage user billable time entries
                    </Text>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right', paddingRight: 16, borderRight: '1px solid #333' }}>
                        <div style={{ fontSize: 12, color: '#888', letterSpacing: 1 }}>TOTAL</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#4ade80' }}>
                            {totalHours.toFixed(2)} <span style={{ fontSize: '1rem' }}>h</span>
                        </div>
                    </div>

                    {/* User Selector */}
                    <Select
                        value={selectedUserId}
                        onChange={setSelectedUserId}
                        style={{ width: 280 }}
                        size="large"
                        loading={usersLoading}
                        options={usersList.map(u => ({
                            label: (
                                <Space>
                                    <Avatar size="small" style={{ backgroundColor: '#333' }}>{u.full_name?.[0]}</Avatar>
                                    {u.full_name}
                                </Space>
                            ),
                            value: u.id
                        }))}
                        showSearch
                        filterOption={(input, option) =>
                            option.label.props.children[1].toLowerCase().includes(input.toLowerCase())
                        }
                        styles={{ popup: { backgroundColor: '#1f1f1f' } }}
                    />
                </div>
            </div>

            {/* Toolbar / Filter Bar */}
            <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(10px)',
                padding: '12px 20px',
                borderRadius: 16,
                marginBottom: 24,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <Space size={16}>
                    <Button
                        type="text"
                        icon={<LeftOutlined />}
                        onClick={goToPreviousWeek}
                        style={{ color: '#fff' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CalendarOutlined style={{ color: '#1677ff' }} />
                        <span style={{ fontSize: 16, fontWeight: 500, color: '#fff' }}>
                            {weekLabel}
                        </span>
                    </div>
                    <Button
                        type="text"
                        icon={<RightOutlined />}
                        onClick={goToNextWeek}
                        style={{ color: '#fff' }}
                    />
                </Space>

                <Button onClick={goToToday} style={{ borderRadius: 20 }}>
                    Current Week
                </Button>
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
                    dataSource={workLogs}
                    columns={columns}
                    rowKey="id"
                    loading={logsLoading}
                    pagination={false}
                    rowClassName="modern-row"
                    locale={{ emptyText: <div style={{ padding: 40, color: '#666' }}>No entries found.</div> }}
                />
            </Card>

            <style>{`
                .modern-row td {
                    background: transparent !important;
                    border-bottom: 1px solid #303030 !important;
                    padding: 16px 24px !important;
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
                    color: #888 !important;
                    border-bottom: 1px solid #303030 !important;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    padding: 16px 24px !important;
                }
                .editable-duration-cell {
                    cursor: pointer;
                    padding: 8px 16px;
                    border-radius: 8px;
                    transition: all 0.2s;
                    display: inline-flex;
                    align-items: baseline;
                    background: rgba(74, 222, 128, 0.05); /* subtle green tint */
                }
                .editable-duration-cell:hover {
                    background: rgba(74, 222, 128, 0.15);
                    transform: scale(1.05);
                }
                .ant-select-selector {
                    background-color: #1f1f1f !important;
                    border-color: #303030 !important;
                    color: white !important;
                    border-radius: 12px !important;
                }
                .ant-select-arrow {
                    color: #888 !important;
                }
            `}</style>
        </div>
    )
}

export default BillableHoursPage
