/**
 * =============================================================================
 * HERMES - Add / Edit Task Group Member Modal
 * =============================================================================
 * Override semantics (tri-state):
 *   - "Inherit from group" → null override
 *   - "Force enabled"      → true override
 *   - "Force disabled"     → false override
 * =============================================================================
 */

import { useEffect, useMemo } from 'react'
import { Modal, Form, Input, Select, Alert } from 'antd'

const OVERRIDE_OPTIONS = [
    { value: 'inherit', label: 'Inherit from group' },
    { value: 'enabled', label: 'Force enabled' },
    { value: 'disabled', label: 'Force disabled' },
]

function overrideToValue(override) {
    if (override === true) return 'enabled'
    if (override === false) return 'disabled'
    return 'inherit'
}

function valueToPayload(value, currentOverride, fieldName, clearFieldName) {
    /** Returns the partial payload bits for one override field.
     *  - "inherit" sends clear_*=true (only when there is something to clear).
     *  - "enabled"/"disabled" sends explicit boolean.
     */
    if (value === 'enabled') {
        return { [fieldName]: true }
    }
    if (value === 'disabled') {
        return { [fieldName]: false }
    }
    // inherit
    if (currentOverride === undefined) {
        // create flow — null is the default, no payload needed
        return {}
    }
    if (currentOverride !== null) {
        return { [clearFieldName]: true }
    }
    return {}
}

function TaskGroupMemberModal({
    open,
    onClose,
    onSubmit,
    editingMember = null, // member object (with overrides) when editing
    /** users not yet in the group, for the user select on create */
    candidateUsers = [],
    loading = false,
}) {
    const [form] = Form.useForm()
    const isEditing = !!editingMember

    useEffect(() => {
        if (!open) return
        if (editingMember) {
            form.setFieldsValue({
                user_id: editingMember.user_id,
                task_title: editingMember.task_title || '',
                access_choice: overrideToValue(
                    editingMember.can_access_tasks_override
                ),
                assign_choice: overrideToValue(
                    editingMember.can_assign_tasks_override
                ),
            })
        } else {
            form.resetFields()
            form.setFieldsValue({
                access_choice: 'inherit',
                assign_choice: 'inherit',
            })
        }
    }, [open, editingMember, form])

    const userOptions = useMemo(
        () =>
            candidateUsers.map((u) => ({
                value: u.id,
                label: u.full_name || u.email,
            })),
        [candidateUsers]
    )

    const handleFinish = async (values) => {
        const titleTrim = (values.task_title || '').trim()
        if (isEditing) {
            const payload = {}
            // Title
            if (titleTrim) {
                payload.task_title = titleTrim
            } else if (editingMember.task_title) {
                payload.clear_task_title = true
            }
            // Access override
            Object.assign(
                payload,
                valueToPayload(
                    values.access_choice,
                    editingMember.can_access_tasks_override,
                    'can_access_tasks_override',
                    'clear_access_override'
                )
            )
            // Assign override
            Object.assign(
                payload,
                valueToPayload(
                    values.assign_choice,
                    editingMember.can_assign_tasks_override,
                    'can_assign_tasks_override',
                    'clear_assign_override'
                )
            )
            await onSubmit(payload, editingMember)
        } else {
            const payload = {
                user_id: values.user_id,
                task_title: titleTrim || null,
                can_access_tasks_override:
                    values.access_choice === 'enabled'
                        ? true
                        : values.access_choice === 'disabled'
                        ? false
                        : null,
                can_assign_tasks_override:
                    values.assign_choice === 'enabled'
                        ? true
                        : values.assign_choice === 'disabled'
                        ? false
                        : null,
            }
            await onSubmit(payload, null)
        }
    }

    const noCandidates = !isEditing && candidateUsers.length === 0

    return (
        <Modal
            title={isEditing ? 'Edit Group Member' : 'Add Group Member'}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : 'Add Member'}
            cancelText="Cancel"
            confirmLoading={loading}
            onOk={() => form.submit()}
            width={520}
            destroyOnClose
            okButtonProps={{ disabled: noCandidates }}
        >
            {noCandidates && (
                <Alert
                    type="info"
                    showIcon
                    message="All users are already members of this group."
                    style={{ marginBottom: 16 }}
                />
            )}

            <Form form={form} layout="vertical" onFinish={handleFinish}>
                <Form.Item
                    label="User"
                    name="user_id"
                    rules={[{ required: true, message: 'User is required.' }]}
                >
                    <Select
                        showSearch
                        disabled={isEditing}
                        placeholder="Select user"
                        optionFilterProp="label"
                        options={userOptions}
                    />
                </Form.Item>

                <Form.Item
                    label="Task Title"
                    name="task_title"
                    extra="Optional. Examples: Senior Developer, Junior Developer, Team Lead."
                >
                    <Input maxLength={255} placeholder="Senior Developer" />
                </Form.Item>

                <Form.Item
                    label="Can Access Tasks Override"
                    name="access_choice"
                    rules={[{ required: true }]}
                    extra="How this member's contribution to access permission is calculated."
                >
                    <Select options={OVERRIDE_OPTIONS} />
                </Form.Item>

                <Form.Item
                    label="Can Assign Tasks Override"
                    name="assign_choice"
                    rules={[{ required: true }]}
                    extra="How this member's contribution to assign permission is calculated."
                >
                    <Select options={OVERRIDE_OPTIONS} />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default TaskGroupMemberModal
