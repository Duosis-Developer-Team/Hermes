/**
 * =============================================================================
 * HERMES - Create / Edit User Group Modal
 * =============================================================================
 * Generic group fields only — name and description. Task-specific
 * permission state is configured under Task Management → Task Access.
 * =============================================================================
 */

import { useEffect } from 'react'
import { Modal, Form, Input } from 'antd'

function UserGroupModal({
    open,
    onClose,
    onSubmit,
    editingGroup = null,
    loading = false,
}) {
    const [form] = Form.useForm()
    const isEditing = !!editingGroup

    useEffect(() => {
        if (!open) return
        if (editingGroup) {
            form.setFieldsValue({
                name: editingGroup.name,
                description: editingGroup.description || '',
            })
        } else {
            form.resetFields()
        }
    }, [open, editingGroup, form])

    const handleFinish = async (values) => {
        const payload = {
            name: values.name?.trim(),
            description: values.description || null,
        }
        await onSubmit(payload, editingGroup?.id)
    }

    return (
        <Modal
            title={isEditing ? 'Edit Group' : 'Create Group'}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : 'Create Group'}
            cancelText="Cancel"
            confirmLoading={loading}
            onOk={() => form.submit()}
            width={520}
            destroyOnClose
        >
            <Form form={form} layout="vertical" onFinish={handleFinish}>
                <Form.Item
                    label="Group Name"
                    name="name"
                    rules={[
                        { required: true, message: 'Group name is required.' },
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
