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
import { TeamOutlined } from '@ant-design/icons'
import { ChipGroup, FormSection, ModalHead } from '../liquid'
import './PlanTimeModal.css'
import { useT } from '../../i18n'

const { TextArea } = Input

// Degerler API sozlesmesidir ve CEVRILMEZ; yalnizca etiket cevrilir.
// Liste modul duzeyinde kalamaz cunku ceviri bir hook'a baglidir.
const RECURRENCE_VALUES = [
    ['one_time', 'plan.oneTime'],
    ['weekly', 'plan.weekly'],
    ['monthly', 'plan.monthly'],
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
    const t = useT()
    const recurrenceOptions = RECURRENCE_VALUES.map(([value, key]) => ({
        value, label: t(key),
    }))
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

    /* Katilimci secimi yalniz ad gosterir → en az ayricalikli dizin
       ucu. Admin-only uc, plan olusturabilen ama users.manage'i olmayan
       kullanicida listeyi bos birakiyordu. */
    const { data: usersResponse } = useQuery({
        queryKey: ['users-lookup'],
        queryFn: () => authService.lookupUsers(),
        enabled: open,
    })
    // Planı oluşturan kişiyi listeden çıkar — creator otomatik ekleniyor
    const usersList = (Array.isArray(usersResponse) ? usersResponse : (usersResponse?.data || []))
        .filter(u => u.id !== currentUserId)

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
        /*
         * `currentUserId` GERCEK bir bagimlilik: plani olusturan kisi
         * atanan listesinden CIKARILIYOR. Prop degistiginde form yeniden
         * doldurulmali; eksik oldugu icin bayat bir filtre kalabiliyordu.
         * (Oturum sahibi oldugu icin pratikte stabildir — dongu riski yok.)
         */
    }, [open, initialDate, editingPlan, form, currentUserId])

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

    // Durum rozeti: renk YALNIZ ton sinifindan (lq-tag), metin i18n.
    const statusTag = (status, assigned) => {
        if (status === 'accepted') return <span className="lq-tag lq-tag--ok">{t('plan.accepted')}</span>
        if (status === 'rejected') return <span className="lq-tag lq-tag--bad">{t('plan.rejected')}</span>
        return assigned ? <span className="lq-tag lq-tag--warn">{t('plan.pending')}</span> : null
    }
    const timePicker = (
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
    )

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={640}
            className="plan-time-modal"
            title={(
                <ModalHead
                    icon={<TeamOutlined />}
                    tone="violet"
                    title={editingPlan ? t('plan.editTitle') : t('plan.title')}
                    subtitle={editingPlan ? t('plan.editSubtitle') : t('plan.subtitle')}
                />
            )}
            closable
        >
            <Form form={form} layout="vertical" className="plan-time-form lq-frm">
                <FormSection>{t('plan.groupWhere')}</FormSection>
                <Form.Item
                    name="customer_id"
                    label={t('entity.customer')}
                    rules={[{ required: true, message: t('logTime.required') }]}
                >
                    <Select
                        placeholder={t('plan.selectCustomer')}
                        showSearch
                        optionFilterProp="label"
                        options={customers.map(c => ({ value: c.id, label: c.name }))}
                        onChange={handleCustomerChange}
                    />
                </Form.Item>
                <Form.Item
                    name="project_id"
                    label={t('entity.project')}
                    rules={[{ required: true, message: t('logTime.required') }]}
                >
                    <Select
                        placeholder={t('plan.selectProject')}
                        showSearch
                        optionFilterProp="label"
                        options={filteredProjects.map(p => ({ value: p.id, label: p.name }))}
                        disabled={!selectedCustomerId}
                    />
                </Form.Item>

                <FormSection>{t('plan.groupWhen')}</FormSection>
                <Form.Item name="start_date" label={t('plan.startDate')} rules={[{ required: true }]}>
                    <DatePicker format="D MMM YYYY" style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="end_date" label={t('plan.endDate')} rules={[{ required: true }]}>
                    <DatePicker format="D MMM YYYY" style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="start_time" label={t('plan.startTime')}>{timePicker}</Form.Item>
                <Form.Item name="end_time" label={t('plan.endTime')}>{timePicker}</Form.Item>
                <Form.Item className="lq-full" name="recurrence" label={t('plan.recurrence')} rules={[{ required: true }]}>
                    <ChipGroup ariaLabel={t('plan.recurrence')} options={recurrenceOptions} />
                </Form.Item>

                <FormSection>{t('plan.groupWho')}</FormSection>
                <Form.Item
                    className="lq-full"
                    name="user_ids"
                    label={t('plan.assignTo')}
                    rules={[{ required: true, message: t('plan.atLeastOneUser') }]}
                >
                    <Select
                        mode="multiple"
                        placeholder={t('plan.selectMembers')}
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
                            return (
                                <div className="plan-time-option">
                                    <span>{option.label}</span>
                                    {statusTag(assignment?.status, Boolean(assignment))}
                                </div>
                            )
                        }}
                        maxTagCount={4}
                    />
                </Form.Item>
                <Form.Item className="lq-full" name="description" label={t('common.description')}>
                    <TextArea rows={2} placeholder={t('plan.meetingDescription')} />
                </Form.Item>

                <div className="lq-mf lq-full">
                    <Button onClick={handleClose}>{t('common.cancel')}</Button>
                    <Button type="primary" onClick={handleSubmit} loading={loading}>
                        {editingPlan ? t('taskModal.saveChanges') : t('plan.sendInvite')}
                    </Button>
                </div>
            </Form>
        </Modal>
    )
}

export default PlanTimeModal
