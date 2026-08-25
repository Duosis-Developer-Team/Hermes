/**
 * =============================================================================
 * HERMES - Yeni destek talebi
 * =============================================================================
 * Hedef ekip DEĞİŞTİRİLEMEZ bir bilgi kutusudur (D-004): son kullanıcı
 * ekip seçmez. Route yoksa gönderim kapalıdır ve "genel bir gruba"
 * sessizce düşmez.
 *
 * Otomatik tanılama ÖNCE GÖSTERİLİR: kullanıcı ne gönderdiğini görür.
 * Toplanan alanlar allowlist'tir — cookie, token, form değeri, query
 * string ASLA toplanmaz (bu bileşen onları OKUMAZ bile).
 */
import { useMemo, useState } from 'react'
import { Alert, Form, Input, Select, Typography } from 'antd'

import { supportPortalService } from '../../api/ticketsApi'
import { AppModal, Stack, StatusBadge } from '../../components/ui'
import AttachmentDropzone from './AttachmentDropzone'
import { readyAttachmentIds } from './attachmentState'
import { CATEGORY_LABELS, IMPACT_HINTS, IMPACT_LABELS } from './constants'
import './tickets.css'

const { Text } = Typography

/** Guvenli tanilama — ALLOWLIST. Yeni bir alan eklemek bilincli bir
 *  gizlilik kararidir; buraya yazilmayan hicbir sey gonderilmez. */
function collectDiagnostics() {
    if (typeof window === 'undefined') return {}
    const path = window.location?.pathname || ''
    return {
        environment: import.meta.env?.MODE || 'production',
        // Query string ve fragment KESILIR (kimlik/token tasiyabilir).
        page_path: path.split('?')[0].split('#')[0],
        browser: (navigator.userAgent || '').slice(0, 120),
        os: navigator.platform || undefined,
        locale: navigator.language || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        client_timestamp: new Date().toISOString(),
    }
}

export default function CreateTicketModal({
    open, onCancel, onSubmit, pending, groupName, routeReady,
    attachmentsEnabled = false,
}) {
    const [form] = Form.useForm()
    const [attachments, setAttachments] = useState([])
    // Idempotency anahtari MODAL ACILISINDA uretilir ve retry'larda
    // AYNI kalir: ag hatasi sonrasi "tekrar dene", ikinci bir ticket
    // ACMAZ.
    const [idempotencyKey] = useState(
        () => `portal-${crypto.randomUUID?.() ?? Date.now()}`,
    )
    const diagnostics = useMemo(collectDiagnostics, [open])

    const handleOk = async () => {
        let values
        try {
            values = await form.validateFields()
        } catch {
            // Alan hatalarini AntD gosterir; sessiz bir rejection
            // birakmak konsolu kirletir ve gercek hatalari gizler.
            return
        }
        onSubmit({
            title: values.title,
            description: values.description,
            category: values.category,
            impact: values.impact,
            reproduction_steps: values.reproduction_steps || null,
            expected_result: values.expected_result || null,
            actual_result: values.actual_result || null,
            error_code: values.error_code || null,
            client_context: diagnostics,
            // YALNIZCA taramasi bitmis ve temiz ekler gonderilir.
            attachment_ids: readyAttachmentIds(attachments),
        }, idempotencyKey)
    }

    return (
        <AppModal
            open={open}
            title="New support request"
            okText="Submit"
            cancelText="Cancel"
            onCancel={onCancel}
            onOk={handleOk}
            pending={pending}
            confirmLoading={pending}
            okButtonProps={{ disabled: !routeReady }}
            destroyOnHidden
            width={680}
        >
            <Stack gap={3}>
                {routeReady ? (
                    <Alert
                        type="info"
                        showIcon
                        message={(
                            <span>
                                This request will go to the{' '}
                                <strong>{groupName}</strong> team.
                            </span>
                        )}
                        description="The target team comes from the routing configuration and cannot be changed here."
                    />
                ) : (
                    <Alert
                        type="warning"
                        showIcon
                        message="Support routing has not been configured yet"
                        description="Requests cannot be submitted. Please contact your administrator."
                    />
                )}

                <Form form={form} layout="vertical" preserve={false}>
                    <Form.Item
                        name="category"
                        label="Category"
                        rules={[{ required: true, message: 'Select a category' }]}
                    >
                        <Select
                            placeholder="Select"
                            options={Object.entries(CATEGORY_LABELS).map(
                                ([value, label]) => ({ value, label }),
                            )}
                        />
                    </Form.Item>

                    <Form.Item
                        name="impact"
                        label="Impact"
                        rules={[{ required: true, message: 'Select an impact' }]}
                    >
                        <Select
                            placeholder="Select"
                            options={Object.entries(IMPACT_LABELS).map(
                                ([value, label]) => ({
                                    value,
                                    label: (
                                        <span>
                                            {label}
                                            {' — '}
                                            <Text type="secondary">
                                                {IMPACT_HINTS[value]}
                                            </Text>
                                        </span>
                                    ),
                                }),
                            )}
                        />
                    </Form.Item>

                    <Form.Item
                        name="title"
                        label="Title"
                        rules={[
                            { required: true, message: 'A title is required' },
                            { min: 8, message: 'At least 8 characters' },
                            { max: 160, message: 'At most 160 characters' },
                        ]}
                    >
                        <Input maxLength={160} showCount />
                    </Form.Item>

                    <Form.Item
                        name="description"
                        label="Description"
                        rules={[
                            { required: true, message: 'A description is required' },
                            { min: 20, message: 'At least 20 characters' },
                        ]}
                    >
                        <Input.TextArea rows={5} maxLength={10000} showCount />
                    </Form.Item>

                    <Form.Item name="reproduction_steps" label="Steps to reproduce (optional)">
                        <Input.TextArea rows={2} maxLength={10000} />
                    </Form.Item>
                    <Form.Item name="expected_result" label="Expected result (optional)">
                        <Input.TextArea rows={2} maxLength={10000} />
                    </Form.Item>
                    <Form.Item name="actual_result" label="Actual result (optional)">
                        <Input.TextArea rows={2} maxLength={10000} />
                    </Form.Item>
                    <Form.Item name="error_code" label="Error code or message (optional)">
                        <Input maxLength={80} />
                    </Form.Item>
                </Form>

                <AttachmentDropzone
                    enabled={attachmentsEnabled}
                    value={attachments}
                    onChange={setAttachments}
                    onOpenSession={supportPortalService.openAttachmentSession}
                    onUploadContent={supportPortalService.uploadAttachmentContent}
                />

                <Stack gap={1}>
                    <Text strong>Technical details sent automatically</Text>
                    <Text type="secondary">
                        Only the values below are sent. Cookies, session
                        data, form contents and URL parameters are never
                        collected.
                    </Text>
                    <div>
                        {Object.entries(diagnostics).map(([key, value]) => (
                            <StatusBadge key={key} tone="neutral">
                                {key}: {String(value)}
                            </StatusBadge>
                        ))}
                    </div>
                    <Text type="secondary">
                        If you attach a screenshot or a log, please make
                        sure it contains no confidential information.
                    </Text>
                </Stack>
            </Stack>
        </AppModal>
    )
}
