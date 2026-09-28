/**
 * =============================================================================
 * HERMES - Efor gir penceresi (Hermes Liquid prototipi)
 * =============================================================================
 * Uc adim: musteri → proje → ayrintilar. Musteri/proje arama kutulu secenek
 * kartlariyla secilir (tiklayinca ilerler); ayrintilar bolumlu formdadir,
 * sure hizli cipleri HoursMinutesPicker ile ayni alani yazar. Dogrulama,
 * gonderim ve "bir kayit daha" davranisi degismedi.
 * =============================================================================
 */

import { useState, useEffect } from 'react'
import {
    Modal, Form, Input, Select, DatePicker,
    Button, Checkbox, message
} from 'antd'
import {
    ArrowLeftOutlined, ClockCircleOutlined, SearchOutlined,
} from '@ant-design/icons'
import { ChipGroup, FormSection, ModalHead, ModalSteps, OptionGrid } from '../liquid'
import HoursMinutesPicker from '../common/HoursMinutesPicker'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { typeMeta } from '../../utils/workItemType'
import {
    customerService,
    projectService,
    workTypeService,
    activityTypeService,
    platformService,
    workLineService,
    taskService,
} from '../../services/api'
import { queryKeys } from '../../query/queryKeys'
import './LogTimeModal.css'
import { useT } from '../../i18n'

const { TextArea } = Input

/**
 * Strip the auto-generated Microsoft Teams boilerplate from a meeting
 * body preview, leaving only the human-written description. Teams
 * appends a long underscore separator followed by the join block
 * ("Microsoft Teams meeting" / Join / Meeting ID / Passcode) and
 * sometimes forwarded-mail headers — none of which belong in a time
 * log. We cut at the first such marker and return the trimmed
 * remainder.
 */
function cleanMeetingBody(raw) {
    if (!raw) return ''
    let text = String(raw).replace(/\r\n/g, '\n')

    // 1) Teams' underscore separator that precedes the join block.
    const underscore = text.search(/_{5,}/)
    if (underscore !== -1) text = text.slice(0, underscore)

    // 2) Fallback markers if the separator was stripped by Graph's
    //    bodyPreview truncation (localized variants included).
    const markers = [
        /Microsoft Teams meeting/i,
        /Microsoft Teams Toplant/i,
        /Join the meeting now/i,
        /Toplant[ıi]ya kat[ıi]l/i,
        /Meeting ID:/i,
        /Toplant[ıi] kimli[ğg]i:/i,
    ]
    for (const m of markers) {
        const idx = text.search(m)
        if (idx !== -1) text = text.slice(0, idx)
    }

    return text.trim()
}

function LogTimeModal({
    open,
    onClose,
    onSubmit,
    initialDate,
    editingLog = null,
    loading = false,
    onLogAnother,
    /**
     * When provided (and not editingLog), the modal opens straight on the
     * form step with customer/project/description prefilled from the
     * given task. Used by Tasks → Log Time. Sub project is intentionally
     * ignored — Time Entry has its own work-line/platform taxonomy.
     * Shape: { customer_id, project_id, title, description, scheduled_date }
     */
    prefillTask = null,
    /**
     * When provided (and not editingLog), the modal opens at the
     * customer step (NOT the form) so the user picks customer + project
     * themselves — synced meetings don't carry that information. Date,
     * duration, and description are prefilled and read by the form once
     * the user reaches step 2. Used by Meetings → Log Time.
     * Shape: { id, subject, body_preview, sensitivity, start_datetime,
     *          end_datetime, duration_minutes }
     */
    prefillMeeting = null,
}) {
    const t = useT()
    const [form] = Form.useForm()
    const [step, setStep] = useState(0) // 0: Customer, 1: Project, 2: Form
    const [selectedCustomerId, setSelectedCustomerId] = useState(null)
    const [selectedProjectId, setSelectedProjectId] = useState(null)
    const [logAnother, setLogAnother] = useState(false)
    const [query, setQuery] = useState('')
    const watchedDate = Form.useWatch('date_worked', form)
    const watchedDuration = Form.useWatch('duration_hours', form)

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

    /*
     * PM rework A10 — istege bagli IS KALEMI secici. Yalniz SERBEST
     * giriste (Time Entry'den acilan modal) ve proje secildikten sonra
     * gorunur: gorevden/toplantidan acilan akista bag zaten cagirandan
     * gelir; duzenlemede bag degistirilmez. Liste = kullanicinin o
     * projede GORDUGU is kalemleri; terminal (completed/cancelled)
     * olanlar elenir. Secim `task_id` olarak gider; sunucu onu is
     * kalemine cozer (work_logs.work_item_id) ve log_time olayi yazar.
     */
    const showWorkItemPicker = Boolean(
        open && step === 2 && !editingLog && !prefillTask && selectedProjectId
    )
    const { data: projectItems = [] } = useQuery({
        queryKey: queryKeys.tasks.list({
            project_id: selectedProjectId, archive_state: 'active', purpose: 'log-time',
        }),
        queryFn: () => taskService.list({
            project_id: selectedProjectId, archive_state: 'active',
        }),
        enabled: showWorkItemPicker,
    })
    const workItemOptions = (Array.isArray(projectItems) ? projectItems : [])
        .filter((i) => i && i.status !== 'completed' && i.status !== 'cancelled')
        .map((i) => ({
            value: i.id,
            label: i.task_code ? `${i.task_code} - ${i.title}` : i.title,
        }))

    // Filter projects based on selected customer
    const filteredProjects = selectedCustomerId
        ? allProjects.filter(p => p.customer_id === selectedCustomerId)
        : []

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
    const nextStep = () => { setQuery(''); setStep(prev => prev + 1) }
    const prevStep = () => { setQuery(''); setStep(prev => prev - 1) }

    // Editing modunda form'u doldur
    useEffect(() => {
        if (editingLog && open) {
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
        } else if (prefillTask && open) {
            // Task-driven open — skip customer/project picker, prefill
            // the description from the task. Duration + Time-Entry-only
            // fields (work_type, activity, platform, work_line) stay
            // empty for the user to fill in manually.
            setSelectedCustomerId(prefillTask.customer_id)
            setSelectedProjectId(prefillTask.project_id)
            setStep(2)
            const title = prefillTask.title || ''
            const body = prefillTask.description || ''
            const tLabel = typeMeta(prefillTask.task_type).singular
            const description = body
                ? `${tLabel}: ${title}\n\n${body}`
                : `${tLabel}: ${title}`
            const dateValue = prefillTask.scheduled_date
                ? dayjs(prefillTask.scheduled_date)
                : initialDate
                ? dayjs(initialDate)
                : dayjs()
            form.setFieldsValue({
                customer_id: prefillTask.customer_id,
                project_id: prefillTask.project_id,
                date_worked: dateValue,
                duration_hours: null,
                description,
            })
        } else if (prefillMeeting && open) {
            // Meeting-driven open — STAY at the customer step. Synced
            // meetings don't carry Hermes customer/project; the user
            // picks them. Date, duration and description are
            // prefilled so when they reach the form step those
            // fields are already there.
            setSelectedCustomerId(null)
            setSelectedProjectId(null)
            setStep(0)
            const isPrivate =
                prefillMeeting.sensitivity === 'private' ||
                prefillMeeting.sensitivity === 'confidential'
            const subject = isPrivate
                ? 'Private Meeting'
                : prefillMeeting.subject || '(Untitled meeting)'
            const body = isPrivate
                ? ''
                : cleanMeetingBody(prefillMeeting.body_preview)
            // Title first, then the human description (if any). No
            // "Meeting:" prefix and no Teams join/forward boilerplate.
            const description = body ? `${subject}\n\n${body}` : subject
            const dateValue = prefillMeeting.start_datetime
                ? dayjs(prefillMeeting.start_datetime)
                : initialDate
                ? dayjs(initialDate)
                : dayjs()
            // Round to the existing Time Entry 15-minute step. Floor
            // never below 0.25 h (modal's minimum) so empty/zero
            // durations land on a valid value.
            const rawMin = Number(prefillMeeting.duration_minutes) || 0
            const quartersHours = Math.max(
                0.25,
                Math.round(rawMin / 15) / 4
            )
            form.setFieldsValue({
                date_worked: dateValue,
                duration_hours: quartersHours,
                description,
            })
        } else if (open) {
            form.setFieldsValue({
                date_worked: initialDate ? dayjs(initialDate) : dayjs(),
                duration_hours: null,
            })
        }
    }, [editingLog, prefillTask, prefillMeeting, open, initialDate, form])

    // Modal kapandığında reset
    const handleClose = () => {
        setStep(0)
        setQuery('')
        setSelectedCustomerId(null)
        setSelectedProjectId(null)
        setLogAnother(false)
        form.resetFields()
        onClose?.()
    }

    // Issue seçildiğinde
    // Geri dön
    const handleBack = () => {
        setQuery('')
        if (step === 2) setStep(1)
        else if (step === 1) setStep(0)
    }

    // Form submit
    const handleSubmit = async () => {
        // Cift gonderim kilidi KAYNAKTA (butonun loading render'ini
        // beklemeden).
        if (loading) return
        // 1) Validasyon — form hatasi KULLANICI hatasidir, burada
        //    bildirilir.
        let values
        try {
            values = await form.validateFields()
        } catch (error) {
            if (error?.errorFields) {
                message.error(t('logTime.fillRequired'))
            } else {
                message.error(`${t('logTime.unexpectedError')} ${error?.message || ''}`)
            }
            return
        }

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
        // A10: secici gorunuyorsa bag payload'a girer (bos → null).
        if (showWorkItemPicker) data.task_id = values.task_id || null

        // 2) Gonderim — API hatasinin SAHIBI cagiranin mutation'idir
        //    (onError zaten sunucunun mesajini gosterir). Burada IKINCI
        //    bir toast ATILMAZ ve console.error YAZILMAZ: modal ACIK
        //    kalir, girilen degerler KORUNUR, kullanici tekrar dener.
        try {
            await onSubmit?.(data, editingLog?.id)
        } catch {
            return
        }

        // 3) Basari — YALNIZCA burada modal kapanir/temizlenir.
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
                duration_hours: null,
                description: undefined
            })

            // Eğer edit modundaylaysak, parent'a edit modundan çıkmasını söyle (artık yeni kayıt girilecek)
            if (editingLog && onLogAnother) {
                onLogAnother()
            }

            message.success(t('logTime.savedReady'))
        } else {
            handleClose()
        }
    }

    // Seçilen proje bilgisi
    const selectedProject = allProjects.find(p => p.id === selectedProjectId)
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

    const q = query.trim().toLocaleLowerCase('tr')
    const matches = (label) => !q || String(label || '').toLocaleLowerCase('tr').includes(q)
    const customerOptions = customers
        .filter((c) => matches(c.name))
        .map((c) => {
            const n = allProjects.filter((p) => p.customer_id === c.id).length
            return { value: c.id, label: c.name, hint: t('logTime.projectCount', { count: n }) }
        })
    const projectOptions = filteredProjects
        .filter((p) => matches(p.name))
        .map((p) => ({ value: p.id, label: p.name, hint: p.code || selectedCustomer?.name, flat: true }))

    const durationChips = [0.25, 0.5, 1, 2, 4, 8].map((h) => ({
        value: h,
        label: h < 1 ? t('logTime.minShort', { n: Math.round(h * 60) }) : t('logTime.hourShort', { n: h }),
    }))
    const headDate = watchedDate || (initialDate ? dayjs(initialDate) : dayjs())
    const byLabel = (a, b) => a.name.localeCompare(b.name, 'tr')
    const selectFilter = (input, option) =>
        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={720}
            className="log-time-modal"
            title={(
                <ModalHead
                    icon={<ClockCircleOutlined />}
                    title={t('logTime.logTime')}
                    subtitle={dayjs(headDate).format('dddd, D MMMM YYYY')}
                />
            )}
            /* Pending'te yanlislikla kapanma KILITLI (§7 UX sozlesmesi):
               kayit sunucuya giderken Escape/mask/X ile cikip "kaydoldu
               mu?" belirsizligi yaratilamaz. */
            closable={!loading}
            maskClosable={!loading}
            keyboard={!loading}
        >
            <ModalSteps
                current={step}
                steps={[
                    { key: 'c', label: t('logTime.stepCustomer'), value: selectedCustomer?.name },
                    { key: 'p', label: t('logTime.stepProject'), value: selectedProject?.name },
                    { key: 'd', label: t('logTime.stepDetails') },
                ]}
            />
            <Form form={form} layout="vertical" className="log-time-form">
                {/* Adim 0: musteri */}
                {step === 0 && (
                    <div className="log-time-step fade-in">
                        <Input
                            autoFocus
                            allowClear
                            size="large"
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder={t('logTime.searchCustomer')}
                            aria-label={t('logTime.searchCustomer')}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="log-time-search"
                        />
                        <FormSection>{t('logTime.customers')}</FormSection>
                        <OptionGrid
                            ariaLabel={t('logTime.selectCustomer')}
                            options={customerOptions}
                            emptyText={t('logTime.noMatch')}
                            onPick={(id) => {
                                setSelectedCustomerId(id)
                                setSelectedProjectId(null)
                                nextStep()
                            }}
                        />
                    </div>
                )}

                {/* Adim 1: proje */}
                {step === 1 && (
                    <div className="log-time-step fade-in">
                        <button type="button" className="lq-back" onClick={prevStep} aria-label={t('logTime.backToPrevious')}>
                            <ArrowLeftOutlined aria-hidden="true" />{selectedCustomer?.name}
                        </button>
                        {filteredProjects.length > 6 && (
                            <Input
                                allowClear
                                prefix={<SearchOutlined aria-hidden="true" />}
                                placeholder={t('logTime.searchProject')}
                                aria-label={t('logTime.searchProject')}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="log-time-search"
                            />
                        )}
                        <OptionGrid
                            ariaLabel={t('logTime.selectProject')}
                            options={projectOptions}
                            emptyText={t('logTime.noMatch')}
                            onPick={(id) => {
                                handleProjectSelect(id)
                                nextStep()
                            }}
                        />
                    </div>
                )}

                {/* Adim 2: ayrintilar */}
                {step === 2 && (
                    <div className="log-time-step form-step fade-in">
                        <Form.Item name="project_id" hidden><Input /></Form.Item>
                        <Form.Item name="customer_id" hidden><Input /></Form.Item>

                        <button type="button" className="lq-back" onClick={handleBack} aria-label={t('logTime.backToPrevious')}>
                            <ArrowLeftOutlined aria-hidden="true" />
                            {selectedCustomer?.name}{selectedProject ? ` · ${selectedProject.name}` : ''}
                        </button>

                        <div className="lq-frm">
                            <FormSection>{t('logTime.groupWhen')}</FormSection>
                            <Form.Item
                                name="date_worked"
                                label={t('reports.date')}
                                rules={[{ required: true, message: t('logTime.required') }]}
                            >
                                <DatePicker format="D MMM YYYY" style={{ width: '100%' }} allowClear={false} />
                            </Form.Item>
                            <Form.Item
                                name="duration_hours"
                                label={t('logTime.duration')}
                                required
                                rules={[
                                    {
                                        validator: (_, val) => {
                                            if (val === null || val === undefined || val === '') {
                                                return Promise.reject('Duration is required')
                                            }
                                            if (val === 0) {
                                                return Promise.reject('Duration must be greater than 0')
                                            }
                                            const mins = Math.round((val - Math.floor(val)) * 60)
                                            if (mins % 15 !== 0) {
                                                return Promise.reject('Minutes must be in increments of 15 (0, 15, 30, 45).')
                                            }
                                            return Promise.resolve()
                                        }
                                    }
                                ]}
                            >
                                <HoursMinutesPicker />
                            </Form.Item>
                            <div className="lq-full log-time-quick">
                                <ChipGroup
                                    mono
                                    ariaLabel={t('logTime.quickDuration')}
                                    options={durationChips}
                                    value={watchedDuration}
                                    onChange={(v) => form.setFieldsValue({ duration_hours: v })}
                                />
                            </div>

                            <FormSection>{t('logTime.groupWhat')}</FormSection>
                            <Form.Item
                                className="lq-full"
                                name="description"
                                label={t('common.description')}
                                rules={[{ required: true, message: t('logTime.descriptionRequired') }]}
                            >
                                <TextArea rows={2} placeholder={t('logTime.whatDidYouWorkOn')} />
                            </Form.Item>

                            {/* A10: istege bagli is kalemi bagi (yalniz serbest giris). */}
                            {showWorkItemPicker && (
                                <Form.Item
                                    className="lq-full"
                                    name="task_id"
                                    label={t('logTime.workItem')}
                                    extra={t('logTime.workItemHint')}
                                >
                                    <Select
                                        allowClear
                                        showSearch
                                        placeholder={t('logTime.workItemPlaceholder')}
                                        options={workItemOptions}
                                        filterOption={selectFilter}
                                    />
                                </Form.Item>
                            )}

                            <Form.Item
                                name="work_type_id"
                                label={t('logTime.workType')}
                                rules={[{ required: true, message: t('logTime.pleaseSelect') }]}
                            >
                                <Select
                                    placeholder={t('logTime.pleaseSelect')}
                                    showSearch
                                    filterOption={selectFilter}
                                    options={[...workTypes].sort(byLabel).map(w => ({ value: w.id, label: w.name }))}
                                />
                            </Form.Item>
                            <Form.Item
                                name="activity_type_id"
                                label={t('logTime.activityType')}
                                required
                                rules={[{ required: true, message: t('logTime.activityTypeRequired') }]}
                            >
                                <Select
                                    placeholder={t('logTime.pleaseSelect')}
                                    showSearch
                                    filterOption={selectFilter}
                                    options={[...activityTypes].sort(byLabel).map(a => ({ value: a.id, label: a.name }))}
                                />
                            </Form.Item>
                            <Form.Item
                                name="platform_id"
                                label={t('logTime.platform')}
                                required
                                rules={[{ required: true, message: t('logTime.platformRequired') }]}
                            >
                                <Select
                                    placeholder={t('logTime.pleaseSelect')}
                                    showSearch
                                    filterOption={selectFilter}
                                    options={[...platforms].sort(byLabel).map(p => ({ value: p.id, label: p.name }))}
                                />
                            </Form.Item>
                            <Form.Item name="work_line_id" label={t('logTime.workLine')}>
                                <Select
                                    placeholder={t('logTime.pleaseSelect')}
                                    allowClear
                                    showSearch
                                    filterOption={selectFilter}
                                    options={[...workLines].sort(byLabel).map(w => ({ value: w.id, label: w.name }))}
                                />
                            </Form.Item>
                        </div>

                        <div className="lq-mf">
                            <span className="lq-mf__left">
                                <Checkbox checked={logAnother} onChange={(e) => setLogAnother(e.target.checked)}>
                                    {t('logTime.logAnother')}
                                </Checkbox>
                            </span>
                            <Button onClick={handleClose}>{t('common.cancel')}</Button>
                            <Button type="primary" onClick={handleSubmit} loading={loading}>{t('logTime.logTime')}</Button>
                        </div>
                    </div>
                )}
            </Form>
        </Modal>
    )
}

export default LogTimeModal
