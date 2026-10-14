/**
 * =============================================================================
 * HERMES - Talep kanbani (Talepler → Pano)
 * =============================================================================
 * Is yonetimindeki panoyla AYNI teknoloji ve gorunum: @dnd-kit, ayni sutun /
 * kart siniflari (TasksBoardView.css, TaskCard.css). Sutunlar "top kimde":
 *   Pending (kirmizi)     → yeni, yeniden acilan ya da MUSTERI yanitlayan
 *   In progress (sari)    → biz yanitladik
 *   Completed (yesil)     → cozuldu / kapandi (son 14 gun)
 * Sutun sunucudan gelir (`board_column`); musteri yanitlayinca kart kendi
 * kendine Pending'e doner.
 *
 * Birakma kurallari (her biri mevcut komutla, kendi kuraliyla):
 *   → Completed  : cozum penceresi; cozulunce efor penceresi (useTicketWorkLog)
 *   → In progress: musteriye yanit penceresi (yanit talebi "Islemde"ye alir)
 *   → Pending    : yalniz Completed'dan — gerekceyle yeniden acma
 *   Diger birakmalar kisa bir aciklamayla reddedilir (kart yerinde kalir).
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Form, Input, Modal, Tooltip, message } from 'antd'
import { ClockCircleOutlined, MessageOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
    DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners,
    useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'

import { ticketHubService } from '../../api/ticketsApi'
import { ModalHead } from '../../components/liquid'
import { useT } from '../../i18n'
import ResolveModal from './ResolveModal'
import SlaBadge, { TagChips } from './SlaBadge'
import { TicketPriorityBadge } from './TicketStatusBadge'
import '../../components/tasks/TasksBoardView.css'
import '../../components/tasks/TaskCard.css'
import './tickets.css'

dayjs.extend(relativeTime)

export const BOARD_COLUMNS = [
    { key: 'pending', labelKey: 'ticketBoard.pending', accent: 'var(--h-danger)' },
    { key: 'in_progress', labelKey: 'ticketBoard.inProgress', accent: 'var(--h-warning)' },
    { key: 'completed', labelKey: 'ticketBoard.completed', accent: 'var(--h-success)' },
]

/**
 * Birakma karari (saf; testli). Donus: 'resolve' | 'reply' | 'reopen' |
 * { info: <ceviri anahtari> } | null (ayni sutun).
 */
export function dropDecision(from, to, { canResolve, canRespond }) {
    if (!to || from === to) return null
    if (to === 'completed') return canResolve ? 'resolve' : { info: 'ticketBoard.noResolve' }
    if (to === 'in_progress') {
        if (from === 'completed') return { info: 'ticketBoard.reopenFirst' }
        return canRespond ? 'reply' : { info: 'ticketBoard.noRespond' }
    }
    if (to === 'pending') return from === 'completed' ? 'reopen' : { info: 'ticketBoard.pendingAuto' }
    return null
}

function DraggableCard({ id, disabled, children }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled })
    return (
        <div
            ref={setNodeRef}
            className={`tasks-board-draggable${isDragging ? ' is-dragging' : ''}${disabled ? ' is-locked' : ''}`}
            {...(disabled ? {} : listeners)}
            {...(disabled ? {} : attributes)}
        >
            {children}
        </div>
    )
}

function DroppableColumn({ id, children }) {
    const { setNodeRef, isOver } = useDroppable({ id })
    return (
        <div ref={setNodeRef} className={`tasks-board-column-body${isOver ? ' is-over' : ''}`}>
            {children}
        </div>
    )
}

export function TicketCard({ ticket, assignee, onOpen, onLogTime }) {
    const t = useT()
    const done = ticket.board_column === 'completed'
    return (
        <div className={`task-card ticket-card${done ? ' task-card-completed' : ''}`}>
            <div className="task-card-top">
                {ticket.unread && <span className="tickets-row__dot" aria-label={t('hub.unread')} />}
                <span className="task-card-code">{ticket.customer_ref || ticket.ticket_number}</span>
                <span className="ticket-card__spacer" />
                <TicketPriorityBadge priority={ticket.priority} />
            </div>
            <div className="task-card-body">
                <button
                    type="button"
                    className="task-card-title task-card-open"
                    onClick={(e) => { e.stopPropagation(); onOpen?.(ticket.id) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
                >
                    <span className="task-card-title-text">{ticket.title}</span>
                </button>
                <div className="ticket-card__badges">
                    <SlaBadge sla={ticket.sla} />
                    <TagChips tags={ticket.tags} />
                </div>
                <div className="task-card-meta ticket-card__meta">
                    <span>{[assignee || ticket.assigned_group?.name, ticket.updated_at ? dayjs(ticket.updated_at).fromNow() : null]
                        .filter(Boolean).join(' · ')}</span>
                    {done && onLogTime && (
                        <Tooltip title={t('ticketLog.action')}>
                            <Button
                                size="small" type="text" icon={<ClockCircleOutlined />}
                                className="ticket-card__log"
                                aria-label={t('ticketLog.actionFor', { ref: ticket.customer_ref || ticket.ticket_number })}
                                onClick={(e) => { e.stopPropagation(); onLogTime(ticket) }}
                                onPointerDown={(e) => e.stopPropagation()}
                            />
                        </Tooltip>
                    )}
                </div>
            </div>
        </div>
    )
}

function TextModal({ open, icon, tone, title, label, hint, okText, pending, onCancel, onSubmit, minLength = 1 }) {
    const t = useT()
    const [form] = Form.useForm()
    return (
        <Modal open={open} onCancel={onCancel} footer={null} destroyOnHidden
               title={<ModalHead icon={icon} tone={tone} title={title} />}>
            <Form form={form} layout="vertical" onFinish={(v) => onSubmit(v.text.trim())}>
                <Form.Item name="text" label={label} extra={hint}
                           rules={[{ required: true, whitespace: true, min: minLength, message: hint || label }]}>
                    <Input.TextArea rows={4} maxLength={10000} autoFocus />
                </Form.Item>
                <div className="lq-mf">
                    <Button onClick={onCancel}>{t('common.cancel')}</Button>
                    <Button type="primary" htmlType="submit" loading={pending}>{okText}</Button>
                </div>
            </Form>
        </Modal>
    )
}

export default function TicketBoard({
    rows = [], assigneeName = {}, canRespond, canResolve, onOpen, onChanged, onError, onLogTime,
}) {
    const t = useT()
    const [activeId, setActiveId] = useState(null)
    const [resolving, setResolving] = useState(null)
    const [replying, setReplying] = useState(null)
    const [reopening, setReopening] = useState(null)
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor),
    )
    const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows])
    const buckets = useMemo(() => {
        const out = { pending: [], in_progress: [], completed: [] }
        rows.forEach((r) => { if (out[r.board_column]) out[r.board_column].push(r) })
        return out
    }, [rows])

    const done = (fn) => ({ onSuccess: (...args) => { onChanged?.(); fn?.(...args) }, onError })
    const resolve = useMutation({ mutationFn: ({ id, payload }) => ticketHubService.resolve(id, payload) })
    const reply = useMutation({ mutationFn: ({ id, body }) => ticketHubService.addMessage(id, { body, visibility: 'public' }) })
    const reopen = useMutation({
        mutationFn: ({ ticket, reason }) => ticketHubService.transition(ticket.id, {
            to_status: 'reopened', reason, expected_version: ticket.version,
        }),
    })

    const onDragEnd = ({ active, over }) => {
        setActiveId(null)
        const ticket = byId[active?.id]
        if (!ticket) return
        const decision = dropDecision(ticket.board_column, over?.id, { canResolve, canRespond })
        if (decision === 'resolve') setResolving(ticket)
        else if (decision === 'reply') setReplying(ticket)
        else if (decision === 'reopen') setReopening(ticket)
        else if (decision?.info) message.info(t(decision.info))
    }

    const active = activeId ? byId[activeId] : null
    return (
        <div className="tasks-board-wrap ticket-board">
            <DndContext sensors={sensors} collisionDetection={closestCorners}
                        onDragStart={({ active: a }) => setActiveId(a.id)} onDragEnd={onDragEnd}
                        onDragCancel={() => setActiveId(null)}>
                <div className="tasks-board">
                    {BOARD_COLUMNS.map(({ key, labelKey, accent }) => {
                        const list = buckets[key]
                        return (
                            <div key={key} className={`tasks-board-column ticket-board-column ticket-board-column--${key}`}
                                 style={{ '--col-accent': accent }}>
                                <div className="tasks-board-column-header">
                                    <span className="tasks-board-column-label">{t(labelKey)}</span>
                                    <span className="tasks-board-column-count">{list.length}</span>
                                </div>
                                <DroppableColumn id={key}>
                                    {list.length === 0 ? (
                                        <div className="tasks-board-column-empty">{t('ticketBoard.empty')}</div>
                                    ) : list.map((ticket) => (
                                        <DraggableCard key={ticket.id} id={ticket.id}>
                                            <TicketCard ticket={ticket} assignee={assigneeName[ticket.assigned_user_id]}
                                                        onOpen={onOpen} onLogTime={onLogTime} />
                                        </DraggableCard>
                                    ))}
                                </DroppableColumn>
                            </div>
                        )
                    })}
                </div>
                <DragOverlay dropAnimation={null}>
                    {active ? (
                        <div className="tasks-board-drag-overlay">
                            <TicketCard ticket={active} assignee={assigneeName[active.assigned_user_id]} />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            <ResolveModal
                open={Boolean(resolving)}
                ticket={resolving}
                pending={resolve.isPending}
                onCancel={() => setResolving(null)}
                onSubmit={(payload) => resolve.mutate({ id: resolving.id, payload }, done(() => {
                    const ticket = resolving
                    setResolving(null)
                    onLogTime?.(ticket)
                }))}
            />
            <TextModal
                open={Boolean(replying)}
                icon={<MessageOutlined />} tone="blue"
                title={t('ticketBoard.replyTitle', { ref: replying?.customer_ref || replying?.ticket_number || '' })}
                label={t('ticket.replyToCustomer')} hint={t('ticketBoard.replyHint')}
                okText={t('hub.sendReply')} pending={reply.isPending}
                onCancel={() => setReplying(null)}
                onSubmit={(body) => reply.mutate({ id: replying.id, body }, done(() => setReplying(null)))}
            />
            <TextModal
                open={Boolean(reopening)}
                icon={<UndoOutlined />} tone="amber"
                title={t('ticketBoard.reopenTitle', { ref: reopening?.customer_ref || reopening?.ticket_number || '' })}
                label={t('ticketBoard.reopenReason')} hint={t('ticketBoard.reopenHint')}
                okText={t('ticketBoard.reopen')} pending={reopen.isPending} minLength={3}
                onCancel={() => setReopening(null)}
                onSubmit={(reason) => reopen.mutate({ ticket: reopening, reason }, done(() => setReopening(null)))}
            />
        </div>
    )
}
