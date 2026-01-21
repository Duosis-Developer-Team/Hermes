/**
 * =============================================================================
 * HERMES - Plan Time Modal Component (Jira Tempo Style)
 * =============================================================================
 * Süre Planla modal'ı - Extra fields: Description, Repeat, Reviewer, Status
 * =============================================================================
 */

import { useState, useEffect } from 'react'
import {
    Modal, Form, Select, DatePicker, TimePicker, InputNumber,
    Checkbox, Button, Input
} from 'antd'
import {
    FastForwardOutlined,
    SettingOutlined,
    SearchOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { customerService, projectService, authService } from '../../services/api'
import './PlanTimeModal.css'

const { TextArea } = Input

function PlanTimeModal({
    open,
    onClose,
    onSubmit,
    initialDate,
    loading = false
}) {
    const [form] = Form.useForm()
    const [selectedCustomerId, setSelectedCustomerId] = useState(null)
    const [includeNonWorkingDays, setIncludeNonWorkingDays] = useState(false)
    const [showExtraFields, setShowExtraFields] = useState(false)
    const [issueSearch, setIssueSearch] = useState('')

    // API Queries - sadece modal açıkken çalışsın
    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => customerService.getAll(),
        enabled: open,
    })

    const { data: allProjects = [] } = useQuery({
        queryKey: ['projects'],
        queryFn: () => projectService.getAll(),
        enabled: open,
    })

    const { data: users = [] } = useQuery({
        queryKey: ['users'],
        queryFn: () => authService.getUsers(),
        enabled: open,
    })

    // Seçilen müşterinin projeleri
    const filteredProjects = allProjects.filter(
        p => p.customer_id === selectedCustomerId
    )

    // Modal açıldığında reset
    useEffect(() => {
        if (open) {
            const defaultDate = initialDate ? dayjs(initialDate) : dayjs()
            form.setFieldsValue({
                start_date: defaultDate,
                end_date: defaultDate,
                start_time: dayjs().hour(9).minute(0),
                end_time: dayjs().hour(18).minute(0),
                planned_hours: 0,
                distribution: 'per_day',
                repeat: 'never',
                status: 'pending',
            })
        }
    }, [open, initialDate, form])

    // Modal kapandığında reset
    const handleClose = () => {
        setSelectedCustomerId(null)
        setIncludeNonWorkingDays(false)
        setShowExtraFields(false)
        setIssueSearch('')
        form.resetFields()
        onClose?.()
    }

    // Müşteri değiştiğinde
    const handleCustomerChange = (customerId) => {
        setSelectedCustomerId(customerId)
        form.setFieldValue('project_id', undefined)
    }

    // Form submit
    const handleSubmit = async () => {
        try {
            const values = await form.validateFields()
            const data = {
                customer_id: selectedCustomerId,
                project_id: values.project_id,
                start_date: values.start_date.format('YYYY-MM-DD'),
                end_date: values.end_date.format('YYYY-MM-DD'),
                start_time: values.start_time?.format('HH:mm'),
                end_time: values.end_time?.format('HH:mm'),
                planned_hours: values.planned_hours,
                distribution: values.distribution,
                include_non_working_days: includeNonWorkingDays,
                description: values.description,
                repeat: values.repeat,
                reviewer_id: values.reviewer_id,
                status: values.status,
                is_planned: true,
            }
            onSubmit?.(data)
            handleClose()
        } catch (error) {
            console.error('Validation failed:', error)
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={520}
            className="plan-time-modal"
            title={null}
            closable={true}
        >
            <Form form={form} layout="vertical" className="plan-time-form">
                {/* Issue Search */}
                <div className="issue-search-wrapper">
                    <Input
                        placeholder="Search issues"
                        prefix={<SearchOutlined />}
                        value={issueSearch}
                        onChange={(e) => setIssueSearch(e.target.value)}
                        className="issue-search-input"
                    />
                </div>

                {/* Customer & Project Selection */}
                <div className="form-row">
                    <Form.Item
                        name="customer_id"
                        rules={[{ required: true, message: 'Required' }]}
                    >
                        <Select
                            placeholder="Select customer"
                            showSearch
                            optionFilterProp="label"
                            options={customers.map(c => ({ value: c.id, label: c.name }))}
                            onChange={handleCustomerChange}
                        />
                    </Form.Item>

                    <Form.Item
                        name="project_id"
                        rules={[{ required: true, message: 'Required' }]}
                    >
                        <Select
                            placeholder="Select project"
                            showSearch
                            optionFilterProp="label"
                            options={filteredProjects.map(p => ({ value: p.id, label: p.name }))}
                            disabled={!selectedCustomerId}
                        />
                    </Form.Item>
                </div>

                {/* Include non-working days */}
                <Checkbox
                    checked={includeNonWorkingDays}
                    onChange={(e) => setIncludeNonWorkingDays(e.target.checked)}
                    className="non-working-checkbox"
                >
                    Include non-working days
                </Checkbox>

                {/* Date & Time Row */}
                <div className="form-row four-cols">
                    <Form.Item
                        name="start_date"
                        label="Start Date"
                        rules={[{ required: true }]}
                    >
                        <DatePicker format="DD/MMM/YY" style={{ width: '100%' }} />
                    </Form.Item>

                    <Form.Item
                        name="end_date"
                        label="End Date"
                        rules={[{ required: true }]}
                    >
                        <DatePicker format="DD/MMM/YY" style={{ width: '100%' }} />
                    </Form.Item>

                    <Form.Item
                        name="start_time"
                        label="Start time"
                    >
                        <TimePicker format="HH:mm" style={{ width: '100%' }} />
                    </Form.Item>

                    <Form.Item
                        name="end_time"
                        label="End time"
                    >
                        <TimePicker format="HH:mm" style={{ width: '100%' }} />
                    </Form.Item>
                </div>

                {/* Planned Time & Distribution */}
                <div className="form-row">
                    <Form.Item
                        name="planned_hours"
                        label="Planned time"
                        rules={[{ required: true }]}
                    >
                        <InputNumber
                            min={0}
                            max={100}
                            step={0.5}
                            suffix="h"
                            style={{ width: '100%' }}
                            placeholder="0h"
                        />
                    </Form.Item>

                    <Form.Item
                        name="distribution"
                        rules={[{ required: true }]}
                    >
                        <Select
                            options={[
                                { value: 'per_day', label: 'Per day' },
                                { value: 'per_week', label: 'Per week' },
                                { value: 'total', label: 'Total' },
                            ]}
                        />
                    </Form.Item>
                </div>

                {/* Toggle Extra Fields */}
                <div
                    className="toggle-extra-fields"
                    onClick={() => setShowExtraFields(!showExtraFields)}
                >
                    {showExtraFields ? 'Hide extra fields ▲' : 'Hide extra fields ▼'}
                </div>

                {/* Extra Fields */}
                {showExtraFields && (
                    <div className="extra-fields">
                        {/* Description */}
                        <Form.Item name="description" label="Description">
                            <TextArea
                                rows={2}
                                placeholder="Add a detailed plan description here"
                            />
                        </Form.Item>

                        {/* Repeat */}
                        <Form.Item name="repeat" label="Repeat">
                            <Select
                                options={[
                                    { value: 'never', label: 'Never' },
                                    { value: 'daily', label: 'Daily' },
                                    { value: 'weekly', label: 'Weekly' },
                                    { value: 'monthly', label: 'Monthly' },
                                ]}
                            />
                        </Form.Item>

                        {/* Reviewer & Status */}
                        <div className="form-row">
                            <Form.Item name="reviewer_id" label="Reviewer">
                                <Select
                                    placeholder="Select reviewer"
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    options={users?.map?.(u => ({
                                        value: u.id,
                                        label: u.full_name || u.email
                                    })) || []}
                                />
                            </Form.Item>

                            <Form.Item name="status" label="Status">
                                <Select
                                    options={[
                                        { value: 'pending', label: 'Pending' },
                                        { value: 'approved', label: 'Approved' },
                                        { value: 'rejected', label: 'Rejected' },
                                    ]}
                                />
                            </Form.Item>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="form-actions">
                    <Button
                        type="primary"
                        onClick={handleSubmit}
                        loading={loading}
                    >
                        Plan Time
                    </Button>
                    <Button onClick={handleClose}>Cancel</Button>
                </div>
            </Form>
        </Modal>
    )
}

export default PlanTimeModal
