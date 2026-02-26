/**
 * =============================================================================
 * HERMES - Log Time Modal Component (Jira Tempo Style)
 * =============================================================================
 * Süre Kaydet modal'ı - Tüm alanlar: Activity Type, Platform, Work Line
 * Description required, Log another checkbox
 * =============================================================================
 */

import { useState, useEffect } from 'react'
import {
    Modal, Form, Input, Select, DatePicker, InputNumber,
    Button, Checkbox, message
} from 'antd'
import {
    ClockCircleOutlined,
    SearchOutlined,
    ArrowLeftOutlined,
    WarningOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
    customerService,
    projectService,
    workTypeService,
    activityTypeService,
    platformService,
    workLineService,
} from '../../services/api'
import './LogTimeModal.css'

const { TextArea } = Input

function LogTimeModal({
    open,
    onClose,
    onSubmit,
    initialDate,
    editingLog = null,
    loading = false,
    onLogAnother
}) {
    const [form] = Form.useForm()
    const [step, setStep] = useState(0) // 0: Customer, 1: Project, 2: Form
    const [selectedCustomerId, setSelectedCustomerId] = useState(null)
    const [selectedProjectId, setSelectedProjectId] = useState(null)
    const [issueSearch, setIssueSearch] = useState('')
    const [logAnother, setLogAnother] = useState(false)

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

    const { data: workTypes = [] } = useQuery({
        queryKey: ['workTypes'],
        queryFn: () => workTypeService.getAll(),
        enabled: open,
    })

    const { data: activityTypes = [] } = useQuery({
        queryKey: ['activityTypes'],
        queryFn: () => activityTypeService.getAll(),
        enabled: open,
    })

    const { data: platforms = [] } = useQuery({
        queryKey: ['platforms'],
        queryFn: () => platformService.getAll(),
        enabled: open,
    })

    const { data: workLines = [] } = useQuery({
        queryKey: ['workLines'],
        queryFn: () => workLineService.getAll(),
        enabled: open,
    })

    // Filter projects based on selected customer
    const filteredProjects = selectedCustomerId
        ? allProjects.filter(p => p.customer_id === selectedCustomerId)
        : []

    // Continue button state
    const canProceed = selectedCustomerId && selectedProjectId

    // Proje seçildiğinde
    const handleProjectSelect = (projectId) => {
        setSelectedProjectId(projectId)
        form.setFieldValue('project_id', projectId)
        form.setFieldValue('customer_id', selectedCustomerId)
        // Auto advance to form when project is selected?
        // Let's require a manual "Continue" or auto-advance. User asked for slide logic.
        // Let's keep manual "Continue" for now to be safe, or auto.
        // Actually, user said "slide logic", usually implies selecting moves you forward.
    }

    // Step navigation
    const nextStep = () => setStep(prev => prev + 1)
    const prevStep = () => setStep(prev => prev - 1)

    const handleProceed = () => {
        if (canProceed) {
            setStep(2)
        }
    }

    // Editing modunda form'u doldur
    useEffect(() => {
        if (editingLog && open) {
            console.log('Editing Log Data:', editingLog) // DEBUG
            setSelectedCustomerId(editingLog.customer_id)
            setSelectedProjectId(editingLog.project_id)
            setStep(2)
            form.setFieldsValue({
                project_id: editingLog.project_id,
                date_worked: dayjs(editingLog.date_worked),
                duration_hours: editingLog.duration_hours,
                description: editingLog.description,
                work_type_id: editingLog.work_type_id,
                activity_type_id: editingLog.activity_type_id || null,
                platform_id: editingLog.platform_id || null,
                work_line_id: editingLog.work_line_id || null,
            })
        } else if (open) {
            form.setFieldsValue({
                date_worked: initialDate ? dayjs(initialDate) : dayjs(),
                duration_hours: 0,
            })
        }
    }, [editingLog, open, initialDate, form])

    // Modal kapandığında reset
    const handleClose = () => {
        setStep(0)
        setSelectedCustomerId(null)
        setSelectedProjectId(null)
        setLogAnother(false)
        form.resetFields()
        onClose?.()
    }

    // Issue seçildiğinde
    const handleIssueSelect = (issue) => {
        setSelectedCustomerId(issue.customer_id)
        setSelectedProjectId(issue.id)
        form.setFieldValue('project_id', issue.id)
        form.setFieldValue('customer_id', issue.customer_id)
        setStep(2)
    }

    // Geri dön
    const handleBack = () => {
        // If in form (step 2)
        if (step === 2) setStep(1)
        // If in project select (step 1)
        else if (step === 1) setStep(0)
    }

    // Form submit
    const handleSubmit = async () => {
        try {
            const values = await form.validateFields()
            const data = {
                customer_id: selectedCustomerId,
                project_id: selectedProjectId || values.project_id,
                work_type_id: values.work_type_id,
                activity_type_id: values.activity_type_id || null,
                platform_id: values.platform_id || null,
                work_line_id: values.work_line_id || null,
                date_worked: values.date_worked.format('YYYY-MM-DD'),
                duration_hours: values.duration_hours,
                description: values.description,
            }

            await onSubmit?.(data, editingLog?.id)

            if (logAnother) {
                // Kayıt başarılı — formu sıfırla ama süre ve açıklama hariç her şeyi koru.
                const currentValues = form.getFieldsValue()

                form.resetFields()
                form.setFieldsValue({
                    project_id: selectedProjectId,
                    customer_id: selectedCustomerId,
                    date_worked: dayjs(currentValues.date_worked),
                    work_type_id: currentValues.work_type_id,
                    activity_type_id: currentValues.activity_type_id,
                    platform_id: currentValues.platform_id,
                    work_line_id: currentValues.work_line_id,
                    duration_hours: 0,
                    description: undefined
                })

                // Eğer edit modundaylaysak, parent'a edit modundan çıkmasını söyle (artık yeni kayıt girilecek)
                if (editingLog && onLogAnother) {
                    onLogAnother()
                }

                message.success('Saved! Ready for next entry.')
            } else {
                handleClose()
            }
        } catch (error) {
            console.error('Submit Error:', error)
            // AntD validasyon hataları
            if (error?.errorFields) {
                message.error('Lütfen zorunlu alanları doldurun.')
            } else {
                // Runtime JS hataları veya validation-dışı hatalar (örneğin date format vs)
                message.error('Beklenmeyen bir hata oluştu: ' + (error?.message || ''))
            }
            // API hataları mutation'ın onError'ı tarafından gösterildi,
            // modal açık kalır ve kullanıcı tekrar deneyebilir.
        }
    }

    // Seçilen proje bilgisi
    const selectedProject = allProjects.find(p => p.id === selectedProjectId)
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={480}
            className="log-time-modal"
            title={null}
            closable={true}
        >
            <Form form={form} layout="vertical" className="log-time-form">
                {/* Step 0: Customer Selection */}
                {step === 0 && (
                    <div className="log-time-step selection-step fade-in">
                        <div className="selection-wrapper">
                            <h3 style={{ marginBottom: 24, textAlign: 'center' }}>Select Customer</h3>
                            <Form.Item required>
                                <Select
                                    placeholder="Search Customer..."
                                    value={selectedCustomerId}
                                    onChange={(val) => {
                                        setSelectedCustomerId(val)
                                        setSelectedProjectId(null) // Reset project
                                        nextStep() // Auto advance to next step
                                    }}
                                    options={customers.map(c => ({ value: c.id, label: c.name }))}
                                    showSearch
                                    size="large"
                                    filterOption={(input, option) =>
                                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                    }
                                    style={{ width: '100%' }}
                                />
                            </Form.Item>

                            <div className="step-footer" style={{ textAlign: 'center', marginTop: 32 }}>
                                <span style={{ color: '#888' }}>Step 1 of 3</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 1: Project Selection */}
                {step === 1 && (
                    <div className="log-time-step selection-step fade-in">
                        <div className="selection-wrapper">
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
                                <Button
                                    type="text"
                                    icon={<ArrowLeftOutlined />}
                                    onClick={prevStep}
                                />
                                <h3 style={{ flex: 1, textAlign: 'center', margin: 0, marginRight: 32 }}>Select Project</h3>
                            </div>

                            <div style={{ marginBottom: 16, textAlign: 'center', color: '#1890ff' }}>
                                Customer: <strong>{selectedCustomer?.name}</strong>
                            </div>

                            <Form.Item required>
                                <Select
                                    placeholder="Search Project..."
                                    value={selectedProjectId}
                                    onChange={(val) => {
                                        handleProjectSelect(val)
                                        nextStep() // Auto advance
                                    }}
                                    options={filteredProjects.map(p => ({ value: p.id, label: p.name }))}
                                    showSearch
                                    size="large"
                                    filterOption={(input, option) =>
                                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                    }
                                    style={{ width: '100%' }}
                                />
                            </Form.Item>

                            <div className="step-footer" style={{ textAlign: 'center', marginTop: 32 }}>
                                <span style={{ color: '#888' }}>Step 2 of 3</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 2: Form */}
                {step === 2 && (
                    <div className="log-time-step form-step fade-in">
                        {/* Hidden Fields for Validation/Value persistence */}
                        <Form.Item name="project_id" hidden><Input /></Form.Item>
                        <Form.Item name="customer_id" hidden><Input /></Form.Item>

                        {/* Selected Issue Header */}
                        <div className="selected-issue-header">
                            <Button
                                type="text"
                                icon={<ArrowLeftOutlined />}
                                onClick={handleBack}
                                className="back-btn"
                            />
                            <span className="selected-issue-name">
                                {selectedProject?.name}
                            </span>
                            <span className="selected-issue-key">
                                {selectedCustomer?.code || selectedCustomer?.name}
                            </span>
                        </div>

                        {/* Date & Duration Row */}
                        <div className="form-row" style={{ alignItems: 'flex-start' }}>
                            <Form.Item
                                name="date_worked"
                                label="Date"
                                rules={[{ required: true, message: 'Required' }]}
                                style={{ flex: 1 }}
                            >
                                <DatePicker
                                    format="DD/MMM/YY"
                                    style={{ width: '100%' }}
                                    allowClear={false}
                                />
                            </Form.Item>

                            <div style={{ flex: 1 }}>
                                <Form.Item
                                    name="duration_hours"
                                    label="Duration"
                                    rules={[{ required: true, message: 'Required' }]}
                                    style={{ marginBottom: 8 }}
                                >
                                    <InputNumber
                                        min={0}
                                        max={24}
                                        step={0.25}
                                        suffix="h"
                                        style={{ width: '100%' }}
                                        placeholder="0h"
                                    />
                                </Form.Item>

                            </div>
                        </div>

                        {/* Description */}
                        <Form.Item
                            name="description"
                            label="Description"
                            rules={[{ required: true, message: 'Description is required' }]}
                        >
                            <TextArea
                                rows={2}
                                placeholder="What did you work on?"
                            />
                        </Form.Item>

                        {/* Work Type */}
                        <Form.Item
                            name="work_type_id"
                            label="Work Type"
                            rules={[{ required: true, message: 'Please select' }]}
                        >
                            <Select
                                placeholder="Please select"
                                showSearch
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                                options={[...workTypes]
                                    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                                    .map(w => ({ value: w.id, label: w.name }))}
                            />
                        </Form.Item>

                        {/* Activity Type */}
                        <Form.Item
                            name="activity_type_id"
                            label="Activity Type"
                        >
                            <Select
                                placeholder="Please select"
                                allowClear
                                showSearch
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                                options={[...activityTypes]
                                    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                                    .map(a => ({ value: a.id, label: a.name }))}
                            />
                        </Form.Item>

                        {/* Platform */}
                        <Form.Item
                            name="platform_id"
                            label="Platform"
                        >
                            <Select
                                placeholder="Please select"
                                allowClear
                                showSearch
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                                options={[...platforms]
                                    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                                    .map(p => ({ value: p.id, label: p.name }))}
                            />
                        </Form.Item>

                        {/* Work Line */}
                        <Form.Item
                            name="work_line_id"
                            label="Work Line"
                        >
                            <Select
                                placeholder="Please select"
                                allowClear
                                showSearch
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                                options={[...workLines]
                                    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                                    .map(w => ({ value: w.id, label: w.name }))}
                            />
                        </Form.Item>

                        {/* Show hidden fields link */}
                        <div className="show-hidden-fields">
                            Show hidden fields
                        </div>

                        {/* Actions */}
                        <div className="form-actions">
                            <Checkbox
                                checked={logAnother}
                                onChange={(e) => setLogAnother(e.target.checked)}
                            >
                                Log another
                            </Checkbox>

                            <div className="action-buttons">
                                <Button
                                    type="primary"
                                    onClick={handleSubmit}
                                    loading={loading}
                                >
                                    Log time
                                </Button>
                                <Button onClick={handleClose}>Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}
            </Form>
        </Modal>
    )
}

export default LogTimeModal
