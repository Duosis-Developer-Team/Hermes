/**
 * =============================================================================
 * HERMES - Create / Edit Task Group Modal
 * =============================================================================
 * Used by Admin Task Management. Defaults map directly to the backend
 * task_groups table (can_access_tasks_default / can_assign_tasks_default).
 * =============================================================================
 */

import { useEffect } from 'react'
import { Modal, Form, Input, Switch, Space } from 'antd'

function TaskGroupModal({
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
                can_access_tasks_default: !!editingGroup.can_access_tasks_default,
                can_assign_tasks_default: !!editingGroup.can_assign_tasks_default,
                is_active: editingGroup.is_active !== false,
            })
        } else {
            form.resetFields()
            form.setFieldsValue({
                can_access_tasks_default: true,
                can_assign_tasks_default: false,
                is_active: true,
            })
        }
    }, [open, editingGroup, form])

    const handleFinish = async (values) => {
        const payload = {
            name: values.name?.trim(),
            description: values.description || null,
            can_access_tasks_default: !!values.can_access_tasks_default,
            can_assign_tasks_default: !!values.can_assign_tasks_default,
        }
        if (isEditing) {
            payload.is_active = !!values.is_active
        }
        await onSubmit(payload, editingGroup?.id)
    }

    return (
        <Modal
            title={isEditing ? 'Edit Task Group' : 'Create Task Group'}
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

                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Form.Item
                        label="Default: Can Access Tasks"
                        name="can_access_tasks_default"
                        valuePropName="checked"
                        extra="Members of this group can see and use the Tasks module unless overridden per member."
                    >
                        <Switch />
                    </Form.Item>

                    <Form.Item
                        label="Default: Can Assign Tasks"
                        name="can_assign_tasks_default"
                        valuePropName="checked"
                        extra="Members of this group can create tasks unless overridden per member."
                    >
                        <Switch />
                    </Form.Item>

                    {isEditing && (
                        <Form.Item
                            label="Active"
                            name="is_active"
                            valuePropName="checked"
                            extra="Inactive groups stop contributing to effective permissions."
                        >
                            <Switch />
                        </Form.Item>
                    )}
                </Space>
            </Form>
        </Modal>
    )
}

export default TaskGroupModal
