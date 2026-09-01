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

import { useEffect, useMemo, useState } from 'react'
import { Alert, Form, Input, Modal, Select } from 'antd'

import {
    applyErrorToForm,
} from '../../features/admin/shared/normalizeApiError'
import { resetAndFill } from '../../features/admin/shared/formLifecycle'
import { useT } from '../../i18n'

const FORM_FIELDS = ['user_ids', 'title']

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
    const t = useT()
    const [form] = Form.useForm()
    const [submitError, setSubmitError] = useState(null)
    const [submitting, setSubmitting] = useState(false)
    const isEditing = !!editingMember

    useEffect(() => {
        if (!open) return
        setSubmitError(null)
        // resetAndFill: Edit A → Edit B ve Edit → Add gecislerinde onceki
        // uyenin basligi formda KALMAZ (`setFieldsValue` sig birlestirir).
        resetAndFill(form, editingMember
            ? { user_ids: undefined, title: editingMember.title || '' }
            : { user_ids: undefined, title: '' })
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
        // Cift gonderim kilidi KAYNAKTA: `confirmLoading` bir render GEC
        // gelir, arada ikinci istek acilabiliyordu.
        if (submitting || loading) return
        setSubmitError(null)
        setSubmitting(true)
        const trimmed = (values.title || '').trim()
        try {
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
                await onSubmit({ user_ids: userIds, title: trimmed || null }, null)
            }
        } catch (err) {
            // AntD `onFinish`i BEKLEMEZ: yakalanmayan reddetme daha once
            // unhandled rejection oluyordu. Hata artik alanlara baglanir,
            // baglanamayan mesaj form ustunde durur.
            const leftover = applyErrorToForm(err, form, FORM_FIELDS)
            if (leftover) setSubmitError(leftover)
        } finally {
            setSubmitting(false)
        }
    }

    /**
     * KUSUR DUZELTMESI: burada bir BOOLEAN olmasi gerekirken ters
     * kurulmus bir ternary iki dalda da dolu STRING donduruyordu. Deger
     * her zaman truthy oldugu icin `okButtonProps.disabled` HER DURUMDA
     * dolu, "hepsi uye" uyarisi da HER DURUMDA gorunurdu — yani gruba
     * uye eklemek ve uye basligini duzenlemek TAMAMEN calismiyordu.
     */
    const noCandidates = !isEditing && candidateUsers.length === 0

    const okText = isEditing
        ? 'Save Changes'
        : 'Add Members'

    return (
        <Modal
            title={isEditing ? 'Edit Member Title' : 'Add Members'}
            open={open}
            onCancel={onClose}
            okText={okText}
            cancelText={t('common.cancel')}
            confirmLoading={loading || submitting}
            onOk={() => form.submit()}
            width={520}
            destroyOnHidden
            okButtonProps={{ disabled: noCandidates }}
            closable={!(loading || submitting)}
            maskClosable={!(loading || submitting)}
            keyboard={!(loading || submitting)}
        >
            {noCandidates && (
                <Alert
                    type="info"
                    showIcon
                    message={t('memberModal.allAlreadyMembers')}
                    style={{ marginBottom: 16 }}
                />
            )}

            {submitError && (
                <Alert
                    type="error"
                    showIcon
                    message={submitError}
                    style={{ marginBottom: 16 }}
                />
            )}

            <Form form={form} layout="vertical" onFinish={handleFinish}>
                {isEditing ? (
                    <Form.Item label={t('entity.user')}>
                        <Input value={editingUserLabel} disabled />
                    </Form.Item>
                ) : (
                    <Form.Item
                        label={t('entity.users')}
                        name="user_ids"
                        rules={[
                            {
                                required: true,
                                message: t('memberModal.pickAtLeastOne'),
                            },
                        ]}
                    >
                        <Select
                            mode="multiple"
                            showSearch
                            placeholder={t('memberModal.selectUsers')}
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
                    <Input maxLength={255} placeholder={t('memberModal.titleExample')} />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default UserGroupMemberModal
