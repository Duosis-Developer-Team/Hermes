/**
 * HERMES - Çözüm modalı.
 *
 * Iki alan bilincli olarak AYRI ve acikca etiketlidir:
 *   - "Müşteriye görünecek çözüm özeti" (ZORUNLU, en az 20 karakter)
 *   - "Kök neden — yalnızca ekip" (opsiyonel, MUSTERIYE GITMEZ)
 *
 * Onizleme, musterinin GORECEGI karti gosterir; boylece ic bilginin
 * yanlis alana yazildigi gonderim oncesi fark edilir.
 */
import { useState } from 'react'
import { Alert, Form, Input, Select, Typography } from 'antd'

import { AppModal, Stack } from '../../components/ui'
import { RESOLUTION_LABELS } from './constants'
import './tickets.css'
import { useT } from '../../i18n'

const { Text } = Typography

export function ResolveModal({ open, onCancel, onSubmit, pending, ticket }) {
    const t = useT()
    const [form] = Form.useForm()
    const [preview, setPreview] = useState('')

    const handleOk = async () => {
        let values
        try {
            values = await form.validateFields()
        } catch {
            // Dogrulama hatasi KULLANICI hatasidir; AntD alanlarda
            // gosterir. Yakalanmazsa "unhandled rejection" olarak
            // konsola duser ve gercek hatalari gizler.
            return
        }
        onSubmit({
            resolution_code: values.resolution_code,
            public_summary: values.public_summary,
            public_workaround: values.public_workaround || null,
            fix_version: values.fix_version || null,
            internal_root_cause: values.internal_root_cause || null,
            internal_note: values.internal_note || null,
            expected_version: ticket?.version,
        })
    }

    return (
        <AppModal
            open={open}
            title={t('ticket.resolveTicket')}
            okText={t('ticket.sendResolution')}
            cancelText={t('common.cancel')}
            onCancel={onCancel}
            onOk={handleOk}
            pending={pending}
            confirmLoading={pending}
            destroyOnHidden
            width={640}
        >
            <Form form={form} layout="vertical" preserve={false}>
                <Form.Item
                    name="resolution_code"
                    label={t('ticket.resolutionType')}
                    rules={[{ required: true, message: t('ticket.selectResolutionType') }]}
                >
                    <Select
                        options={Object.entries(RESOLUTION_LABELS).map(
                            ([value, label]) => ({ value, label }),
                        )}
                        placeholder={t('ticket.select')}
                    />
                </Form.Item>

                <Form.Item
                    name="public_summary"
                    label={t('ticket.customerSummary')}
                    extra={t('ticket.summaryVerbatim')}
                    rules={[
                        { required: true, message: t('ticket.summaryRequired') },
                    ]}
                >
                    <Input.TextArea
                        rows={4}
                        maxLength={10000}
                        onChange={(event) => setPreview(event.target.value)}
                    />
                </Form.Item>

                <Form.Item name="public_workaround" label={t('ticket.workaround')}>
                    <Input.TextArea rows={2} maxLength={10000} />
                </Form.Item>

                <Form.Item name="fix_version" label={t('ticket.fixVersion')}>
                    <Input maxLength={120} />
                </Form.Item>

                <Alert
                    type="warning"
                    showIcon
                    message={t('ticket.teamOnlyFields')}
                    description={t('ticket.internalNeverLeaks')}
                    style={{ marginBottom: 16 }}
                />

                <Form.Item name="internal_root_cause" label={t('ticket.rootCause')}>
                    <Input.TextArea rows={2} maxLength={10000} />
                </Form.Item>

                <Form.Item name="internal_note" label={t('ticket.internalFollowUp')}>
                    <Input.TextArea rows={2} maxLength={10000} />
                </Form.Item>

                <Stack gap={1} className="h-ticket-resolution">
                    <Text strong>{t('ticket.customerWillSee')}</Text>
                    <Text>{preview || 'The resolution summary will appear here.'}</Text>
                </Stack>
            </Form>
        </AppModal>
    )
}

export default ResolveModal
