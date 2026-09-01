/**
 * HERMES - Agent composer'i (müşteriye yanıt / iç not).
 *
 * Mod secimi ACIK bir segmented control'dur ve secili mod hem cerceve
 * rengi hem de ACIK BIR CUMLE ile tekrarlanir. Bu, "yanlislikla musteriye
 * ic bilgi yazma" riskinin tek gercek onlemidir; renk tek basina yeterli
 * degildir.
 *
 * Enter TEK BASINA GONDERMEZ: uzun bir yaniti yazarken kazara gonderim,
 * geri alinamaz bir islemdir (mesaj duzenleme/silme v1'de YOK).
 */
import { useState } from 'react'
import { LockOutlined, SendOutlined } from '@ant-design/icons'
import { Input, Segmented, Typography } from 'antd'

import { ticketHubService } from '../../api/ticketsApi'
import { Button, Inline, Stack } from '../../components/ui'
import AttachmentDropzone from './AttachmentDropzone'
import { readyAttachmentIds } from './attachmentState'
import './tickets.css'
import { useT } from '../../i18n'

const { Text } = Typography

export function AgentComposer({
    onSubmit, pending = false, canRespond = true, value, onChange,
    attachmentsEnabled = false,
}) {
    const t = useT()
    const [visibility, setVisibility] = useState('public')
    const [internalDraft, setInternalDraft] = useState('')
    const [attachments, setAttachments] = useState([])
    const draft = value ?? internalDraft
    const setDraft = onChange ?? setInternalDraft

    const internal = visibility === 'internal'
    if (!canRespond) {
        return (
            <Text type="secondary">{t('ticket.noReplyPermission')}</Text>
        )
    }

    const submit = () => {
        const body = draft.trim()
        if (!body || pending) return
        // Ek gorunurlugu composer MODUNDAN turetilir: ic nota eklenen
        // dosya musteriye ACILMAZ.
        onSubmit({
            body,
            visibility,
            attachment_ids: readyAttachmentIds(attachments),
        })
        setDraft('')
        setAttachments([])
    }

    return (
        <Stack
            gap={2}
            className={internal
                ? 'h-ticket-composer--internal'
                : 'h-ticket-composer--public'}
        >
            <Inline gap={2}>
                <Segmented
                    value={visibility}
                    onChange={setVisibility}
                    aria-label={t('ticket.messageVisibility')}
                    options={[
                        { label: t('ticket.replyToCustomer'), value: 'public' },
                        {
                            label: (
                                <span>
                                    <LockOutlined aria-hidden="true" />{t('ticket.internalNote')}</span>
                            ),
                            value: 'internal',
                        },
                    ]}
                />
                <Text type={internal ? 'warning' : 'secondary'}>
                    {internal
                        ? 'Hidden from the customer — support team only.'
                        : 'The customer will see this and be notified.'}
                </Text>
            </Inline>
            <Input.TextArea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                maxLength={10000}
                placeholder={internal
                    ? 'Note for the team…'
                    : 'Your reply to the customer…'}
                aria-label={internal ? 'Internal note' : 'Reply to customer'}
            />
            <AttachmentDropzone
                enabled={attachmentsEnabled}
                value={attachments}
                onChange={setAttachments}
                onOpenSession={(params) =>
                    ticketHubService.openAttachmentSession({
                        ...params, visibility_mode: visibility,
                    })}
                onUploadContent={ticketHubService.uploadAttachmentContent}
            />
            <Inline gap={2}>
                <Button
                    variant="primary"
                    icon={<SendOutlined />}
                    loading={pending}
                    disabled={!draft.trim()}
                    onClick={submit}
                >
                    {internal ? 'Save internal note' : 'Send reply'}
                </Button>
            </Inline>
        </Stack>
    )
}

export default AgentComposer
