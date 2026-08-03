/**
 * =============================================================================
 * HERMES - Task Comments Thread
 * =============================================================================
 * Conversation-style comment list for the Review Task modal.
 *   - Oldest first, input at the bottom (matches chat conventions).
 *   - Hover shows Edit / Delete for the author and for admins.
 *   - Soft delete is backend-side; deleted comments are simply not
 *     returned, so this component never has to render them.
 *   - Permission rules are enforced server-side; the UI just hides
 *     buttons the user isn't allowed to use.
 * =============================================================================
 */

import { useState } from 'react'
import { Button, Input, Spin, message } from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    SendOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'

import { taskService } from '../../services/api'
import DangerConfirmModal from '../common/DangerConfirmModal'
import './TaskCommentsThread.css'

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    return u?.full_name || u?.email || id
}

function relativeTimeShort(iso) {
    if (!iso) return ''
    const then = dayjs(iso)
    const now = dayjs()
    const diffSec = now.diff(then, 'second')
    if (diffSec < 60) return 'just now'
    const diffMin = now.diff(then, 'minute')
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = now.diff(then, 'hour')
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = now.diff(then, 'day')
    if (diffDay < 7) return `${diffDay}d ago`
    return then.format('YYYY-MM-DD HH:mm')
}

function TaskCommentsThread({ taskId, currentUserId, isAdmin, userMap = {} }) {
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [editingId, setEditingId] = useState(null)
    const [editDraft, setEditDraft] = useState('')
    const [deletingComment, setDeletingComment] = useState(null)

    const { data: comments = [], isLoading } = useQuery({
        queryKey: ['task-comments', taskId],
        queryFn: () => taskService.listComments(taskId),
        enabled: !!taskId,
        staleTime: 15 * 1000,
    })

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['task-comments', taskId] })
        // A new/edited/deleted comment also emits a task activity
        // event, so refresh the timeline.
        queryClient.invalidateQueries({ queryKey: ['task-activity', taskId] })
    }

    const createMutation = useMutation({
        mutationFn: (body) => taskService.createComment(taskId, body),
        onSuccess: () => {
            setDraft('')
            invalidate()
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to add comment.'
            )
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, body }) =>
            taskService.updateComment(taskId, id, body),
        onSuccess: () => {
            setEditingId(null)
            setEditDraft('')
            invalidate()
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to update comment.'
            )
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (id) => taskService.deleteComment(taskId, id),
        onSuccess: () => {
            setDeletingComment(null)
            invalidate()
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to delete comment.'
            )
            setDeletingComment(null)
        },
    })

    const handleSend = () => {
        const body = draft.trim()
        if (!body) return
        createMutation.mutate(body)
    }

    const handleSaveEdit = () => {
        const body = editDraft.trim()
        if (!body || !editingId) return
        updateMutation.mutate({ id: editingId, body })
    }

    const canMutate = (comment) =>
        isAdmin || comment.author_user_id === currentUserId

    return (
        <div className="task-comments-thread">
            <div className="task-comments-list">
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 12 }}>
                        <Spin size="small" />
                    </div>
                ) : comments.length === 0 ? (
                    <div className="task-comments-empty">
                        No comments yet. Start the conversation below.
                    </div>
                ) : (
                    comments.map((c) => (
                        <div key={c.id} className="task-comment">
                            <div className="task-comment-header">
                                <span className="task-comment-author">
                                    {userLabel(c.author_user_id, userMap)}
                                </span>
                                <span
                                    className="task-comment-time"
                                    title={dayjs(c.created_at).format(
                                        'YYYY-MM-DD HH:mm:ss'
                                    )}
                                >
                                    {relativeTimeShort(c.created_at)}
                                    {c.updated_at ? ' · edited' : ''}
                                </span>
                                {canMutate(c) && editingId !== c.id && (
                                    <div className="task-comment-actions">
                                        <Button
                                aria-label="Edit comment"
                                            size="small"
                                            type="text"
                                            icon={<EditOutlined />}
                                            onClick={() => {
                                                setEditingId(c.id)
                                                setEditDraft(c.body)
                                            }}
                                        />
                                        <Button
                                aria-label="Delete comment"
                                            size="small"
                                            type="text"
                                            danger
                                            icon={<DeleteOutlined />}
                                            onClick={() =>
                                                setDeletingComment(c)
                                            }
                                        />
                                    </div>
                                )}
                            </div>
                            {editingId === c.id ? (
                                <div className="task-comment-edit">
                                    <Input.TextArea
                                        rows={3}
                                        value={editDraft}
                                        onChange={(e) =>
                                            setEditDraft(e.target.value)
                                        }
                                        maxLength={5000}
                                    />
                                    <div className="task-comment-edit-actions">
                                        <Button
                                            size="small"
                                            onClick={() => {
                                                setEditingId(null)
                                                setEditDraft('')
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            size="small"
                                            type="primary"
                                            loading={updateMutation.isPending}
                                            onClick={handleSaveEdit}
                                        >
                                            Save
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="task-comment-body">
                                    {c.body}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            <div className="task-comments-composer">
                <Input.TextArea
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write a comment…"
                    maxLength={5000}
                />
                <Button
                    type="primary"
                    icon={<SendOutlined />}
                    loading={createMutation.isPending}
                    disabled={!draft.trim()}
                    onClick={handleSend}
                >
                    Send
                </Button>
            </div>

            <DangerConfirmModal
                open={!!deletingComment}
                title="Delete comment?"
                body="This comment will be removed from the thread. This action cannot be undone."
                onCancel={() => setDeletingComment(null)}
                onConfirm={() =>
                    deletingComment &&
                    deleteMutation.mutate(deletingComment.id)
                }
                confirmLabel="Delete"
                loading={deleteMutation.isPending}
            />
        </div>
    )
}

export default TaskCommentsThread
