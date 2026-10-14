/**
 * =============================================================================
 * HERMES - Yeni destek talebi
 * =============================================================================
 * Hedef ekip DEĞİŞTİRİLEMEZ bir bilgi kutusudur (D-004): son kullanıcı
 * ekip seçmez. Route yoksa gönderim kapalıdır ve "genel bir gruba"
 * sessizce düşmez.
 *
 * Otomatik tanılama ÖNCE GÖSTERİLİR: kullanıcı ne gönderdiğini görür.
 * Toplanan alanlar allowlist'tir — cookie, token, form değeri, query
 * string ASLA toplanmaz (bu bileşen onları OKUMAZ bile).
 */
import { useEffect, useMemo, useState } from 'react'
import { Alert, Collapse, Form, Input, Select, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'

import { supportPortalService } from '../../api/ticketsApi'
import { AppModal, Stack, StatusBadge } from '../../components/ui'
import AttachmentDropzone from './AttachmentDropzone'
import { readyAttachmentIds } from './attachmentState'
import { CATEGORY_LABELS, IMPACT_LABELS } from './constants'
import { useTicketLabel } from './useTicketLabel'
import './tickets.css'
import { useT } from '../../i18n'

const { Text } = Typography

/** Guvenli tanilama — ALLOWLIST. Yeni bir alan eklemek bilincli bir
 *  gizlilik kararidir; buraya yazilmayan hicbir sey gonderilmez. */
function collectDiagnostics() {
    if (typeof window === 'undefined') return {}
    const path = window.location?.pathname || ''
    return {
        environment: import.meta.env?.MODE || 'production',
        // Query string ve fragment KESILIR (kimlik/token tasiyabilir).
        page_path: path.split('?')[0].split('#')[0],
        browser: (navigator.userAgent || '').slice(0, 120),
        os: navigator.platform || undefined,
        locale: navigator.language || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        client_timestamp: new Date().toISOString(),
    }
}

export default function CreateTicketModal({
    open, onCancel, onSubmit, pending, groupName, routeReady,
    attachmentsEnabled = false,
    // Talep agi: talep acilabilecek saglayicilar (birden fazlaysa kullanici
    // KIME actigini secer). Ekler secili saglayicinin deposuna yuklenir.
    providers = [], provider = null, onProviderChange,
    // Dalga D3: baslik yazilirken yardim merkezi onerileri (talep acilmadan
    // cozum). `suggest(q)` → makale listesi; `onOpenArticle(id)` acar.
    suggest, onOpenArticle,
}) {
    const t = useT()
    const tl = useTicketLabel()
    const [form] = Form.useForm()
    const [attachments, setAttachments] = useState([])
    const providerId = provider?.tenant_id
    const title = Form.useWatch('title', form) || ''
    const [debounced, setDebounced] = useState('')
    useEffect(() => {
        const id = setTimeout(() => setDebounced(title.trim()), 400)
        return () => clearTimeout(id)
    }, [title])
    const suggestions = useQuery({
        queryKey: ['kb', 'suggest', providerId ?? 'single', debounced],
        queryFn: () => suggest(debounced),
        enabled: Boolean(suggest) && open && debounced.length >= 3,
        staleTime: 60_000,
    })
    const pickProvider = (next) => {
        // Yuklenmis ekler onceki saglayicidadir; secim degisince birakilir.
        setAttachments([])
        onProviderChange?.(next)
    }
    // Idempotency anahtari MODAL ACILISINDA uretilir ve retry'larda
    // AYNI kalir: ag hatasi sonrasi "tekrar dene", ikinci bir ticket
    // ACMAZ.
    const [idempotencyKey] = useState(
        () => `portal-${crypto.randomUUID?.() ?? Date.now()}`,
    )
    const diagnostics = useMemo(collectDiagnostics, [open])

    const handleOk = async () => {
        let values
        try {
            values = await form.validateFields()
        } catch {
            // Alan hatalarini AntD gosterir; sessiz bir rejection
            // birakmak konsolu kirletir ve gercek hatalari gizler.
            return
        }
        onSubmit({
            title: values.title,
            description: values.description,
            category: values.category,
            impact: values.impact,
            reproduction_steps: values.reproduction_steps || null,
            expected_result: values.expected_result || null,
            actual_result: values.actual_result || null,
            error_code: values.error_code || null,
            client_context: diagnostics,
            // YALNIZCA taramasi bitmis ve temiz ekler gonderilir.
            attachment_ids: readyAttachmentIds(attachments),
        }, idempotencyKey)
    }

    return (
        <AppModal
            open={open}
            title={t('ticket.newRequest')}
            okText={t('common.submit')}
            cancelText={t('common.cancel')}
            onCancel={onCancel}
            onOk={handleOk}
            pending={pending}
            confirmLoading={pending}
            okButtonProps={{ disabled: !routeReady }}
            destroyOnHidden
            width={680}
        >
            <Stack gap={3}>
                {providers.length > 1 && (
                    <label className="ticket-create-modal__provider">
                        <Text strong>{t('ticket.sendTo')}</Text>
                        <Select
                            aria-label={t('ticket.sendTo')}
                            value={providerId}
                            onChange={pickProvider}
                            options={providers.map((p) => ({
                                value: p.tenant_id, label: p.display_name,
                            }))}
                        />
                    </label>
                )}
                {routeReady ? (
                    <Alert
                        type="info"
                        showIcon
                        message={(
                            <span>
                                {provider?.display_name ? `${provider.display_name} · ` : ''}
                                {t('ticket.goesToTeamPrefix')}
                                <strong>{groupName}</strong>
                                {t('ticket.goesToTeamSuffix')}
                            </span>
                        )}
                        description={t('ticket.targetTeamFixed')}
                    />
                ) : (
                    <Alert
                        type="warning"
                        showIcon
                        message={t('portal.routingNotConfigured')}
                        description={t('ticket.cannotSubmit')}
                    />
                )}

                <Form form={form} layout="vertical" preserve={false}>
                    <Form.Item
                        name="category"
                        label={t('ticket.category')}
                        rules={[{ required: true, message: t('ticket.selectCategory') }]}
                    >
                        <Select
                            placeholder={t('ticket.select')}
                            options={Object.keys(CATEGORY_LABELS).map(
                                (value) => ({ value, label: tl('category', value) }),
                            )}
                        />
                    </Form.Item>

                    <Form.Item
                        name="impact"
                        label={t('ticket.impact')}
                        rules={[{ required: true, message: t('ticket.selectImpact') }]}
                    >
                        <Select
                            placeholder={t('ticket.select')}
                            options={Object.keys(IMPACT_LABELS).map(
                                (value) => ({
                                    value,
                                    label: (
                                        <span>
                                            {tl('impact', value)}
                                            {' — '}
                                            <Text type="secondary">
                                                {t(`ticketLabels.impactHint.${value}`)}
                                            </Text>
                                        </span>
                                    ),
                                }),
                            )}
                        />
                    </Form.Item>

                    <Form.Item
                        name="title"
                        label={t('hub.title')}
                        rules={[
                            // Uzunluk ALT SINIRI YOK: bos olmasin yeter.
                            // "En az 8 karakter" gercek basliklari
                            // ("404", "yavas") engelliyordu.
                            { required: true, message: t('ticket.titleRequired') },
                            { max: 160, message: t('ticket.titleMax') },
                        ]}
                    >
                        <Input maxLength={160} showCount />
                    </Form.Item>
                    {(suggestions.data ?? []).length > 0 && (
                        <div className="kb-suggest" role="region" aria-label={t('kb.mightHelp')}>
                            <b>{t('kb.mightHelp')}</b>
                            <ul>
                                {suggestions.data.map((a) => (
                                    <li key={a.id}>
                                        <button type="button" onClick={() => onOpenArticle?.(a.id)}>{a.title}</button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <Form.Item
                        name="description"
                        label={t('common.description')}
                        rules={[
                            { required: true, message: t('ticket.descriptionRequired') },
                        ]}
                    >
                        <Input.TextArea rows={5} maxLength={10000} showCount />
                    </Form.Item>

                    {/* Istege bagli alanlar KAPALI baslar: zorunlu dort
                        alanla is goren cogunluk uzun bir formla
                        karsilasmaz, ayrintiyi verecek olan tek tikla acar.

                        `forceRender` KEMER-VE-ASKI'dir, tek dayanak
                        DEGILDIR: AntD Collapse bir kez acilan paneli
                        zaten mount'ta tutar (`destroyInactivePanel`
                        varsayilani false), dolayisiyla panel kapansa da
                        deger form'da kalir. Bayrak, o varsayilan bir gun
                        degistirilirse `preserve={false}` ile birlesip
                        yazilan ayrintiyi sessizce dusurmesin diye
                        duruyor. Davranisi kilitleyen sey testtir. */}
                    <Collapse
                        ghost
                        size="small"
                        className="ticket-create-modal__optional"
                        items={[{
                            key: 'details',
                            label: t('ticket.addMoreDetail'),
                            forceRender: true,
                            children: (
                                <>
                                    <Form.Item
                                        name="reproduction_steps"
                                        label={t('ticket.stepsToReproduce')}
                                    >
                                        <Input.TextArea rows={2} maxLength={10000} />
                                    </Form.Item>
                                    <Form.Item
                                        name="expected_result"
                                        label={t('ticket.expectedResult')}
                                    >
                                        <Input.TextArea rows={2} maxLength={10000} />
                                    </Form.Item>
                                    <Form.Item
                                        name="actual_result"
                                        label={t('ticket.actualResult')}
                                    >
                                        <Input.TextArea rows={2} maxLength={10000} />
                                    </Form.Item>
                                </>
                            ),
                        }]}
                    />
                    <Form.Item name="error_code" label={t('ticket.errorCode')}>
                        <Input maxLength={80} />
                    </Form.Item>
                </Form>

                <AttachmentDropzone
                    enabled={attachmentsEnabled}
                    value={attachments}
                    onChange={setAttachments}
                    onOpenSession={(params) => supportPortalService.openAttachmentSession(
                        providerId ? { ...params, provider: providerId } : params,
                    )}
                    onUploadContent={(id, file) =>
                        supportPortalService.uploadAttachmentContent(id, file, providerId)}
                />

                <Stack gap={1}>
                    <Text strong>{t('ticket.autoDiagnostics')}</Text>
                    <Text type="secondary">
                        Only the values below are sent. Cookies, session
                        data, form contents and URL parameters are never
                        collected.
                    </Text>
                    <div>
                        {Object.entries(diagnostics).map(([key, value]) => (
                            <StatusBadge key={key} tone="neutral">
                                {key}: {String(value)}
                            </StatusBadge>
                        ))}
                    </div>
                    <Text type="secondary">
                        If you attach a screenshot or a log, please make
                        sure it contains no confidential information.
                    </Text>
                </Stack>
            </Stack>
        </AppModal>
    )
}
