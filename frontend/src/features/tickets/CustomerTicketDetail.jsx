/**
 * =============================================================================
 * HERMES - Müşteri ticket detayı
 * =============================================================================
 * Yalnızca PUBLIC içerik gösterilir; iç notlar ve kök neden bu yanıtta
 * zaten BULUNMAZ (sunucu serializer'ı ayrıdır). Burada ikinci bir
 * filtreleme yapılmaz — tek doğruluk kaynağı sunucudur.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Drawer, Input, message, Typography } from 'antd'

import { supportPortalService, ticketErrorCode } from '../../api/ticketsApi'
import {
    Button, EmptyState, Inline, Stack, StatusBadge, Surface,
} from '../../components/ui'
import { queryKeys } from '../../query/queryKeys'
import TicketTimeline from './TicketTimeline'
import {
    CATEGORY_LABELS, ERROR_MESSAGES, IMPACT_LABELS, RESOLUTION_LABELS,
    labelOf,
} from './constants'
import { TicketStatusBadge } from './TicketStatusBadge'
import './tickets.css'

const { Text, Paragraph } = Typography

export default function CustomerTicketDetail({
    ticketId, open, onClose, onChanged,
}) {
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [reason, setReason] = useState('')

    const detail = useQuery({
        queryKey: queryKeys.supportTickets.detail(ticketId),
        queryFn: () => supportPortalService.get(ticketId),
        enabled: Boolean(ticketId) && open,
    })
    const ticket = detail.data

    const refresh = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.supportTickets.detail(ticketId),
        })
        onChanged?.()
    }

    const handlers = {
        onSuccess: refresh,
        onError: (error) => {
            const code = ticketErrorCode(error)
            message.error(
                ERROR_MESSAGES[code]
                || error?.normalized?.message
                || 'The action could not be completed.',
            )
            if (code === 'ticket_version_conflict') refresh()
        },
    }

    const reply = useMutation({
        mutationFn: (payload) => supportPortalService.reply(ticketId, payload),
        ...handlers,
    })
    const reopen = useMutation({
        mutationFn: (payload) => supportPortalService.reopen(ticketId, payload),
        ...handlers,
    })
    const confirmClose = useMutation({
        mutationFn: (payload) =>
            supportPortalService.confirmClose(ticketId, payload),
        ...handlers,
    })

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width="min(820px, 96vw)"
            title={ticket ? `${ticket.ticket_number} · ${ticket.title}` : 'Request'}
            destroyOnHidden
        >
            {detail.isLoading && <Text type="secondary">Loading…</Text>}
            {detail.isError && (
                <EmptyState
                    title="This request could not be opened"
                    description="It is no longer visible to you."
                />
            )}
            {ticket && (
                <Stack gap={3}>
                    <Inline gap={2}>
                        <TicketStatusBadge status={ticket.status} />
                        <StatusBadge tone="neutral">
                            {labelOf(CATEGORY_LABELS, ticket.category)}
                        </StatusBadge>
                        <StatusBadge tone="neutral">
                            {labelOf(IMPACT_LABELS, ticket.impact)}
                        </StatusBadge>
                        {ticket.assigned_group?.name && (
                            <Text type="secondary">
                                Target team: {ticket.assigned_group.name}
                            </Text>
                        )}
                    </Inline>

                    {ticket.status === 'waiting_customer' && (
                        <Alert
                            type="warning"
                            showIcon
                            message="The support team is waiting for your reply"
                            description="Answer below to keep things moving."
                        />
                    )}

                    {ticket.resolution && (
                        <Stack gap={2} className="h-ticket-resolution">
                            <Inline gap={2}>
                                <StatusBadge tone="success">✓ Resolved</StatusBadge>
                                <Text strong>
                                    {labelOf(
                                        RESOLUTION_LABELS,
                                        ticket.resolution.resolution_code,
                                    )}
                                </Text>
                                <Text type="secondary">
                                    {new Date(
                                        ticket.resolution.resolved_at,
                                    ).toLocaleString()}
                                    {ticket.resolution.resolved_by_team
                                        && ` · ${ticket.resolution.resolved_by_team}`}
                                </Text>
                            </Inline>
                            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                                {ticket.resolution.summary}
                            </Paragraph>
                            {ticket.resolution.workaround && (
                                <Paragraph type="secondary">
                                    Workaround: {ticket.resolution.workaround}
                                </Paragraph>
                            )}
                            {ticket.status === 'resolved' && (
                                <Inline gap={2}>
                                    <Button
                                        variant="primary"
                                        loading={confirmClose.isPending}
                                        onClick={() => confirmClose.mutate({
                                            expected_version: ticket.version,
                                        })}
                                    >
                                        Confirm and close
                                    </Button>
                                    <Input
                                        placeholder="Reason for reopening"
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        style={{ maxWidth: 280 }}
                                    />
                                    <Button
                                        disabled={reason.trim().length < 5}
                                        loading={reopen.isPending}
                                        onClick={() => reopen.mutate({
                                            reason,
                                            expected_version: ticket.version,
                                        })}
                                    >
                                        Reopen
                                    </Button>
                                </Inline>
                            )}
                            {ticket.status === 'resolved'
                                && !ticket.reopen_window_open && (
                                <Text type="secondary">
                                    The verification window has closed. Reply
                                    to the support team if you still need help.
                                </Text>
                            )}
                        </Stack>
                    )}

                    <Surface>
                        <TicketTimeline
                            messages={ticket.messages}
                            downloadUrl={(fileId) =>
                                supportPortalService.downloadUrl(ticket.id, fileId)}
                        />
                    </Surface>

                    <Stack gap={2}>
                        <Input.TextArea
                            rows={4}
                            value={draft}
                            maxLength={10000}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder="Your reply to the support team…"
                            aria-label="Reply to the support team"
                        />
                        <Inline gap={2}>
                            <Button
                                variant="primary"
                                disabled={!draft.trim()}
                                loading={reply.isPending}
                                onClick={() => reply.mutate(
                                    { body: draft, expected_version: ticket.version },
                                    { onSuccess: () => setDraft('') },
                                )}
                            >
                                Reply
                            </Button>
                        </Inline>
                    </Stack>
                </Stack>
            )}
        </Drawer>
    )
}
