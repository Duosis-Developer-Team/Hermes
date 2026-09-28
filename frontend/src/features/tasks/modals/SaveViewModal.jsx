/**
 * =============================================================================
 * HERMES - Gorunumu kaydet (PM rework P3.5 / E2)
 * =============================================================================
 * Ad + gorunurluk (yalniz ben | is erisimi olan herkes). Paylasim IZNI
 * yok (05: v2) — erisimi olan herkes paylasilan gorunum acabilir.
 * =============================================================================
 */
import { useEffect } from 'react'
import { Form, Input, Modal } from 'antd'
import { FilterOutlined } from '@ant-design/icons'

import { ChipGroup, ModalHead } from '../../../components/liquid'
import { useT } from '../../../i18n'

function SaveViewModal({ open, onClose, onSubmit, loading = false, initialName = '' }) {
    const t = useT()
    const [form] = Form.useForm()

    useEffect(() => {
        if (open) form.setFieldsValue({ name: initialName, scope: 'personal' })
    }, [open, initialName, form])

    return (
        <Modal
            open={open}
            title={(
                <ModalHead
                    icon={<FilterOutlined />}
                    title={t('views.saveTitle')}
                    subtitle={t('views.saveSubtitle')}
                />
            )}
            onCancel={onClose}
            onOk={() => form.submit()}
            confirmLoading={loading}
            okText={t('common.save')}
            cancelText={t('common.cancel')}
            destroyOnHidden
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={{ name: initialName, scope: 'personal' }}
                onFinish={(values) => onSubmit({ name: values.name.trim(), scope: values.scope })}
            >
                <Form.Item
                    name="name"
                    label={t('views.name')}
                    rules={[{ required: true, whitespace: true, message: t('views.name') }]}
                >
                    <Input maxLength={120} placeholder={t('views.namePlaceholder')} autoFocus />
                </Form.Item>
                <Form.Item name="scope" label={t('views.visibility')}>
                    <ChipGroup
                        ariaLabel={t('views.visibility')}
                        options={[
                            { value: 'personal', label: t('views.visibilityPersonal') },
                            { value: 'shared', label: t('views.visibilityShared') },
                        ]}
                    />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default SaveViewModal
