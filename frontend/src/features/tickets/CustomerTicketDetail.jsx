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
import { Alert, Drawer, Input, Rate, message, Typography } from 'antd'

import { supportPortalService, ticketErrorCode } from '../../api/ticketsApi'
import {
    Button, EmptyState, Inline, Stack, StatusBadge, Surface,
} from '../../components/ui'
import { queryKeys } from '../../query/queryKeys'
import AttachmentDropzone from './AttachmentDropzone'
import { readyAttachmentIds } from './attachmentState'
import TicketTimeline from './TicketTimeline'
import { LIVE_REFRESH_MS } from './AgentWorkbench'
import {
    ERROR_MESSAGES,
} from './constants'
import { TicketStatusBadge } from './TicketStatusBadge'
import './tickets.css'
import { useTicketLabel } from './useTicketLabel'
import { useT } from '../../i18n'
import { ModalHead } from '../../components/liquid'
import { CustomerServiceOutlined } from '@ant-design/icons'

const { Text, Paragraph } = Typography

export default function CustomerTicketDetail({
    ticketId, open, onClose, onChanged,
    // Talep agi: talebin saglayicisi (birden fazla saglayicida zorunlu).
    provider,
    attachmentsEnabled = false,
}) {
    const t = useT()
    const tl = useTicketLabel()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [reason, setReason] = useState('')
    const [attachments, setAttachments] = useState([])
    const [cancelling, setCancelling] = useState(false)
    const [cancelReason, setCancelReason] = useState('')
    const [rating, setRating] = useState(0)
    const [ratingComment, setRatingComment] = useState('')
    const [editingRating, setEditingRating] = useState(false)

    const detail = useQuery({
        queryKey: queryKeys.supportTickets.detail(ticketId),
        queryFn: () => supportPortalService.get(ticketId, provider),
        enabled: Boolean(ticketId) && open,
        // Canli yenileme: destek yaniti acik pencereye 30 sn icinde duser.
        refetchInterval: LIVE_REFRESH_MS,
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
        mutationFn: (payload) => supportPortalService.reply(ticketId, payload, provider),
        ...handlers,
    })
    const reopen = useMutation({
        mutationFn: (payload) => supportPortalService.reopen(ticketId, payload, provider),
        ...handlers,
    })
    const confirmClose = useMutation({
        mutationFn: (payload) =>
            supportPortalService.confirmClose(ticketId, payload, provider),
        ...handlers,
    })
    const cancel = useMutation({
        mutationFn: (payload) => supportPortalService.cancel(ticketId, payload, provider),
        ...handlers,
    })
    const rate = useMutation({
        mutationFn: (payload) => supportPortalService.rate(ticketId, payload, provider),
        ...handlers,
        onSuccess: () => { setEditingRating(false); handlers.onSuccess() },
    })

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width="min(820px, 96vw)"
            rootClassName="lq-sheet"
            title={(
                <ModalHead
                    icon={<CustomerServiceOutlined />}
                    tone="red"
                    title={ticket ? ticket.title : 'Request'}
                    subtitle={ticket?.ticket_number}
                />
            )}
            destroyOnHidden
        >
            {detail.isLoading && <Text type="secondary">Loading…</Text>}
            {detail.isError && (
                <EmptyState
                    title={t('customerTicket.cannotOpen')}
                    description={t('customerTicket.noLongerVisible')}
                />
            )}
            {ticket && (
                <Stack gap={3}>
                    <Inline gap={2}>
                        <TicketStatusBadge status={ticket.status} />
                        <StatusBadge tone="neutral">
                            {tl('category', ticket.category)}
                        </StatusBadge>
                        <StatusBadge tone="neutral">
                            {tl('impact', ticket.impact)}
                        </StatusBadge>
                        {ticket.assigned_group?.name && (
                            <Text type="secondary">
                                Target team: {ticket.assigned_group.name}
                            </Text>
                        )}
                    </Inline>

                    {ticket.can_cancel && (
                        <div className="customer-cancel">
                            {!cancelling ? (
                                <Button onClick={() => setCancelling(true)}>{t('customerTicket.cancelRequest')}</Button>
                            ) : (
                                <Inline gap={2}>
                                    <Input
                                        autoFocus
                                        placeholder={t('customerTicket.cancelReason')}
                                        aria-label={t('customerTicket.cancelReason')}
                                        value={cancelReason}
                                        maxLength={500}
                                        onChange={(e) => setCancelReason(e.target.value)}
                                        style={{ maxWidth: 320 }}
                                    />
                                    <Button
                                        danger
                                        disabled={!cancelReason.trim()}
                                        loading={cancel.isPending}
                                        onClick={() => cancel.mutate(
                                            { reason: cancelReason.trim(), expected_version: ticket.version },
                                            { onSuccess: () => { setCancelling(false); setCancelReason('') } },
                                        )}
                                    >{t('customerTicket.confirmCancel')}</Button>
                                    <Button onClick={() => setCancelling(false)}>{t('common.cancel')}</Button>
                                </Inline>
                            )}
                        </div>
                    )}

                    {ticket.status === 'waiting_customer' && (
                        <Alert
                            type="warning"
                            showIcon
                            message={t('customerTicket.waitingForYou')}
                            description={t('customerTicket.answerBelow')}
                        />
                    )}

                    {ticket.resolution && (
                        <Stack gap={2} className="h-ticket-resolution">
                            <Inline gap={2}>
                                <StatusBadge tone="success">✓ Resolved</StatusBadge>
                                <Text strong>
                                    {tl('resolution', ticket.resolution.resolution_code,
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
                                    >{t('customerTicket.confirmAndClose')}</Button>
                                    <Input
                                        placeholder={t('customerTicket.reasonForReopening')}
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        style={{ maxWidth: 280 }}
                                    />
                                    <Button
                                        disabled={!reason.trim()}
                                        loading={reopen.isPending}
                                        onClick={() => reopen.mutate({
                                            reason,
                                            expected_version: ticket.version,
                                        })}
                                    >{t('customerTicket.reopen')}</Button>
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

                    {ticket.can_rate && (
                        <div className="customer-csat" role="group" aria-label={t('customerTicket.rateTitle')}>
                            {ticket.csat && !editingRating ? (
                                <p>
                                    <Rate disabled value={ticket.csat.rating} />{' '}
                                    <span className="lq-note">{t('customerTicket.thanksForRating')}</span>{' '}
                                    <Button size="small" variant="ghost" onClick={() => {
                                        setRating(ticket.csat.rating); setRatingComment(ticket.csat.comment || ''); setEditingRating(true)
                                    }}>{t('customerTicket.changeRating')}</Button>
                                </p>
                            ) : (
                                <>
                                    <b>{t('customerTicket.rateTitle')}</b>
                                    <Rate value={rating} onChange={setRating} aria-label={t('customerTicket.rateTitle')} />
                                    {rating > 0 && (
                                        <>
                                            <Input.TextArea
                                                rows={2} maxLength={1000} value={ratingComment}
                                                placeholder={t('customerTicket.rateComment')}
                                                aria-label={t('customerTicket.rateComment')}
                                                onChange={(e) => setRatingComment(e.target.value)}
                                            />
                                            <Inline gap={2}>
                                                <Button
                                                    variant="primary" loading={rate.isPending}
                                                    onClick={() => rate.mutate({ rating, comment: ratingComment.trim() || undefined })}
                                                >{t('customerTicket.sendRating')}</Button>
                                            </Inline>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    <Surface>
                        <TicketTimeline
                            selfType="requester"
                            messages={ticket.messages}
                            downloadUrl={(fileId) =>
                                supportPortalService.downloadUrl(ticket.id, fileId, provider)}
                        />
                    </Surface>

                    <Stack gap={2}>
                        <Input.TextArea
                            rows={4}
                            value={draft}
                            maxLength={10000}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder={t('customerTicket.replyPlaceholder')}
                            aria-label={t('customerTicket.replyToSupport')}
                        />
                        <AttachmentDropzone
                            enabled={attachmentsEnabled}
                            value={attachments}
                            onChange={setAttachments}
                            onOpenSession={(params) => supportPortalService.openAttachmentSession(
                                provider ? { ...params, provider } : params,
                            )}
                            onUploadContent={(id, file) =>
                                supportPortalService.uploadAttachmentContent(id, file, provider)}
                        />
                        <Inline gap={2}>
                            <Button
                                variant="primary"
                                disabled={!draft.trim()}
                                loading={reply.isPending}
                                onClick={() => reply.mutate(
                                    {
                                        body: draft,
                                        expected_version: ticket.version,
                                        attachment_ids: readyAttachmentIds(attachments),
                                    },
                                    { onSuccess: () => { setDraft(''); setAttachments([]) } },
                                )}
                            >{t('customerTicket.reply')}</Button>
                        </Inline>
                    </Stack>
                </Stack>
            )}
        </Drawer>
    )
}
