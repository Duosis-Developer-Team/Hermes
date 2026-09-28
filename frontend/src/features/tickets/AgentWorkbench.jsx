/**
 * =============================================================================
 * HERMES - Agent workbench (ticket detayı)
 * =============================================================================
 * Sol/ana kolon konuşma + composer, sağ kolon bağlam ve aksiyonlar.
 * Mobilde tek kolona düşer.
 *
 * TASLAK KORUNUR: sürüm çakışması veya ağ hatası composer'daki metni
 * SİLMEZ. Yazılmış bir yanıtı bir 409 yüzünden kaybettirmek, kullanıcının
 * bu ekrana güvenini bitiren türden bir davranıştır.
 */
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Drawer, Modal, Select, Skeleton, Typography } from 'antd'

import { ticketErrorCode, ticketHubService } from '../../api/ticketsApi'
import {
    Button, EmptyState, Inline, Stack, StatusBadge,
} from '../../components/ui'
import { queryKeys } from '../../query/queryKeys'
import AgentComposer from './AgentComposer'
import ResolveModal from './ResolveModal'
import ConvertToWorkItemModal from './ConvertToWorkItemModal'
import TicketTimeline from './TicketTimeline'

import { TicketPriorityBadge, TicketStatusBadge } from './TicketStatusBadge'
import './tickets.css'
import { useTicketLabel } from './useTicketLabel'
import { useT } from '../../i18n'
import { ModalHead } from '../../components/liquid'
import { CustomerServiceOutlined, DownOutlined } from '@ant-design/icons'

const { Text } = Typography

/**
 * Talep durumu penceresi (Hermes Liquid): basliktaki durum hapindan acilir.
 * Eskiden sagda duran baglam kolonunun (durum, ayrintilar, hedef ekip)
 * yerini alir — gorunum simetrik kalir, bilgi tek dokunusla gelir.
 * Durum gecisi ve Coz burada; davranis cagirandaki mutasyonlarla ayni.
 */
function TicketStatusModal({
    open, onClose, ticket, groups, canAssign, canRespond, canResolve, pending,
    onAssignGroup, onTransition, onResolve,
}) {
    const t = useT()
    const tl = useTicketLabel()
    if (!ticket) return null
    const targets = (ticket.allowed_transitions ?? []).filter((x) => x !== 'resolved')
    const canResolveNow = (ticket.allowed_transitions ?? []).includes('resolved')
    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={640}
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
                        {targets.map((target) => (
                            <button
                                key={target}
                                type="button"
                                className="lq-opt__item"
                                disabled={!canRespond || pending}
                                onClick={() => onTransition(target)}
                            >
                                <span className="lq-opt__text">
                                    <b>{tl('agentStatus', target)}</b>
                                </span>
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
                    {targets.includes('waiting_customer') && (
                        <p className="lq-note">{t('hub.waitingHint')}</p>
                    )}
                </>
            )}

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
                {/* A6: bu ticket'tan dogan is kalemleri */}
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

            <div className="lq-mf">
                <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
        </Modal>
    )
}

export default function AgentWorkbench({
    ticketId, open, onClose, context, onChanged, onError, inline = false,
}) {
    const t = useT()
    const tl = useTicketLabel()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [resolveOpen, setResolveOpen] = useState(false)
    const [convertOpen, setConvertOpen] = useState(false)
    const [statusOpen, setStatusOpen] = useState(false)
    const [conflict, setConflict] = useState(false)

    useEffect(() => {
        setDraft('')
        setConflict(false)
    }, [ticketId])

    const detail = useQuery({
        queryKey: queryKeys.tickets.detail(ticketId),
        queryFn: () => ticketHubService.get(ticketId),
        enabled: Boolean(ticketId) && open,
    })

    const groups = useQuery({
        queryKey: queryKeys.tickets.routingGroups,
        queryFn: ticketHubService.routingGroups,
        enabled: open,
        staleTime: 300_000,
    })

    const ticket = detail.data

    const refresh = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.tickets.detail(ticketId),
        })
        onChanged?.()
    }

    // Her komut AYNI hata/tazeleme davranisini paylasir; `handlers`
    // tek yerde tanimli. Hook'lar kosulsuz ve sabit sirada cagrilir.
    const handlers = {
        onSuccess: () => { setConflict(false); refresh() },
        onError: (error) => {
            if (ticketErrorCode(error) === 'ticket_version_conflict') {
                // Taslak KORUNUR; yalnizca veri tazelenir ve uyari cikar.
                setConflict(true)
                refresh()
            }
            onError?.(error)
        },
    }

    const reply = useMutation({
        mutationFn: (payload) => ticketHubService.addMessage(ticketId, payload),
        ...handlers,
    })
    const transition = useMutation({
        mutationFn: (payload) => ticketHubService.transition(ticketId, payload),
        ...handlers,
    })
    const assignGroup = useMutation({
        mutationFn: (payload) => ticketHubService.assignGroup(ticketId, payload),
        ...handlers,
    })
    const resolve = useMutation({
        mutationFn: (payload) => ticketHubService.resolve(ticketId, payload),
        ...handlers,
    })

    const canRespond = context?.can('tickets.respond')
        || context?.can('tickets.admin')
    const canResolve = context?.can('tickets.resolve')
        || context?.can('tickets.admin')
    const canAssign = context?.can('tickets.assign')
        || context?.can('tickets.admin')

    // Eylemler (gecis, coz, is kalemi ac) — cekmecede sabit altlikta,
    // satir ici bolmede basligin sagindadir (Hermes Liquid prototipi).
    const doTransition = (target) => transition.mutate({
        to_status: target,
        expected_version: ticket.version,
        public_message: target === 'waiting_customer' ? draft || undefined : undefined,
        reason: target === 'cancelled' ? 'Cancelled by an agent' : undefined,
    }, { onSuccess: () => setStatusOpen(false) })

    // Baslik eylemleri (Liquid): tiklanabilir durum hapi → Talep durumu
    // penceresi; Coz ve Is kalemi ac yaninda. Durum gecisleri pencerede.
    const actions = ticket ? (
                <Inline gap={2} className="ticket-workbench-drawer__actions">
                    <button
                        type="button"
                        className="ticket-status-chip"
                        aria-haspopup="dialog"
                        aria-label={`${t('hub.statusTitle')}: ${tl('agentStatus', ticket.status)}`}
                        onClick={() => setStatusOpen(true)}
                    >
                        <TicketStatusBadge status={ticket.status} surface="hub" />
                        <TicketPriorityBadge priority={ticket.priority} />
                        <DownOutlined aria-hidden="true" />
                    </button>
                    {(ticket.allowed_transitions ?? []).includes('resolved') && (
                        <Button
                            variant="primary"
                            disabled={!canResolve}
                            onClick={() => setResolveOpen(true)}
                        >{t('hub.resolve')}</Button>
                    )}
                    {/* A6: talep → is */}
                    <Button
                        disabled={!canRespond}
                        onClick={() => setConvertOpen(true)}
                    >{t('hub.createWorkItem')}</Button>
                </Inline>
            ) : null

    const body = (
        <>
            {detail.isLoading && (
                <Skeleton active paragraph={{ rows: 8 }} />
            )}
            {detail.isError && (
                <EmptyState
                    title={t('hub.cannotOpen')}
                    description={t('hub.outOfScope')}
                />
            )}
            {ticket && (
                <Stack gap={3}>
                    {conflict && (
                        <Alert
                            type="warning"
                            showIcon
                            message={t('hub.changedWhileViewing')}
                            description={t('hub.changedHint')}
                            closable
                            onClose={() => setConflict(false)}
                        />
                    )}

                    <div className="h-ticket-workbench">
                        <Stack gap={3}>
                            {ticket.resolution && (
                                <Stack gap={1} className="h-ticket-resolution">
                                    <Inline gap={2}>
                                        <StatusBadge tone="success">
                                            ✓ Resolution #{ticket.resolution.revision}
                                        </StatusBadge>
                                        <Text strong>
                                            {tl('resolution', ticket.resolution.resolution_code,
                                            )}
                                        </Text>
                                    </Inline>
                                    <Text>{ticket.resolution.summary}</Text>
                                    {ticket.resolution.internal_root_cause && (
                                        <Text type="warning">
                                            Root cause (team only):{' '}
                                            {ticket.resolution.internal_root_cause}
                                        </Text>
                                    )}
                                </Stack>
                            )}

                            <TicketTimeline
                                messages={ticket.messages}
                                downloadUrl={(fileId) =>
                                    ticketHubService.downloadUrl(ticket.id, fileId)}
                            />

                            <AgentComposer
                                canRespond={canRespond}
                                attachmentsEnabled={context?.attachmentsEnabled}
                                pending={reply.isPending}
                                value={draft}
                                onChange={setDraft}
                                onSubmit={(payload) => reply.mutate({
                                    ...payload,
                                    expected_version: ticket.version,
                                })}
                            />
                        </Stack>

                    </div>
                </Stack>
            )}

            <ConvertToWorkItemModal

                open={convertOpen}

                ticket={ticket}

                onClose={() => setConvertOpen(false)}

                onCreated={() => refresh()}

            />

            <TicketStatusModal
                open={statusOpen}
                onClose={() => setStatusOpen(false)}
                ticket={ticket}
                groups={groups.data}
                canAssign={canAssign}
                canRespond={canRespond}
                canResolve={canResolve}
                pending={assignGroup.isPending || transition.isPending}
                onAssignGroup={(groupId) => assignGroup.mutate({
                    group_id: groupId,
                    expected_version: ticket.version,
                })}
                onTransition={doTransition}
                onResolve={() => { setStatusOpen(false); setResolveOpen(true) }}
            />

            <ResolveModal
                open={resolveOpen}
                ticket={ticket}
                pending={resolve.isPending}
                onCancel={() => setResolveOpen(false)}
                onSubmit={(payload) => {
                    resolve.mutate(payload, {
                        onSuccess: () => setResolveOpen(false),
                    })
                }}
            />
        </>
    )

    if (inline) {
        return (
            <section className="ticket-pane lq-card" aria-live="polite">
                {!ticketId ? (
                    <EmptyState title={t('hub.pickTicket')} description={t('hub.pickTicketHint')} />
                ) : (
                    <>
                        {ticket && (
                            <header className="ticket-pane__head">
                                <div className="ticket-pane__titles">
                                    <span className="ticket-pane__code">{ticket.ticket_number}</span>
                                    <h2 className="ticket-pane__title">{ticket.title}</h2>
                                </div>
                                {actions}
                            </header>
                        )}
                        {body}
                    </>
                )}
            </section>
        )
    }

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width="min(1100px, 96vw)"
            className="ticket-workbench-drawer"
            rootClassName="lq-sheet"
            title={(
                <ModalHead
                    icon={<CustomerServiceOutlined />}
                    tone="red"
                    title={ticket ? ticket.title : 'Ticket'}
                    subtitle={ticket?.ticket_number}
                />
            )}
            destroyOnHidden
            /* Eylemler SABIT footer'da: uzun bir zaman cizelgesinin
               altinda kaybolmasinlar. Sablonda birincil eylem her zaman
               gorunur bir yerde durur. */
            footer={actions}
        >
            {body}
        </Drawer>
    )
}
