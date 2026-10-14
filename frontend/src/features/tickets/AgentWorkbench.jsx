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
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Drawer, Skeleton, Typography } from 'antd'

import { ticketErrorCode, ticketHelpdeskService, ticketHubService } from '../../api/ticketsApi'
import {
    Button, EmptyState, Inline, Stack, StatusBadge,
} from '../../components/ui'
import { queryKeys } from '../../query/queryKeys'
import AgentComposer from './AgentComposer'
import ResolveModal from './ResolveModal'
import ConvertToWorkItemModal from './ConvertToWorkItemModal'
import TicketTimeline from './TicketTimeline'
import TicketStatusModal from './TicketStatusModal'
import MergeModal from './MergeModal'
import SlaBadge, { TagChips } from './SlaBadge'

import { TicketPriorityBadge, TicketStatusBadge } from './TicketStatusBadge'
import './tickets.css'
import { useTicketLabel } from './useTicketLabel'
import { useT } from '../../i18n'
import { ModalHead } from '../../components/liquid'
import {
    CustomerServiceOutlined, DownOutlined, EyeInvisibleOutlined, EyeOutlined, MergeCellsOutlined,
} from '@ant-design/icons'

const { Text } = Typography

/** Birlestirilebilir (kaynak) durumlar — sunucu da dogrular. */
const MERGEABLE = ['open', 'in_progress', 'waiting_customer', 'reopened']

/** Acik talebin ve listenin canli yenileme araligi. */
export const LIVE_REFRESH_MS = 30_000

export default function AgentWorkbench({
    ticketId, open, onClose, context, onChanged, onError, inline = false,
    onOpenTicket,
}) {
    const t = useT()
    const tl = useTicketLabel()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [resolveOpen, setResolveOpen] = useState(false)
    const [convertOpen, setConvertOpen] = useState(false)
    const [statusOpen, setStatusOpen] = useState(false)
    const [mergeOpen, setMergeOpen] = useState(false)
    const [conflict, setConflict] = useState(false)

    useEffect(() => {
        setDraft('')
        setConflict(false)
    }, [ticketId])

    // Canli yenileme: acik talep 30 sn'de bir tazelenir (sekme gorunurken;
    // react-query arka planda yoklamaz). Taslak bundan etkilenmez.
    const detail = useQuery({
        queryKey: queryKeys.tickets.detail(ticketId),
        queryFn: () => ticketHubService.get(ticketId),
        enabled: Boolean(ticketId) && open,
        refetchInterval: LIVE_REFRESH_MS,
    })

    const groups = useQuery({
        queryKey: queryKeys.tickets.routingGroups,
        queryFn: ticketHubService.routingGroups,
        enabled: open,
        staleTime: 300_000,
    })

    const ticket = detail.data

    const macros = useQuery({
        queryKey: queryKeys.tickets.macros,
        queryFn: ticketHelpdeskService.macros,
        enabled: open,
        staleTime: 300_000,
    })
    const tagCatalog = useQuery({
        queryKey: queryKeys.tickets.tags,
        queryFn: () => ticketHelpdeskService.tags(),
        enabled: open,
        staleTime: 300_000,
    })

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
    const assignUser = useMutation({
        mutationFn: (payload) => ticketHubService.assignUser(ticketId, payload),
        ...handlers,
    })
    const priority = useMutation({
        mutationFn: (payload) => ticketHubService.setPriority(ticketId, payload),
        ...handlers,
    })
    const applyMacro = useMutation({
        mutationFn: ({ macro, body }) => ticketHelpdeskService.applyMacro(ticketId, macro.id, {
            body: body || undefined, expected_version: ticket.version,
        }),
        ...handlers,
    })
    const setTags = useMutation({
        mutationFn: (tagIds) => ticketHelpdeskService.setTicketTags(ticketId, tagIds),
        ...handlers,
    })
    const watch = useMutation({
        mutationFn: (watching) => ticketHelpdeskService.watch(ticketId, watching),
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
    // Gerekce/soru isteyen gecislerde girdi pencerede SORULUR (Dalga A:
    // eskiden "yeniden ac" gerekcesiz gidiyor ve 409 aliyordu).
    const doTransition = ({ to, reason, publicMessage }, done) => transition.mutate({
        to_status: to,
        expected_version: ticket.version,
        public_message: publicMessage || undefined,
        reason: reason || undefined,
    }, {
        onSuccess: () => {
            done?.()
            if (to === 'waiting_customer' && publicMessage && publicMessage === draft.trim()) setDraft('')
            setStatusOpen(false)
        },
    })

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
                    {MERGEABLE.includes(ticket.status) && !ticket.merged_into && (
                        <Button
                            icon={<MergeCellsOutlined />}
                            disabled={!canResolve}
                            onClick={() => setMergeOpen(true)}
                        >{t('merge.action')}</Button>
                    )}
                    <Button
                        icon={ticket.watching ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                        aria-pressed={Boolean(ticket.watching)}
                        loading={watch.isPending}
                        onClick={() => watch.mutate(!ticket.watching)}
                    >{ticket.watching ? t('hub.unwatch') : t('hub.watch')}</Button>
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
                    {ticket.merged_into && (
                        <Alert
                            type="info"
                            showIcon
                            message={t('merge.mergedInto', { number: ticket.merged_into.ticket_number })}
                            action={onOpenTicket && (
                                <Button size="small" onClick={() => onOpenTicket(ticket.merged_into.id)}>
                                    {t('merge.open')}
                                </Button>
                            )}
                        />
                    )}
                    {(ticket.merged_from ?? []).length > 0 && (
                        <p className="ticket-merged-from">
                            <MergeCellsOutlined aria-hidden="true" /> {t('merge.mergedFrom')}{' '}
                            {ticket.merged_from.map((ref, i) => (
                                <span key={ref.id}>
                                    {i > 0 && ', '}
                                    {onOpenTicket
                                        ? <button type="button" className="ticket-link" onClick={() => onOpenTicket(ref.id)}>{ref.ticket_number}</button>
                                        : ref.ticket_number}
                                </span>
                            ))}
                        </p>
                    )}
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

                            {(ticket.sla || (ticket.tags ?? []).length > 0 || ticket.csat) && (
                                <div className="ticket-meta-strip">
                                    <SlaBadge sla={ticket.sla} showMet />
                                    <TagChips tags={ticket.tags} />
                                    {ticket.csat && (
                                        <span className="h-badge h-badge--brand" title={ticket.csat.comment || undefined}>
                                            {t('hub.csatChip', { rating: ticket.csat.rating })}
                                            {ticket.csat.comment ? ` · “${ticket.csat.comment}”` : ''}
                                        </span>
                                    )}
                                </div>
                            )}

                            <AgentComposer
                                canRespond={canRespond}
                                attachmentsEnabled={context?.attachmentsEnabled}
                                macros={macros.data ?? []}
                                onApplyMacro={(macro, body) => applyMacro.mutate({ macro, body })}
                                pending={reply.isPending || applyMacro.isPending}
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
                pending={assignGroup.isPending || transition.isPending
                    || assignUser.isPending || priority.isPending || setTags.isPending}
                draft={draft}
                tagCatalog={tagCatalog.data ?? []}
                onTags={(tagIds) => setTags.mutate(tagIds)}
                onOpenTicket={onOpenTicket ? (id) => { setStatusOpen(false); onOpenTicket(id) } : undefined}
                onAssignGroup={(groupId) => assignGroup.mutate({
                    group_id: groupId,
                    expected_version: ticket.version,
                })}
                onAssignUser={(userId) => assignUser.mutate({
                    user_id: userId,
                    expected_version: ticket.version,
                })}
                onPriority={(next) => priority.mutate({
                    priority: next,
                    expected_version: ticket.version,
                })}
                onTransition={doTransition}
                onResolve={() => { setStatusOpen(false); setResolveOpen(true) }}
            />

            <MergeModal
                open={mergeOpen}
                ticket={ticket}
                onClose={() => setMergeOpen(false)}
                onMerged={(merged) => {
                    setMergeOpen(false)
                    refresh()
                    queryClient.invalidateQueries({ queryKey: queryKeys.tickets.detail(merged.id) })
                    onOpenTicket?.(merged.id)
                }}
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
