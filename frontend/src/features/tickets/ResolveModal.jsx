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

const { Text } = Typography

export function ResolveModal({ open, onCancel, onSubmit, pending, ticket }) {
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
            title="Resolve ticket"
            okText="Send resolution"
            cancelText="Cancel"
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
                    label="Resolution type"
                    rules={[{ required: true, message: 'Select a resolution type' }]}
                >
                    <Select
                        options={Object.entries(RESOLUTION_LABELS).map(
                            ([value, label]) => ({ value, label }),
                        )}
                        placeholder="Select"
                    />
                </Form.Item>

                <Form.Item
                    name="public_summary"
                    label="Customer-visible resolution summary"
                    extra="The customer sees this text exactly as written."
                    rules={[
                        { required: true, message: 'A resolution summary is required' },
                        { min: 20, message: 'Write at least 20 characters' },
                    ]}
                >
                    <Input.TextArea
                        rows={4}
                        maxLength={10000}
                        onChange={(event) => setPreview(event.target.value)}
                    />
                </Form.Item>

                <Form.Item name="public_workaround" label="Workaround (optional, visible to the customer)">
                    <Input.TextArea rows={2} maxLength={10000} />
                </Form.Item>

                <Form.Item name="fix_version" label="Fix version (optional, visible to the customer)">
                    <Input maxLength={120} />
                </Form.Item>

                <Alert
                    type="warning"
                    showIcon
                    message="The fields below are for the team only"
                    description="Root cause and internal notes are never included in the customer portal, webhook events or API responses."
                    style={{ marginBottom: 16 }}
                />

                <Form.Item name="internal_root_cause" label="Root cause — team only">
                    <Input.TextArea rows={2} maxLength={10000} />
                </Form.Item>

                <Form.Item name="internal_note" label="Internal follow-up note — team only">
                    <Input.TextArea rows={2} maxLength={10000} />
                </Form.Item>

                <Stack gap={1} className="h-ticket-resolution">
                    <Text strong>What the customer will see</Text>
                    <Text>{preview || 'The resolution summary will appear here.'}</Text>
                </Stack>
            </Form>
        </AppModal>
    )
}

export default ResolveModal
