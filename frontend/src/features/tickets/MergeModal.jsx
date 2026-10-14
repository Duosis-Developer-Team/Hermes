/**
 * HERMES - Talep birlestirme (Dalga D1).
 *
 * Bu talep (kaynak) secilen talebe (hedef) birlestirilir: kaynak "mukerrer"
 * olarak cozulur, yazismasi hedefe ic not olarak tasinir, takipci ve
 * etiketler hedefe gecer. Yalniz AYNI musterinin acik talepleri hedef
 * olabilir (sunucu da dogrular). Musteriye gidecek mesaj duzenlenebilir.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Input, Modal, Select } from 'antd'
import { MergeCellsOutlined } from '@ant-design/icons'

import { ticketHelpdeskService, ticketHubService } from '../../api/ticketsApi'
import { ModalHead } from '../../components/liquid'
import { useT } from '../../i18n'
import { TicketStatusBadge } from './TicketStatusBadge'
import { ticketRef } from './constants'

const OPEN_TARGET = (row) => !['closed', 'cancelled'].includes(row.status)

export default function MergeModal({ open, ticket, onClose, onMerged }) {
    const t = useT()
    const [query, setQuery] = useState('')
    const [targetId, setTargetId] = useState(null)
    const [message, setMessage] = useState('')
    const [edited, setEdited] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!open) return
        setQuery(''); setTargetId(null); setMessage(''); setEdited(false); setError(null)
    }, [open])

    const history = useQuery({
        queryKey: ['tickets', 'requester-history', ticket?.id],
        queryFn: () => ticketHelpdeskService.requesterHistory(ticket.id),
        enabled: open && Boolean(ticket),
    })
    const search = useQuery({
        queryKey: ['tickets', 'merge-search', ticket?.id, query],
        queryFn: () => ticketHubService.list({ queue: 'all', search: query, limit: 20 }),
        enabled: open && Boolean(ticket) && query.trim().length >= 2,
    })
    const candidates = useMemo(() => {
        if (!ticket) return []
        const same = (row) => row.id !== ticket.id
            && row.source_tenant?.id === ticket.source_tenant?.id
            && row.application?.id === ticket.application?.id
            && OPEN_TARGET(row)
        const rows = [...(history.data ?? []), ...(search.data?.items ?? [])].filter(same)
        return [...new Map(rows.map((r) => [r.id, r])).values()]
    }, [ticket, history.data, search.data])
    const target = candidates.find((r) => r.id === targetId)

    useEffect(() => {
        if (target && !edited) setMessage(t('merge.customerMessage', { number: ticketRef(target) }))
    }, [target, edited, t])

    if (!ticket) return null
    const submit = async () => {
        setBusy(true); setError(null)
        try {
            const merged = await ticketHelpdeskService.merge(ticket.id, {
                target_ticket_id: targetId,
                public_summary: message.trim(),
                note_header: t('merge.noteHeader', { number: ticketRef(ticket) }),
                expected_version: ticket.version,
            })
            onMerged?.(merged)
        } catch (err) {
            const d = err?.response?.data?.detail
            setError((typeof d === 'string' ? d : d?.message) || t('merge.failed'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal
            open={open}
            title={<ModalHead icon={<MergeCellsOutlined />} tone="violet" title={t('merge.title')}
                              subtitle={`${ticketRef(ticket)} · ${ticket.title}`} />}
            onCancel={onClose}
            onOk={submit}
            okText={t('merge.confirm')}
            okButtonProps={{ disabled: !targetId || !message.trim(), loading: busy }}
            width={620}
            destroyOnHidden
        >
            <div className="pc-form">
                <p className="lq-note">{t('merge.hint')}</p>
                <label className="sla-field">
                    <span>{t('merge.target')}</span>
                    <Select
                        showSearch
                        filterOption={false}
                        aria-label={t('merge.target')}
                        placeholder={t('merge.searchPlaceholder')}
                        value={targetId}
                        onSearch={setQuery}
                        onChange={setTargetId}
                        notFoundContent={t('merge.noCandidates')}
                        options={candidates.map((row) => ({
                            value: row.id,
                            label: `${ticketRef(row)} · ${row.title}`,
                        }))}
                    />
                </label>
                {target && (
                    <div className="merge-preview">
                        <span className="tickets-row__code">{ticketRef(target)}</span>
                        <b>{target.title}</b>
                        <TicketStatusBadge status={target.status} surface="hub" />
                    </div>
                )}
                <label className="sla-field">
                    <span>{t('merge.customerMessageLabel')}</span>
                    <Input.TextArea
                        rows={3} maxLength={2000} value={message}
                        aria-label={t('merge.customerMessageLabel')}
                        onChange={(e) => { setMessage(e.target.value); setEdited(true) }}
                    />
                </label>
                {error && <Alert type="error" showIcon message={error} />}
            </div>
        </Modal>
    )
}
