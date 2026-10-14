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
import { LockOutlined, ReadOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Input, Segmented, Select, Typography } from 'antd'

import { useQuery } from '@tanstack/react-query'

import { kbService, ticketHubService } from '../../api/ticketsApi'
import { markdownToText } from '../kb/MiniMarkdown'
import { Button, Inline, Stack } from '../../components/ui'
import AttachmentDropzone from './AttachmentDropzone'
import { readyAttachmentIds } from './attachmentState'
import './tickets.css'
import { useT } from '../../i18n'
import { useTicketLabel } from './useTicketLabel'

const { Text } = Typography

export function AgentComposer({
    onSubmit, pending = false, canRespond = true, value, onChange,
    attachmentsEnabled = false,
    // Dalga B: hazir yanitlar. Eylemli makro (durum/oncelik/etiket) sunucuda
    // TEK transaction'da uygulanir (`onApplyMacro(macro, body)`).
    macros = [], onApplyMacro,
    // Dalga D3: bilgi bankasindan makale ekleme (metin taslaga eklenir).
    kbEnabled = false,
}) {
    const t = useT()
    const tl = useTicketLabel()
    const [visibility, setVisibility] = useState('public')
    const [internalDraft, setInternalDraft] = useState('')
    const [attachments, setAttachments] = useState([])
    const [macro, setMacro] = useState(null)
    const [kbQuery, setKbQuery] = useState('')
    const kbResults = useQuery({
        queryKey: ['kb', 'agent', 'composer', kbQuery],
        queryFn: () => kbService.articles({ q: kbQuery || undefined, status: 'published' }),
        enabled: kbEnabled,
        staleTime: 60_000,
    })
    const draft = value ?? internalDraft
    const setDraft = onChange ?? setInternalDraft
    const hasActions = Boolean(macro && (macro.set_status || macro.set_priority || (macro.add_tag_ids || []).length))

    const internal = visibility === 'internal'
    if (!canRespond) {
        return (
            <Text type="secondary">{t('ticket.noReplyPermission')}</Text>
        )
    }

    const pickMacro = (id) => {
        const next = macros.find((m) => m.id === id) || null
        setMacro(next)
        if (next) {
            setVisibility(next.visibility || 'public')
            if (next.body) setDraft(next.body)
        }
    }

    const insertArticle = async (id) => {
        if (!id) return
        try {
            const article = await kbService.article(id)
            const text = `${article.title}\n\n${markdownToText(article.body)}`
            setDraft(draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text)
        } catch {
            // Makale getirilemezse taslak degismez.
        }
    }

    const applyMacro = () => {
        if (!macro || pending) return
        onApplyMacro?.(macro, draft.trim())
        setDraft('')
        setMacro(null)
    }

    const submit = () => {
        if (hasActions) { applyMacro(); return }
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
        setMacro(null)
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
                        ? t('hub.composerInternalHint')
                        : t('hub.composerPublicHint')}
                </Text>
                {kbEnabled && (
                    <Select
                        className="ticket-macro-pick"
                        size="small"
                        showSearch
                        filterOption={false}
                        value={null}
                        suffixIcon={<ReadOutlined />}
                        placeholder={t('kb.insertArticle')}
                        aria-label={t('kb.insertArticle')}
                        onSearch={setKbQuery}
                        onChange={insertArticle}
                        options={(kbResults.data ?? []).map((a) => ({ value: a.id, label: a.title }))}
                    />
                )}
                {macros.length > 0 && (
                    <Select
                        className="ticket-macro-pick"
                        size="small"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        suffixIcon={<ThunderboltOutlined />}
                        placeholder={t('hub.macros')}
                        aria-label={t('hub.macros')}
                        value={macro?.id ?? null}
                        onChange={(id) => pickMacro(id)}
                        options={macros.map((m) => ({ value: m.id, label: m.name }))}
                    />
                )}
            </Inline>
            {hasActions && (
                <p className="ticket-macro-actions">
                    <ThunderboltOutlined aria-hidden="true" /> {t('hub.macroWill')}{' '}
                    {[
                        macro.set_status && t('hub.macroStatus', { status: tl('agentStatus', macro.set_status) }),
                        macro.set_priority && t('hub.macroPriority', { priority: tl('priority', macro.set_priority) }),
                        (macro.add_tag_ids || []).length && t('hub.macroTags', { count: macro.add_tag_ids.length }),
                    ].filter(Boolean).join(' · ')}
                </p>
            )}
            <Input.TextArea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                maxLength={10000}
                placeholder={internal
                    ? t('hub.composerInternalPlaceholder')
                    : t('hub.composerPublicPlaceholder')}
                aria-label={internal ? t('hub.internalNoteLabel') : t('hub.replyLabel')}
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
                    icon={hasActions ? <ThunderboltOutlined /> : <SendOutlined />}
                    loading={pending}
                    disabled={!hasActions && !draft.trim()}
                    onClick={submit}
                >
                    {hasActions
                        ? t('hub.applyAndSend')
                        : internal ? t('hub.saveInternalNote') : t('hub.sendReply')}
                </Button>
            </Inline>
        </Stack>
    )
}

export default AgentComposer
