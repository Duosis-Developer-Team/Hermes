/**
 * =============================================================================
 * HERMES - Ticket → is kalemi (PM rework A6)
 * =============================================================================
 * Hub'daki bir ticket'tan is kalemi acar. Musteri/proje secilir; baslik
 * ve aciklama ticket'tan on-dolar; is CAGIRANA atanir (B4 — atama
 * yetkisi gerekmez) ve `origin_type='ticket'` ile kaynagina bagli kalir.
 * Ticket olay kumesine dokunulmaz (sozlesme donmus).
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { DatePicker, Form, Input, Modal, Select, message } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'

import { customerService, projectService } from '../../services/api'
import { ticketHubService } from '../../api/ticketsApi'
import { useT } from '../../i18n'

const { TextArea } = Input

const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const TYPES = ['task', 'issue', 'suggestion']

function ConvertToWorkItemModal({ open, ticket, onClose, onCreated }) {
    const t = useT()
    const [form] = Form.useForm()
    const [customerId, setCustomerId] = useState(null)

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

    useEffect(() => {
        if (!open || !ticket) return
        setCustomerId(null)
        form.setFieldsValue({
            customer_id: undefined,
            project_id: undefined,
            title: ticket.title || '',
            description: '',
            due_date: null,
            priority: ticket.priority === 'urgent' || ticket.priority === 'high'
                ? ticket.priority
                : 'medium',
            task_type: 'task',
        })
    }, [open, ticket, form])

    const create = useMutation({
        mutationFn: (payload) => ticketHubService.createWorkItem(ticket.id, payload),
        onSuccess: (detail) => {
            message.success(t('hub.workItemCreated'))
            onCreated?.(detail)
            form.resetFields()
            onClose?.()
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || err?.message || 'Failed to create work item.')
        },
    })

    const handleOk = async () => {
        if (create.isPending) return
        let values
        try {
            values = await form.validateFields()
        } catch {
            return
        }
        create.mutate({
            customer_id: values.customer_id,
            project_id: values.project_id,
            title: values.title?.trim() || undefined,
            description: values.description?.trim() || undefined,
            due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : undefined,
            priority: values.priority,
            task_type: values.task_type,
        })
    }

    const projectOptions = projects
        .filter((p) => !customerId || p.customer_id === customerId)
        .map((p) => ({ value: p.id, label: p.name }))

    return (
        <Modal
            open={open}
            title={t('hub.convertTitle')}
            onCancel={() => { if (!create.isPending) onClose?.() }}
            onOk={handleOk}
            okText={t('hub.createWorkItem')}
            confirmLoading={create.isPending}
            destroyOnHidden
        >
            <p style={{ color: 'var(--c-text-muted)', marginTop: 0 }}>{t('hub.convertHint')}</p>
            <Form form={form} layout="vertical">
                <Form.Item name="customer_id" label={t('entity.customer')} rules={[{ required: true }]}>
                    <Select
                        showSearch
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                        onChange={(val) => {
                            setCustomerId(val)
                            form.setFieldValue('project_id', undefined)
                        }}
                        filterOption={(input, option) =>
                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                    />
                </Form.Item>
                <Form.Item name="project_id" label={t('entity.project')} rules={[{ required: true }]}>
                    <Select
                        showSearch
                        options={projectOptions}
                        filterOption={(input, option) =>
                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                    />
                </Form.Item>
                <Form.Item name="title" label={t('hub.title')} rules={[{ required: true }]}>
                    <Input maxLength={255} />
                </Form.Item>
                <Form.Item name="description" label={t('common.description')}>
                    <TextArea rows={3} />
                </Form.Item>
                <div style={{ display: 'flex', gap: 12 }}>
                    <Form.Item name="task_type" label={t('board.new')} style={{ flex: 1 }}>
                        <Select options={TYPES.map((v) => ({ value: v, label: v }))} />
                    </Form.Item>
                    <Form.Item name="priority" label={t('hub.priority')} style={{ flex: 1 }}>
                        <Select options={PRIORITIES.map((v) => ({ value: v, label: v }))} />
                    </Form.Item>
                    <Form.Item name="due_date" label={t('task.dueDate')} style={{ flex: 1 }}>
                        <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                    </Form.Item>
                </div>
            </Form>
        </Modal>
    )
}

export default ConvertToWorkItemModal
