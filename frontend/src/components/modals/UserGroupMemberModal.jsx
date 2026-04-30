/**
 * =============================================================================
 * HERMES - Add / Edit User Group Member Modal
 * =============================================================================
 * Title is the in-group "Member Title" (e.g. Senior Developer). Task-
 * specific permission overrides are managed separately under
 * Task Management → Task Access.
 * =============================================================================
 */

import { useEffect, useMemo } from 'react'
import { Alert, Form, Input, Modal, Select } from 'antd'

function UserGroupMemberModal({
    open,
    onClose,
    onSubmit,
    editingMember = null,
    /** users not yet in the group (for Add flow) */
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
                title: editingMember.title || '',
            })
        } else {
            form.resetFields()
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
        const trimmed = (values.title || '').trim()
        if (isEditing) {
            const payload = {}
            if (trimmed) {
                payload.title = trimmed
            } else if (editingMember.title) {
                payload.clear_title = true
            }
            await onSubmit(payload, editingMember)
        } else {
            await onSubmit(
                {
                    user_id: values.user_id,
                    title: trimmed || null,
                },
                null
            )
        }
    }

    const noCandidates = !isEditing && candidateUsers.length === 0

    return (
        <Modal
            title={isEditing ? 'Edit Member Title' : 'Add Member'}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : 'Add Member'}
            cancelText="Cancel"
            confirmLoading={loading}
            onOk={() => form.submit()}
            width={480}
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
                    label="Member Title"
                    name="title"
                    extra="Optional. Examples: Senior Developer, Junior Developer, Team Lead."
                >
                    <Input maxLength={255} placeholder="Senior Developer" />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default UserGroupMemberModal
