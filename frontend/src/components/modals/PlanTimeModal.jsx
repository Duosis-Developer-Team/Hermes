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
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
]

function PlanTimeModal({
    open,
    onClose,
    onSubmit,
    initialDate,
    editingPlan = null,
    currentUserId = null,  // planı oluşturan kişi — listeden gizlenir
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
    // Planı oluşturan kişiyi listeden çıkar — creator otomatik ekleniyor
    const usersList = (usersResponse?.data || []).filter(u => u.id !== currentUserId)

    // Seçilen müşterinin projeleri
    const filteredProjects = allProjects.filter(
        p => p.customer_id === selectedCustomerId
    )

    // Modal açıldığında reset veya edit verileriyle doldur
    useEffect(() => {
        if (open) {
            if (editingPlan) {
                // Edit mode — mevcut değerlerle doldur
                setSelectedCustomerId(editingPlan.customer_id)
                form.setFieldsValue({
                    customer_id: editingPlan.customer_id,
                    project_id: editingPlan.project_id,
                    start_date: editingPlan.start_date ? dayjs(editingPlan.start_date) : null,
                    end_date: editingPlan.end_date ? dayjs(editingPlan.end_date) : null,
                    start_time: editingPlan.start_time ? dayjs(editingPlan.start_time, 'HH:mm') : null,
                    end_time: editingPlan.end_time ? dayjs(editingPlan.end_time, 'HH:mm') : null,
                    recurrence: ['weekly', 'monthly'].includes(editingPlan.recurrence)
                        ? editingPlan.recurrence
                        : 'one_time',
                    description: editingPlan.description || '',
                    user_ids: (editingPlan.assignments?.map(a => a.user_id) || []).filter(id => id !== currentUserId),
                })
            } else {
                // Create mode — default değerler
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
        }
    }, [open, initialDate, editingPlan, form])

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
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text-strong)' }}>
                        {editingPlan ? 'Edit Plan Time' : 'Plan Time'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 2 }}>
                        {editingPlan ? 'Update meeting details' : 'Create a meeting invite and assign to team members'}
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
                        optionRender={(option) => {
                            const assignment = editingPlan?.assignments?.find(
                                a => a.user_id === option.value
                            )
                            const status = assignment?.status
                            const badgeStyle = {
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                padding: '2px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                            }
                            const statusBadge = status === 'accepted'
                                ? <span style={{ ...badgeStyle, background: 'rgba(82,196,26,0.15)', color: '#52c41a' }}>Accepted</span>
                                : status === 'rejected'
                                ? <span style={{ ...badgeStyle, background: 'rgba(255,77,79,0.15)', color: '#ff4d4f' }}>Rejected</span>
                                : assignment
                                ? <span style={{ ...badgeStyle, background: 'rgba(250,173,20,0.15)', color: '#faad14' }}>Pending</span>
                                : null

                            return (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                    <span>{option.label}</span>
                                    {statusBadge}
                                </div>
                            )
                        }}
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
                        {editingPlan ? 'Save Changes' : 'Send Invite'}
                    </Button>
                    <Button onClick={handleClose}>Cancel</Button>
                </div>
            </Form>
        </Modal>
    )
}

export default PlanTimeModal
