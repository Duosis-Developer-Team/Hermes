/**
 * =============================================================================
 * HERMES - Add / Edit Group Member Modal
 * =============================================================================
 * Two distinct modes share one shell:
 *
 * Add mode:
 *   - Multi-select user picker (already-members are filtered out by the
 *     parent before the modal opens).
 *   - Optional Default Member Title — applied to every selected user. If
 *     blank, members are added with no title; admin can refine each one
 *     later via the row edit button.
 *   - Submit shape: { user_ids: UUID[], title: string|null }.
 *
 * Edit mode:
 *   - User identity is shown read-only as "Full Name — Email" (never the
 *     raw UUID). Resolved via the userMap prop the parent already builds
 *     from auth-service /users/lookup.
 *   - Only Member Title is editable; submit shape: { title?, clear_title? }.
 * =============================================================================
 */

import { useEffect, useMemo } from 'react'
import { Alert, Form, Input, Modal, Select } from 'antd'

function userDisplay(user) {
    if (!user) return ''
    // Prefer the user's full name; fall back to email or ID only when name
    // is missing, so the modal never exposes a raw UUID.
    return user.full_name || user.email || user.id
}

function UserGroupMemberModal({
    open,
    onClose,
    onSubmit,
    editingMember = null,
    /** users not yet in the group (for Add flow) */
    candidateUsers = [],
    /** id → user object (for read-only display in Edit flow) */
    userMap = {},
    loading = false,
}) {
    const [form] = Form.useForm()
    const isEditing = !!editingMember

    useEffect(() => {
        if (!open) return
        if (editingMember) {
            form.setFieldsValue({
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
                label: userDisplay(u),
            })),
        [candidateUsers]
    )

    const editingUserLabel = useMemo(
        () =>
            editingMember
                ? userDisplay(userMap?.[editingMember.user_id]) ||
                  editingMember.user_id
                : '',
        [editingMember, userMap]
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
            const userIds = Array.isArray(values.user_ids) ? values.user_ids : []
            await onSubmit(
                {
                    user_ids: userIds,
                    title: trimmed || null,
                },
                null
            )
        }
    }

    const noCandidates = !isEditing && candidateUsers.length === 0
        ? 'Save Changes'
        : `Add Member${
              !isEditing && form.getFieldValue?.('user_ids')?.length > 1 ? 's' : ''
          }`

    return (
        <Modal
            title={isEditing ? 'Edit Member Title' : 'Add Members'}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : 'Add Members'}
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
                {isEditing ? (
                    <Form.Item label="User">
                        <Input value={editingUserLabel} disabled />
                    </Form.Item>
                ) : (
                    <Form.Item
                        label="Users"
                        name="user_ids"
                        rules={[
                            {
                                required: true,
                                message: 'Pick at least one user.',
                            },
                        ]}
                    >
                        <Select
                            mode="multiple"
                            showSearch
                            placeholder="Select one or more users"
                            optionFilterProp="label"
                            options={userOptions}
                            maxTagCount="responsive"
                        />
                    </Form.Item>
                )}

                <Form.Item
                    label={
                        isEditing ? 'Member Title' : 'Default Member Title'
                    }
                    name="title"
                    extra={
                        isEditing
                            ? 'Examples: Senior Developer, Junior Developer, Team Lead.'
                            : 'Optional. Applied to every selected user. Leave empty to add with no title.'
                    }
                >
                    <Input maxLength={255} placeholder="Senior Developer" />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default UserGroupMemberModal
