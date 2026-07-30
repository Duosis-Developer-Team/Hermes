/**
 * =============================================================================
 * HERMES - Create / Edit User Group Modal
 * =============================================================================
 * Generic group fields only — name and description. Task-specific
 * permission state is configured under Task Management → Task Access.
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { Alert, Modal, Form, Input } from 'antd'

import {
    applyErrorToForm,
} from '../../features/admin/shared/normalizeApiError'
import { resetAndFill } from '../../features/admin/shared/formLifecycle'

const FORM_FIELDS = ['name', 'description']

function UserGroupModal({
    open,
    onClose,
    onSubmit,
    editingGroup = null,
    loading = false,
}) {
    const [form] = Form.useForm()
    const [submitError, setSubmitError] = useState(null)
    const [submitting, setSubmitting] = useState(false)
    const isEditing = !!editingGroup

    useEffect(() => {
        if (!open) return
        setSubmitError(null)
        // resetAndFill: Edit A → Edit B ve Edit → Create gecislerinde
        // onceki grubun degeri KALMAZ (`setFieldsValue` sig birlestirir).
        resetAndFill(form, {
            name: editingGroup?.name ?? '',
            description: editingGroup?.description ?? '',
        })
    }, [open, editingGroup, form])

    const handleFinish = async (values) => {
        // Cift gonderim kilidi KAYNAKTA: `confirmLoading` bir render GEC
        // gelir, arada ikinci istek acilabiliyordu.
        if (submitting || loading) return
        setSubmitError(null)
        setSubmitting(true)
        const payload = {
            name: values.name?.trim(),
            description: values.description || null,
        }
        try {
            await onSubmit(payload, editingGroup?.id)
        } catch (err) {
            // AntD `onFinish`i BEKLEMEZ: yakalanmayan reddetme daha once
            // unhandled rejection oluyordu.
            const leftover = applyErrorToForm(err, form, FORM_FIELDS)
            if (leftover) setSubmitError(leftover)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal
            title={isEditing ? 'Edit Group' : 'Create Group'}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : 'Create Group'}
            cancelText="Cancel"
            confirmLoading={loading || submitting}
            onOk={() => form.submit()}
            width={520}
            destroyOnHidden
            closable={!(loading || submitting)}
            maskClosable={!(loading || submitting)}
            keyboard={!(loading || submitting)}
        >
            {submitError && (
                <Alert
                    type="error"
                    showIcon
                    message={submitError}
                    style={{ marginBottom: 16 }}
                />
            )}
            <Form form={form} layout="vertical" onFinish={handleFinish}>
                <Form.Item
                    label="Group Name"
                    name="name"
                    rules={[
                        {
                            required: true, whitespace: true,
                            message: 'Group name is required.',
                        },
                        { max: 255, message: 'Max 255 characters.' },
                    ]}
                >
                    <Input maxLength={255} placeholder="e.g. Technical Team" />
                </Form.Item>

                <Form.Item label="Description" name="description">
                    <Input.TextArea
                        rows={3}
                        placeholder="What this group is for (optional)"
                    />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default UserGroupModal
