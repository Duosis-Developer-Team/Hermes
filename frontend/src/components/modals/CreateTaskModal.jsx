/**
 * =============================================================================
 * HERMES - Create / Edit Task Modal
 * =============================================================================
 * Mirrors Hermes Ant Design modal style. Reuses customer/project selectors
 * from existing core API and the task-only sub-projects API.
 * =============================================================================
 */

import { useEffect, useMemo } from 'react'
import {
    Modal,
    Form,
    Input,
    Select,
    DatePicker,
    InputNumber,
    Alert,
    Space,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'

import {
    customerService,
    projectService,
    taskSubProjectService,
} from '../../services/api'

const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
]

function CreateTaskModal({
    open,
    onClose,
    onSubmit,
    initialDate,
    editingTask = null,
    assignableUsers = [],
    isAdmin = false,
    loading = false,
}) {
    const [form] = Form.useForm()
    const isEditing = !!editingTask

    const customerId = Form.useWatch('customer_id', form)
    const projectId = Form.useWatch('project_id', form)

    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => customerService.getAll(),
        enabled: open,
    })

    const { data: projects = [] } = useQuery({
        queryKey: ['projects'],
        queryFn: () => projectService.getAll(),
        enabled: open,
    })

    const filteredProjects = useMemo(() => {
        if (!customerId) return []
        return projects.filter((p) => p.customer_id === customerId)
    }, [projects, customerId])

    const { data: subProjects = [], isFetching: subProjectsLoading } = useQuery({
        queryKey: ['task-sub-projects', customerId, projectId],
        queryFn: () =>
            taskSubProjectService.list({
                customer_id: customerId,
                project_id: projectId,
            }),
        enabled: open && !!customerId && !!projectId,
    })

    useEffect(() => {
        if (!open) return
        if (editingTask) {
            form.setFieldsValue({
                customer_id: editingTask.customer_id,
                project_id: editingTask.project_id,
                sub_project_id: editingTask.sub_project_id,
                assignee_user_id: editingTask.assignee_user?.id,
                title: editingTask.title,
                description: editingTask.description || '',
                scheduled_date: editingTask.scheduled_date
                    ? dayjs(editingTask.scheduled_date)
                    : null,
                due_date: editingTask.due_date ? dayjs(editingTask.due_date) : null,
                estimated_duration_minutes:
                    editingTask.estimated_duration_minutes || null,
                priority: editingTask.priority || 'medium',
            })
        } else {
            form.resetFields()
            if (initialDate) {
                form.setFieldsValue({
                    scheduled_date: dayjs(initialDate),
                    priority: 'medium',
                })
            } else {
                form.setFieldsValue({ priority: 'medium' })
            }
        }
    }, [open, editingTask, initialDate, form])

    const handleCustomerChange = () => {
        form.setFieldsValue({ project_id: undefined, sub_project_id: undefined })
    }

    const handleProjectChange = () => {
        form.setFieldsValue({ sub_project_id: undefined })
    }

    const handleFinish = async (values) => {
        const scheduled = values.scheduled_date?.format('YYYY-MM-DD')
        const due = values.due_date ? values.due_date.format('YYYY-MM-DD') : null
        if (due && scheduled && due < scheduled) {
            form.setFields([
                {
                    name: 'due_date',
                    errors: ['Due date cannot be before the scheduled date.'],
                },
            ])
            return
        }
        const payload = {
            customer_id: values.customer_id,
            project_id: values.project_id,
            sub_project_id: values.sub_project_id,
            assignee_user_id: values.assignee_user_id,
            title: values.title?.trim(),
            description: values.description || null,
            scheduled_date: scheduled,
            due_date: due,
            estimated_duration_minutes:
                values.estimated_duration_minutes != null
                    ? Number(values.estimated_duration_minutes)
                    : null,
            priority: values.priority || 'medium',
        }
        await onSubmit(payload, editingTask?.id)
    }

    const noAssignableUsers = assignableUsers.length === 0
    const showSubProjectsEmpty =
        customerId && projectId && !subProjectsLoading && subProjects.length === 0

    return (
        <Modal
            title={isEditing ? 'Edit Task' : 'Create Task'}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : 'Create Task'}
            cancelText="Cancel"
            confirmLoading={loading}
            onOk={() => form.submit()}
            width={640}
            destroyOnClose
        >
            <Form
                form={form}
                layout="vertical"
                requiredMark
                onFinish={handleFinish}
                initialValues={{ priority: 'medium' }}
            >
                {!isEditing && noAssignableUsers && !isAdmin && (
                    <Alert
                        type="warning"
                        message="No assignable users are available. Please contact an administrator."
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                )}

                <Form.Item
                    label="Customer"
                    name="customer_id"
                    rules={[{ required: true, message: 'Customer is required.' }]}
                >
                    <Select
                        showSearch
                        placeholder="Select customer"
                        onChange={handleCustomerChange}
                        optionFilterProp="label"
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                    />
                </Form.Item>

                <Form.Item
                    label="Project"
                    name="project_id"
                    rules={[{ required: true, message: 'Project is required.' }]}
                >
                    <Select
                        showSearch
                        placeholder={
                            customerId
                                ? 'Select project'
                                : 'Select a customer first'
                        }
                        disabled={!customerId}
                        onChange={handleProjectChange}
                        optionFilterProp="label"
                        options={filteredProjects.map((p) => ({
                            value: p.id,
                            label: p.name,
                        }))}
                    />
                </Form.Item>

                <Form.Item
                    label="Sub Project"
                    name="sub_project_id"
                    rules={[{ required: true, message: 'Sub project is required.' }]}
                    extra={
                        showSubProjectsEmpty ? (
                            <span style={{ color: '#ff7875' }}>
                                No task sub-projects are available for this project.
                            </span>
                        ) : null
                    }
                >
                    <Select
                        showSearch
                        placeholder={
                            projectId
                                ? 'Select sub project'
                                : 'Select a project first'
                        }
                        disabled={!projectId}
                        loading={subProjectsLoading}
                        optionFilterProp="label"
                        options={subProjects.map((s) => ({ value: s.id, label: s.name }))}
                    />
                </Form.Item>

                <Form.Item
                    label="Assignee"
                    name="assignee_user_id"
                    rules={[{ required: true, message: 'Assignee is required.' }]}
                >
                    <Select
                        showSearch
                        placeholder={
                            noAssignableUsers
                                ? 'No assignable users'
                                : 'Select assignee'
                        }
                        disabled={noAssignableUsers}
                        optionFilterProp="label"
                        options={assignableUsers.map((u) => ({
                            value: u.id,
                            label: u.full_name || u.email,
                        }))}
                    />
                </Form.Item>

                <Form.Item
                    label="Title"
                    name="title"
                    rules={[
                        { required: true, message: 'Title is required.' },
                        { max: 255, message: 'Max 255 characters.' },
                    ]}
                >
                    <Input maxLength={255} placeholder="Short, action-oriented title" />
                </Form.Item>

                <Form.Item label="Description" name="description">
                    <Input.TextArea
                        rows={3}
                        placeholder="Optional additional context for the assignee"
                    />
                </Form.Item>

                <Space size="middle" style={{ display: 'flex' }}>
                    <Form.Item
                        label="Scheduled Date"
                        name="scheduled_date"
                        rules={[
                            { required: true, message: 'Scheduled date is required.' },
                        ]}
                        style={{ flex: 1 }}
                    >
                        <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                    </Form.Item>

                    <Form.Item label="Due Date" name="due_date" style={{ flex: 1 }}>
                        <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                    </Form.Item>
                </Space>

                <Space size="middle" style={{ display: 'flex' }}>
                    <Form.Item
                        label="Estimated Duration (minutes)"
                        name="estimated_duration_minutes"
                        style={{ flex: 1 }}
                    >
                        <InputNumber
                            min={1}
                            step={15}
                            style={{ width: '100%' }}
                            placeholder="e.g. 90"
                        />
                    </Form.Item>

                    <Form.Item
                        label="Priority"
                        name="priority"
                        rules={[{ required: true }]}
                        style={{ flex: 1 }}
                    >
                        <Select options={PRIORITY_OPTIONS} />
                    </Form.Item>
                </Space>
            </Form>
        </Modal>
    )
}

export default CreateTaskModal
