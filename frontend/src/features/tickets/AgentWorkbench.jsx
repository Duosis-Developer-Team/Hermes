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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Drawer, Select, Skeleton, Typography } from 'antd'

import { ticketErrorCode, ticketHubService } from '../../api/ticketsApi'
import {
    Button, EmptyState, Inline, Stack, StatusBadge, Surface,
} from '../../components/ui'
import { queryKeys } from '../../query/queryKeys'
import AgentComposer from './AgentComposer'
import ResolveModal from './ResolveModal'
import TicketTimeline from './TicketTimeline'
import {
    AGENT_STATUS_LABELS, CATEGORY_LABELS, IMPACT_LABELS,
    RESOLUTION_LABELS, labelOf,
} from './constants'
import { TicketPriorityBadge, TicketStatusBadge } from './TicketStatusBadge'
import './tickets.css'
import { useT } from '../../i18n'

const { Text } = Typography

function ContextPanel({ ticket, groups, onAssignGroup, canAssign, pending }) {
    const t = useT()
    return (
        <Surface className="h-ticket-context">
            <Stack gap={3}>
                <Stack gap={1}>
                    <Text type="secondary">{t('common.status')}</Text>
                    <Inline gap={2}>
                        <TicketStatusBadge status={ticket.status} surface="hub" />
                        <TicketPriorityBadge priority={ticket.priority} />
                    </Inline>
                </Stack>

                <dl>
                    <dt>{t('integrations.application')}</dt>
                    <dd>{ticket.application?.display_name ?? '—'}</dd>
                    <dt>{t('entity.customer')}</dt>
                    <dd>{ticket.source_tenant?.display_name ?? '—'}</dd>
                    <dt>{t('hub.requester')}</dt>
                    <dd>{ticket.requester_display_name ?? '—'}</dd>
                    <dt>{t('hub.category')}</dt>
                    <dd>{labelOf(CATEGORY_LABELS, ticket.category)}</dd>
                    <dt>{t('hub.impact')}</dt>
                    <dd>{labelOf(IMPACT_LABELS, ticket.impact)}</dd>
                    <dt>{t('hub.errorCode')}</dt>
                    <dd>{ticket.error_code || '—'}</dd>
                    <dt>{t('hub.correlation')}</dt>
                    <dd>{ticket.correlation_id || '—'}</dd>
                    <dt>{t('hub.firstResponse')}</dt>
                    <dd>
                        {ticket.first_response_at
                            ? new Date(ticket.first_response_at).toLocaleString()
                            : 'Pending'}
                    </dd>
                </dl>

                {ticket.impact === 'security_or_data_risk' && (
                    <Alert
                        type="warning"
                        showIcon
                        message={t('hub.securityRisk')}
                        description={'Priority stays at least "High". This '
                            + 'is NOT an automatic security incident process; '
                            + 'start one separately if needed.'}
                    />
                )}

                <Stack gap={1}>
                    <Text type="secondary">{t('hub.targetTeam')}</Text>
                    <Select
                        value={ticket.assigned_group?.id}
                        disabled={!canAssign || pending}
                        onChange={onAssignGroup}
                        options={(groups ?? []).map((group) => ({
                            value: group.id,
                            label: `${group.name} (${group.member_count})`,
                        }))}
                        style={{ width: '100%' }}
                    />
                </Stack>

                {Object.keys(ticket.client_context || {}).length > 0 && (
                    <details>
                        <summary>{t('hub.technicalContext')}</summary>
                        <dl>
                            {Object.entries(ticket.client_context).map(
                                ([key, value]) => (
                                    <Fragment key={key}>
                                        <dt>{key}</dt>
                                        <dd>{String(value)}</dd>
                                    </Fragment>
                                ),
                            )}
                        </dl>
                    </details>
                )}
            </Stack>
        </Surface>
    )
}

export default function AgentWorkbench({
    ticketId, open, onClose, context, onChanged, onError,
}) {
    const t = useT()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [resolveOpen, setResolveOpen] = useState(false)
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

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width="min(1100px, 96vw)"
            className="ticket-workbench-drawer"
            title={ticket
                ? `${ticket.ticket_number} · ${ticket.title}`
                : 'Ticket'}
            destroyOnHidden
            /* Eylemler SABIT footer'da: uzun bir zaman cizelgesinin
               altinda kaybolmasinlar. Sablonda birincil eylem her zaman
               gorunur bir yerde durur. */
            footer={ticket ? (
                <Inline gap={2} className="ticket-workbench-drawer__actions">
                    {(ticket.allowed_transitions ?? [])
                        .filter((target) => target !== 'resolved')
                        .map((target) => (
                            <Button
                                key={target}
                                disabled={!canRespond}
                                loading={transition.isPending}
                                onClick={() => transition.mutate({
                                    to_status: target,
                                    expected_version: ticket.version,
                                    public_message:
                                        target === 'waiting_customer'
                                            ? draft || undefined
                                            : undefined,
                                    reason: target === 'cancelled'
                                        ? 'Cancelled by an agent'
                                        : undefined,
                                })}
                            >
                                {labelOf(AGENT_STATUS_LABELS, target)}
                            </Button>
                        ))}
                    {(ticket.allowed_transitions ?? []).includes('resolved') && (
                        <Button
                            variant="primary"
                            disabled={!canResolve}
                            onClick={() => setResolveOpen(true)}
                        >{t('hub.resolve')}</Button>
                    )}
                </Inline>
            ) : null}
        >
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
                                            {labelOf(
                                                RESOLUTION_LABELS,
                                                ticket.resolution.resolution_code,
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

                        <Stack gap={3}>
                            <ContextPanel
                                ticket={ticket}
                                groups={groups.data}
                                canAssign={canAssign}
                                pending={assignGroup.isPending}
                                onAssignGroup={(groupId) => assignGroup.mutate({
                                    group_id: groupId,
                                    expected_version: ticket.version,
                                })}
                            />

                            {ticket.allowed_transitions?.includes(
                                'waiting_customer',
                            ) && (
                                <Text type="secondary">
                                    To move to “Waiting on customer”, write a
                                    customer-visible message in the composer —
                                    the request for information is mandatory.
                                </Text>
                            )}
                        </Stack>
                    </div>
                </Stack>
            )}

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
        </Drawer>
    )
}
