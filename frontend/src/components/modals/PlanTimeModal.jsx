/**
 * =============================================================================
 * HERMES - Plan Time Modal (Admin-Driven Meeting Invite System)
 * =============================================================================
 * Sadece Admin kullanabilir. MS Teams daveti mantığında: Admin bir plan
 * oluşturur, seçilen kullanıcılara atanır. Her kullanıcı kendi takviminde
 * Accept/Reject yapabilir.
 * =============================================================================
 */

import { useState, useEffect } from 'react'
import {
    Modal, Form, Select, DatePicker, TimePicker,
    Button, Input
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { customerService, projectService, authService } from '../../services/api'
import './PlanTimeModal.css'

const { TextArea } = Input

const RECURRENCE_OPTIONS = [
    { value: 'one_time', label: 'One-Time' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
]

function PlanTimeModal({
    open,
    onClose,
    onSubmit,
    initialDate,
    loading = false
}) {
    const [form] = Form.useForm()
    const [selectedCustomerId, setSelectedCustomerId] = useState(null)

    // Data fetching — sadece modal açıkken
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

    const { data: usersResponse } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.getUsers(),
        enabled: open,
    })
    const usersList = usersResponse?.data || []

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
                recurrence: 'one_time',
                user_ids: [],
            })
            setSelectedCustomerId(null)
        }
    }, [open, initialDate, form])

    const handleClose = () => {
        setSelectedCustomerId(null)
        form.resetFields()
        onClose?.()
    }

    const handleCustomerChange = (customerId) => {
        setSelectedCustomerId(customerId)
        form.setFieldValue('project_id', undefined)
    }

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields()
            const payload = {
                customer_id: selectedCustomerId,
                project_id: values.project_id,
                start_date: values.start_date.format('YYYY-MM-DD'),
                end_date: values.end_date.format('YYYY-MM-DD'),
                start_time: values.start_time?.format('HH:mm') || null,
                end_time: values.end_time?.format('HH:mm') || null,
                recurrence: values.recurrence,
                description: values.description || null,
                user_ids: values.user_ids || [],
            }
            onSubmit?.(payload)
            handleClose()
        } catch {
            // Validation hataları form tarafından gösterilir
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={540}
            className="plan-time-modal"
            title={
                <div style={{ padding: '4px 0' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
                        Plan Time
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                        Create a meeting invite and assign to team members
                    </div>
                </div>
            }
            closable
        >
            <Form form={form} layout="vertical" className="plan-time-form" style={{ marginTop: 8 }}>

                {/* Customer & Project */}
                <div className="form-row">
                    <Form.Item
                        name="customer_id"
                        label="Customer"
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
                        label="Project"
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

                {/* Date & Time */}
                <div className="form-row four-cols">
                    <Form.Item name="start_date" label="Start Date" rules={[{ required: true }]}>
                        <DatePicker format="DD/MMM/YY" style={{ width: '100%' }} />
                    </Form.Item>

                    <Form.Item name="end_date" label="End Date" rules={[{ required: true }]}>
                        <DatePicker format="DD/MMM/YY" style={{ width: '100%' }} />
                    </Form.Item>

                    <Form.Item name="start_time" label="Start Time">
                        <TimePicker
                            format="HH:mm"
                            style={{ width: '100%' }}
                            minuteStep={15}
                            disabledTime={() => ({
                                disabledHours: () => [0,1,2,3,4,5,6,7,8,18,19,20,21,22,23]
                            })}
                            hideDisabledOptions
                            popupClassName="plan-time-picker-popup"
                            needConfirm={false}
                        />
                    </Form.Item>

                    <Form.Item name="end_time" label="End Time">
                        <TimePicker
                            format="HH:mm"
                            style={{ width: '100%' }}
                            minuteStep={15}
                            disabledTime={() => ({
                                disabledHours: () => [0,1,2,3,4,5,6,7,8,18,19,20,21,22,23]
                            })}
                            hideDisabledOptions
                            popupClassName="plan-time-picker-popup"
                            needConfirm={false}
                        />
                    </Form.Item>
                </div>

                {/* Recurrence */}
                <Form.Item name="recurrence" label="Recurrence" rules={[{ required: true }]}>
                    <Select options={RECURRENCE_OPTIONS} />
                </Form.Item>

                {/* Assign Users */}
                <Form.Item
                    name="user_ids"
                    label="Assign To"
                    rules={[{ required: true, message: 'At least one user must be selected' }]}
                >
                    <Select
                        mode="multiple"
                        placeholder="Select team members..."
                        showSearch
                        optionFilterProp="label"
                        options={usersList.map(u => ({
                            value: u.id,
                            label: u.full_name || u.email,
                        }))}
                        maxTagCount={4}
                    />
                </Form.Item>

                {/* Description */}
                <Form.Item name="description" label="Description">
                    <TextArea
                        rows={2}
                        placeholder="Add a meeting description or agenda..."
                    />
                </Form.Item>

                {/* Actions */}
                <div className="form-actions">
                    <Button
                        type="primary"
                        onClick={handleSubmit}
                        loading={loading}
                    >
                        Send Invite
                    </Button>
                    <Button onClick={handleClose}>Cancel</Button>
                </div>
            </Form>
        </Modal>
    )
}

export default PlanTimeModal
