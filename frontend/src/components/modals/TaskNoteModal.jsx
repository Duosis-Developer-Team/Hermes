/**
 * =============================================================================
 * HERMES - Task Note Modal
 * =============================================================================
 * Lightweight inline editor for a task's assignee_note. Also surfaces
 * the completion control so the assignee can mark the task done from
 * the same modal they already open from a task card.
 *
 * Permission semantics:
 *   - Note edit:       Assignee, Admin (assigner is read-only)
 *   - Mark/Reopen:     Assignee, Admin, Assigner
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Space, Tag, message } from 'antd'
import { CheckCircleOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

function userLabel(id, userMap) {
    if (!id) return null
    const u = userMap?.[id]
    return u?.full_name || u?.email || id
}

function TaskNoteModal({
    open,
    task,
    onClose,
    onSave,
    saving = false,
    canEdit = false,
    canToggleCompletion = false,
    onToggleCompletion,
    completionLoading = false,
    userMap = {},
}) {
    const [note, setNote] = useState('')

    useEffect(() => {
        setNote(task?.assignee_note || '')
    }, [task, open])

    if (!task) return null

    const isCompleted = task.status === 'completed'

    const handleSave = async () => {
        try {
            await onSave?.(task, note)
            message.success('Note saved.')
            onClose?.()
        } catch (err) {
            message.error(err?.response?.data?.detail || 'Failed to save note.')
        }
    }

    const handleToggle = () => {
        onToggleCompletion?.(task, !isCompleted)
    }

    return (
        <Modal
            title={`Assignee Note · ${task.title}`}
            open={open}
            onCancel={onClose}
            footer={null}
            width={520}
            destroyOnClose
        >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {isCompleted && (
                    <Alert
                        type="success"
                        showIcon
                        icon={<CheckCircleOutlined />}
                        message={
                            <div>
                                <Tag color="green" style={{ marginRight: 8 }}>
                                    COMPLETED
                                </Tag>
                                {task.completed_at
                                    ? `on ${dayjs(task.completed_at).format(
                                          'YYYY-MM-DD HH:mm'
                                      )}`
                                    : null}
                                {task.completed_by_user_id
                                    ? ` by ${userLabel(
                                          task.completed_by_user_id,
                                          userMap
                                      )}`
                                    : null}
                            </div>
                        }
                    />
                )}
                {!canEdit && (
                    <Alert
                        type="info"
                        showIcon
                        message="Read-only — only the assignee can edit this note."
                    />
                )}
                <Input.TextArea
                    rows={6}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Progress, blockers, or completion notes."
                    disabled={!canEdit}
                />
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                    }}
                >
                    {canToggleCompletion ? (
                        <Button
                            icon={
                                isCompleted ? (
                                    <UndoOutlined />
                                ) : (
                                    <CheckCircleOutlined />
                                )
                            }
                            type={isCompleted ? 'default' : 'primary'}
                            loading={completionLoading}
                            onClick={handleToggle}
                        >
                            {isCompleted ? 'Reopen' : 'Mark as Completed'}
                        </Button>
                    ) : (
                        <span />
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button onClick={onClose}>
                            {canEdit ? 'Cancel' : 'Close'}
                        </Button>
                        {canEdit && (
                            <Button
                                type="primary"
                                loading={saving}
                                onClick={handleSave}
                            >
                                Save Note
                            </Button>
                        )}
                    </div>
                </div>
            </Space>
        </Modal>
    )
}

export default TaskNoteModal
