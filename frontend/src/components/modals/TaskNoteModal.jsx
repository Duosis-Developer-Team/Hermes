/**
 * =============================================================================
 * HERMES - Task Note Modal
 * =============================================================================
 * Lightweight inline editor for a task's assignee_note. Replaces the
 * old read-only Task Detail modal with a focused single-purpose dialog.
 *
 * Permission semantics:
 *   - Assignee:  full edit
 *   - Admin:     full edit (override; rarely used)
 *   - Assigner:  read-only (sees what the assignee wrote)
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Space, message } from 'antd'

function TaskNoteModal({
    open,
    task,
    onClose,
    onSave,
    saving = false,
    canEdit = false,
}) {
    const [note, setNote] = useState('')

    useEffect(() => {
        setNote(task?.assignee_note || '')
    }, [task, open])

    if (!task) return null

    const handleSave = async () => {
        try {
            await onSave?.(task, note)
            message.success('Note saved.')
            onClose?.()
        } catch (err) {
            message.error(err?.response?.data?.detail || 'Failed to save note.')
        }
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
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
                    {canEdit && (
                        <Button type="primary" loading={saving} onClick={handleSave}>
                            Save Note
                        </Button>
                    )}
                </div>
            </Space>
        </Modal>
    )
}

export default TaskNoteModal
