/**
 * =============================================================================
 * HERMES - Task Detail Modal
 * =============================================================================
 * Read view + assignee actions (note + completion). Assigner / admin can
 * open the edit modal from here. Backend remains the source of truth on
 * permissions; this UI only mirrors them.
 *
 * Task data carries user IDs only; names/emails are resolved from the
 * `userMap` prop populated by the parent page via auth-service /users/lookup.
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import {
    Modal,
    Descriptions,
    Tag,
    Input,
    Button,
    Space,
    message,
    Divider,
    Alert,
} from 'antd'

const PRIORITY_COLOR = {
    low: 'default',
    medium: 'blue',
    high: 'orange',
    urgent: 'red',
}

const STATUS_COLOR = {
    pending: 'default',
    in_progress: 'blue',
    completed: 'green',
    cancelled: 'magenta',
}

function formatMinutes(min) {
    if (!min || min <= 0) return '—'
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h && m) return `${h}h ${m}m`
    if (h) return `${h}h`
    return `${m}m`
}

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    return u?.full_name || u?.email || id
}

function TaskDetailModal({
    open,
    task,
    userMap = {},
    currentUserId,
    isAdmin = false,
    onClose,
    onEdit,
    onSaveNote,
    onToggleComplete,
    noteSaving = false,
    completionSaving = false,
}) {
    const [note, setNote] = useState('')

    useEffect(() => {
        setNote(task?.assignee_note || '')
    }, [task])

    if (!task) return null

    const assigneeIsMe = task.assignee_user_id === currentUserId
    const assignerIsMe = task.assigner_user_id === currentUserId
    const canEditCore = isAdmin || assignerIsMe
    const canEditNote = isAdmin || assigneeIsMe
    const canToggleCompletion = isAdmin || assigneeIsMe || assignerIsMe
    const isCompleted = task.status === 'completed'

    const handleSaveNote = async () => {
        try {
            await onSaveNote?.(task, note)
            message.success('Note saved.')
        } catch (err) {
            message.error(err?.response?.data?.detail || 'Failed to save note.')
        }
    }

    const handleToggleCompletion = async () => {
        try {
            await onToggleComplete?.(task, !isCompleted)
        } catch (err) {
            message.error(err?.response?.data?.detail || 'Failed to update status.')
        }
    }

    return (
        <Modal
            title={task.title}
            open={open}
            onCancel={onClose}
            footer={null}
            width={680}
            destroyOnClose
        >
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Space size={[8, 8]} wrap>
                    <Tag color={STATUS_COLOR[task.status] || 'default'}>
                        {task.status.replace('_', ' ')}
                    </Tag>
                    <Tag color={PRIORITY_COLOR[task.priority] || 'default'}>
                        {task.priority}
                    </Tag>
                </Space>

                <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="Customer">
                        {task.customer_name || '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Project">
                        {task.project_name || '—'}
                    </Descriptions.Item>
                    {task.sub_project_id && (
                        <Descriptions.Item label="Sub Project">
                            {task.sub_project_name || '—'}
                        </Descriptions.Item>
                    )}
                    <Descriptions.Item label="Assigner">
                        {userLabel(task.assigner_user_id, userMap)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Assignee">
                        {userLabel(task.assignee_user_id, userMap)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Scheduled Date">
                        {task.scheduled_date}
                    </Descriptions.Item>
                    <Descriptions.Item label="Due Date">
                        {task.due_date || '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Estimated Duration">
                        {formatMinutes(task.estimated_duration_minutes)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Description">
                        {task.description || '—'}
                    </Descriptions.Item>
                    {isCompleted && (
                        <Descriptions.Item label="Completed">
                            {task.completed_at} · by{' '}
                            {userLabel(task.completed_by_user_id, userMap)}
                        </Descriptions.Item>
                    )}
                </Descriptions>

                <Divider style={{ margin: '4px 0' }} />

                <div>
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>
                        Assignee Note
                    </div>
                    {!canEditNote && (
                        <Alert
                            type="info"
                            showIcon
                            message="Only the assignee can update this note."
                            style={{ marginBottom: 8 }}
                        />
                    )}
                    <Input.TextArea
                        rows={4}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Progress, blockers, or completion notes."
                        disabled={!canEditNote}
                    />
                    {canEditNote && (
                        <Space style={{ marginTop: 8 }}>
                            <Button
                                type="primary"
                                onClick={handleSaveNote}
                                loading={noteSaving}
                            >
                                Save Note
                            </Button>
                        </Space>
                    )}
                </div>

                <Divider style={{ margin: '4px 0' }} />

                <Space wrap>
                    {canToggleCompletion && (
                        <Button
                            type={isCompleted ? 'default' : 'primary'}
                            onClick={handleToggleCompletion}
                            loading={completionSaving}
                        >
                            {isCompleted ? 'Reopen Task' : 'Mark as Completed'}
                        </Button>
                    )}
                    {canEditCore && (
                        <Button onClick={() => onEdit?.(task)}>Edit Task</Button>
                    )}
                </Space>
            </Space>
        </Modal>
    )
}

export default TaskDetailModal
