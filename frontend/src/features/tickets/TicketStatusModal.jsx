/**
 * =============================================================================
 * HERMES - Talep paneli (agent) — durum, oncelik, atama, gecmis
 * =============================================================================
 * Basliktaki durum hapindan acilir. Dalga A (00-plan §4.1):
 *   - Gerekce/soru isteyen gecisler (yeniden ac, iptal, musteride bekliyor)
 *     pencerede SORULUR; eskiden gerekcesiz gonderilip sunucudan 409
 *     aliyordu ("yeniden acma calismiyor" hatasi).
 *   - Oncelik, kisi atamasi ("Bana ata"), islem gecmisi (denetim olaylari).
 * Yetki ve kurallarin otoritesi SUNUCUDUR; burasi yalniz gorunum.
 * =============================================================================
 */
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Input, Modal, Select } from 'antd'
import { CustomerServiceOutlined, HistoryOutlined, UserAddOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { authService } from '../../api/authApi'
import { ticketHubService } from '../../api/ticketsApi'
import { Button, StatusBadge } from '../../components/ui'
import { LiquidSegmented, ModalHead } from '../../components/liquid'
import { queryKeys } from '../../query/queryKeys'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'
import { TicketPriorityBadge, TicketStatusBadge } from './TicketStatusBadge'
import { useTicketLabel } from './useTicketLabel'

const PRIORITIES = ['low', 'normal', 'high', 'urgent']
/** Hedef → istenen girdi. Kural sunucuda; burada yalniz soru sorulur. */
const NEEDS_INPUT = { reopened: 'reason', cancelled: 'reason', waiting_customer: 'message' }

/** Grup uyeleri + adlari (kendi tenant dizini). */
function useGroupMembers(groupId, enabled) {
    const ids = useQuery({
        queryKey: ['tickets', 'groupMembers', groupId],
        queryFn: () => ticketHubService.groupMembers(groupId),
        enabled: Boolean(groupId) && enabled,
        staleTime: 60_000,
    })
    const userIds = ids.data?.user_ids ?? []
    const users = useQuery({
        queryKey: queryKeys.authUsersLookup.byIds(userIds),
        queryFn: () => authService.lookupUsers({ ids: userIds }),
        enabled: userIds.length > 0,
        staleTime: 60_000,
    })
    return useMemo(() => {
        const byId = Object.fromEntries((users.data ?? []).map((u) => [u.id, u]))
        return userIds.map((id) => ({ id, name: byId[id]?.full_name || byId[id]?.email || id }))
    }, [userIds, users.data])
}

function eventLine(t, tl, event) {
    const m = event.metadata || {}
    const type = (event.event_type || '').replace(/^ticket\./, '').replace(/\.v\d+$/, '')
    const label = t(`hub.event.${type}`) !== `hub.event.${type}` ? t(`hub.event.${type}`) : type
    if (type === 'status_changed' && m.to_status) {
        return `${label}: ${tl('agentStatus', m.from_status)} → ${tl('agentStatus', m.to_status)}`
    }
    if (type === 'priority_changed' && m.to) return `${label}: ${tl('priority', m.from)} → ${tl('priority', m.to)}`
    if (type === 'assignment_changed' && m.to_group) return `${label}: ${m.from_group || '—'} → ${m.to_group}`
    if (type === 'resolved' && m.resolution_code) return `${label}: ${tl('resolution', m.resolution_code)}`
    return label
}

const actorLabel = (t, type) => {
    const key = `hub.actor.${type}`
    const text = t(key)
    return text !== key ? text : (type || '—')
}

function ActivityLog({ ticketId }) {
    const t = useT()
    const tl = useTicketLabel()
    const [open, setOpen] = useState(false)
    const audit = useQuery({
        queryKey: [...queryKeys.tickets.detail(ticketId), 'audit'],
        queryFn: () => ticketHubService.audit(ticketId),
        enabled: open,
    })
    return (
        <details className="ticket-status-tech" onToggle={(e) => setOpen(e.currentTarget.open)}>
            <summary><HistoryOutlined aria-hidden="true" /> {t('hub.activity')}</summary>
            {audit.isLoading && <p className="lq-note">{t('common.loading')}</p>}
            <ol className="ticket-activity">
                {(audit.data ?? []).slice().reverse().map((event) => (
                    <li key={event.id}>
                        <span className="ticket-activity__what">{eventLine(t, tl, event)}</span>
                        <span className="ticket-activity__meta">
                            {event.actor_display_name || actorLabel(t, event.actor_type)}
                            {' · '}
                            {event.occurred_at ? dayjs(event.occurred_at).format('D MMM HH:mm') : ''}
                        </span>
                        {event.reason && <span className="ticket-activity__reason">“{event.reason}”</span>}
                    </li>
                ))}
            </ol>
        </details>
    )
}

export default function TicketStatusModal({
    open, onClose, ticket, groups, canAssign, canRespond, canResolve, pending,
    draft = '', onAssignGroup, onAssignUser, onPriority, onTransition, onResolve,
}) {
    const t = useT()
    const tl = useTicketLabel()
    const me = useAuthStore((s) => s.user?.id)
    const [target, setTarget] = useState(null)
    const [input, setInput] = useState('')
    const members = useGroupMembers(ticket?.assigned_group?.id, open && Boolean(ticket))
    if (!ticket) return null

    const targets = (ticket.allowed_transitions ?? []).filter((x) => x !== 'resolved')
    const canResolveNow = (ticket.allowed_transitions ?? []).includes('resolved')
    const isMember = members.some((m) => m.id === me)
    const assignedToMe = ticket.assigned_user_id && ticket.assigned_user_id === me

    const pick = (next) => {
        if (!NEEDS_INPUT[next]) { onTransition({ to: next }); return }
        setTarget(next)
        setInput(next === 'waiting_customer' ? draft : '')
    }
    const confirm = () => {
        const kind = NEEDS_INPUT[target]
        onTransition({
            to: target,
            reason: kind === 'reason' ? input.trim() : undefined,
            publicMessage: kind === 'message' ? input.trim() : undefined,
        }, () => { setTarget(null); setInput('') })
    }

    return (
        <Modal
            open={open}
            onCancel={() => { setTarget(null); onClose() }}
            footer={null}
            width={680}
            destroyOnHidden
            className="ticket-status-modal"
            title={(
                <ModalHead
                    icon={<CustomerServiceOutlined />}
                    tone="red"
                    title={t('hub.statusTitle')}
                    subtitle={`${ticket.ticket_number} · ${ticket.title}`}
                />
            )}
        >
            <div className="ticket-status-now">
                <TicketStatusBadge status={ticket.status} surface="hub" />
                <TicketPriorityBadge priority={ticket.priority} />
            </div>

            {(targets.length > 0 || canResolveNow) && (
                <>
                    <h3 className="lq-grp">{t('hub.changeStatus')}</h3>
                    <div className="ticket-status-targets">
                        {targets.map((next) => (
                            <button
                                key={next}
                                type="button"
                                className={`lq-opt__item${target === next ? ' is-on' : ''}`}
                                aria-pressed={target === next}
                                disabled={!canRespond || pending}
                                onClick={() => pick(next)}
                            >
                                <span className="lq-opt__text"><b>{tl('agentStatus', next)}</b></span>
                            </button>
                        ))}
                        {canResolveNow && (
                            <button
                                type="button"
                                className="lq-opt__item ticket-status-targets__resolve"
                                disabled={!canResolve}
                                onClick={onResolve}
                            >
                                <span className="lq-opt__text"><b>{t('hub.resolve')}</b></span>
                            </button>
                        )}
                    </div>
                    {target && (
                        <div className="ticket-status-input">
                            <label htmlFor="ticket-status-input">
                                {NEEDS_INPUT[target] === 'message' ? t('hub.askCustomer') : t('hub.reasonFor', { status: tl('agentStatus', target) })}
                            </label>
                            <Input.TextArea
                                id="ticket-status-input"
                                rows={3}
                                autoFocus
                                maxLength={NEEDS_INPUT[target] === 'message' ? 10000 : 500}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                            />
                            <div className="ticket-status-input__actions">
                                <Button onClick={() => setTarget(null)}>{t('common.cancel')}</Button>
                                <Button variant="primary" disabled={!input.trim() || pending} loading={pending} onClick={confirm}>
                                    {t('hub.applyStatus', { status: tl('agentStatus', target) })}
                                </Button>
                            </div>
                        </div>
                    )}
                    {!target && targets.includes('waiting_customer') && (
                        <p className="lq-note">{t('hub.waitingHint')}</p>
                    )}
                </>
            )}

            <h3 className="lq-grp">{t('hub.priority')}</h3>
            <LiquidSegmented
                ariaLabel={t('hub.priority')}
                value={ticket.priority}
                onChange={(next) => { if (canRespond && !pending && next !== ticket.priority) onPriority(next) }}
                options={PRIORITIES.map((p) => ({ value: p, label: tl('priority', p) }))}
            />

            <h3 className="lq-grp">{t('hub.assignee')}</h3>
            <div className="ticket-assignee">
                <Select
                    aria-label={t('hub.assignee')}
                    value={ticket.assigned_user_id || ''}
                    disabled={!canAssign || pending}
                    onChange={(value) => onAssignUser(value || null)}
                    options={[
                        { value: '', label: t('hub.unassigned') },
                        ...members.map((m) => ({ value: m.id, label: m.name })),
                    ]}
                    style={{ flex: 1, minWidth: 0 }}
                />
                {isMember && !assignedToMe && (
                    <Button icon={<UserAddOutlined />} disabled={!canRespond || pending} onClick={() => onAssignUser(me)}>
                        {t('hub.takeIt')}
                    </Button>
                )}
            </div>

            <h3 className="lq-grp">{t('hub.targetTeam')}</h3>
            <Select
                aria-label={t('hub.targetTeam')}
                value={ticket.assigned_group?.id}
                disabled={!canAssign || pending}
                onChange={onAssignGroup}
                options={(groups ?? []).map((group) => ({
                    value: group.id,
                    label: `${group.name} (${group.member_count})`,
                }))}
                style={{ width: '100%' }}
            />

            <h3 className="lq-grp">{t('review.details')}</h3>
            <dl className="lq-kv">
                <dt>{t('integrations.application')}</dt>
                <dd>{ticket.application?.display_name ?? '—'}</dd>
                <dt>{t('entity.customer')}</dt>
                <dd>{ticket.source_tenant?.display_name ?? '—'}</dd>
                <dt>{t('hub.requester')}</dt>
                <dd>{ticket.requester_display_name ?? '—'}</dd>
                <dt>{t('hub.category')}</dt>
                <dd>{tl('category', ticket.category)}</dd>
                <dt>{t('hub.impact')}</dt>
                <dd>{tl('impact', ticket.impact)}</dd>
                <dt>{t('hub.errorCode')}</dt>
                <dd>{ticket.error_code || '—'}</dd>
                <dt>{t('hub.correlation')}</dt>
                <dd>{ticket.correlation_id || '—'}</dd>
                <dt>{t('hub.firstResponse')}</dt>
                <dd>
                    {ticket.first_response_at
                        ? new Date(ticket.first_response_at).toLocaleString()
                        : t('hub.firstResponsePending')}
                </dd>
                {/* A6: bu talepten dogan is kalemleri */}
                <dt>{t('hub.workItems')}</dt>
                <dd>
                    {(ticket.work_items ?? []).length === 0 ? '—' : (
                        <ul className="h-ticket-work-items">
                            {ticket.work_items.map((w) => (
                                <li key={w.id}>
                                    <Link to={`/project-management/tasks?item=${w.id}`}>{w.item_key}</Link>
                                    {' '}
                                    <span className="h-ticket-work-items__title">{w.title}</span>
                                    {' '}
                                    <StatusBadge tone="neutral">{w.status}</StatusBadge>
                                </li>
                            ))}
                        </ul>
                    )}
                </dd>
            </dl>

            {ticket.impact === 'security_or_data_risk' && (
                <Alert
                    style={{ marginTop: 14 }}
                    type="warning"
                    showIcon
                    message={t('hub.securityRisk')}
                    description={t('hub.securityRiskHint')}
                />
            )}

            {Object.keys(ticket.client_context || {}).length > 0 && (
                <details className="ticket-status-tech">
                    <summary>{t('hub.technicalContext')}</summary>
                    <dl className="lq-kv">
                        {Object.entries(ticket.client_context).map(([key, value]) => (
                            <Fragment key={key}>
                                <dt>{key}</dt>
                                <dd>{String(value)}</dd>
                            </Fragment>
                        ))}
                    </dl>
                </details>
            )}

            <ActivityLog ticketId={ticket.id} />

            <div className="lq-mf">
                <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
        </Modal>
    )
}
