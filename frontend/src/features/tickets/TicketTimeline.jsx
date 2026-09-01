/**
 * HERMES - Konusma akisi.
 *
 * Ic not ile musteri yaniti GORSEL OLARAK acikca ayrilir: kilit ikonu,
 * amber cerceve ve "Müşteri göremez" etiketi. Bu ayrimin zayif olmasi,
 * yanlislikla musteriye ic bilgi yazmanin en yaygin nedenidir — bu
 * yuzden renk tek basina yeterli sayilmaz.
 */
import { LockOutlined } from '@ant-design/icons'
import { Typography } from 'antd'

import { Stack, StatusBadge } from '../../components/ui'
import './tickets.css'
import { useT } from '../../i18n'

const { Text } = Typography

const formatWhen = (value) => {
    if (!value) return ''
    try {
        // Tarihler KULLANICININ saat diliminde; API her zaman UTC ISO.
        return new Date(value).toLocaleString()
    } catch {
        return String(value)
    }
}

function AttachmentList({ attachments = [], downloadUrl }) {
    const t = useT()
    if (!attachments.length) return null
    return (
        <ul className="h-ticket-attachments">
            {attachments.map((file) => {
                const ready = file.scan_status === 'clean'
                return (
                    <li key={file.id}>
                        {ready ? (
                            <a
                                href={downloadUrl?.(file.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {file.file_name}
                            </a>
                        ) : (
                            <span>{file.file_name}</span>
                        )}
                        <span className="h-ticket-attachments__meta">
                            {Math.max(1, Math.round((file.size_bytes || 0) / 1024))} KB
                        </span>
                        {file.scan_status === 'pending_scan' && (
                            <StatusBadge tone="warning">{t('ticket.scanning')}</StatusBadge>
                        )}
                        {file.scan_status === 'rejected' && (
                            <StatusBadge tone="danger">{t('ticket.rejected')}</StatusBadge>
                        )}
                    </li>
                )
            })}
        </ul>
    )
}

export function TicketTimeline({ messages = [], downloadUrl }) {
    const t = useT()
    return (
        <Stack gap={3} className="h-ticket-timeline">
            {messages.map((message) => {
                const internal = message.visibility === 'internal'
                const mine = message.author_type === 'requester'
                return (
                    <article
                        key={message.id}
                        className={[
                            'h-ticket-message',
                            internal && 'h-ticket-message--internal',
                            mine && 'h-ticket-message--requester',
                        ].filter(Boolean).join(' ')}
                        aria-label={internal ? 'Internal note' : 'Conversation message'}
                    >
                        <header className="h-ticket-message__head">
                            <strong>
                                {message.author_display_name
                                    || (mine ? 'You' : 'Support')}
                            </strong>
                            {internal && (
                                <StatusBadge tone="warning">
                                    <LockOutlined aria-hidden="true" />
                                    <span>Internal note — hidden from customer</span>
                                </StatusBadge>
                            )}
                            <Text type="secondary" className="h-ticket-message__when">
                                {formatWhen(message.created_at)}
                            </Text>
                        </header>
                        <div className="h-ticket-message__body">
                            {message.body}
                        </div>
                        <AttachmentList
                            attachments={message.attachments}
                            downloadUrl={
                                downloadUrl
                                    ? (fileId) => downloadUrl(fileId)
                                    : undefined
                            }
                        />
                    </article>
                )
            })}
            {!messages.length && (
                <Text type="secondary">{t('misc.noMessages')}</Text>
            )}
        </Stack>
    )
}

export default TicketTimeline
