/**
 * =============================================================================
 * HERMES - Talep e-posta kanali ayari (Dalga D4, saglayici)
 * =============================================================================
 * Giden: talep edene (yanit, bilgi istegi, cozum) ve ekibe (atama, musteri
 * yaniti, yeniden acilis) e-posta; dil. Gonderim sunucuda kapaliysa ayar
 * kaydedilir ama e-posta gitmez (uyari gosterilir).
 * Gelen: sunucuda posta kutusu tanimliysa saglayici acar; adres arti-adrestir.
 * Son gonderimler: 7 gun sayilari + son 20 kayit (alici maskeli).
 * Her degisiklik aninda kaydedilir.
 * =============================================================================
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Select, Skeleton, Switch, Typography, message } from 'antd'
import { HistoryOutlined, InboxOutlined, MailOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { ticketHelpdeskService } from '../../api/ticketsApi'
import { StatusBadge } from '../../components/ui'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'
import { SettingsEmpty, SettingsSection } from '../admin/settingsKit'
import '../../features/tickets/tickets.css'

const STATUS_TONE = { sent: 'success', pending: 'info', failed: 'danger', skipped: 'neutral' }
const KEY = queryKeys.tickets.mail

export default function MailTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const mail = useQuery({ queryKey: KEY, queryFn: ticketHelpdeskService.mail })
    const save = useMutation({
        mutationFn: (patch) => {
            const d = mail.data
            return ticketHelpdeskService.updateMail({
                requester_enabled: d.requester_enabled, agent_enabled: d.agent_enabled,
                language: d.language, inbound_enabled: d.inbound_enabled, ...patch,
            })
        },
        onSuccess: (data) => { queryClient.setQueryData(KEY, data); message.success(t('mail.saved')) },
        onError: () => message.error(t('mail.saveFailed')),
    })

    if (mail.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />
    if (mail.isError || !mail.data) return <SettingsEmpty text={t('mail.loadFailed')} />
    const d = mail.data
    const counts = d.counts_7d || {}

    return (
        <div className="mail-tab">
            <SettingsSection icon={<MailOutlined />} tone="blue" title={t('mail.outbound')} subtitle={t('mail.outboundHint')}>
                {d.outbound_ready
                    ? <Alert type="info" showIcon message={t('mail.senderIs', { sender: d.sender })} />
                    : <Alert type="warning" showIcon message={t('mail.outboundOff')} />}
                <ul className="mail-options">
                    <li>
                        <div>
                            <b>{t('mail.requester')}</b>
                            <span>{t('mail.requesterHint')}</span>
                        </div>
                        <Switch checked={d.requester_enabled} loading={save.isPending} aria-label={t('mail.requester')}
                                onChange={(on) => save.mutate({ requester_enabled: on })} />
                    </li>
                    <li>
                        <div>
                            <b>{t('mail.agents')}</b>
                            <span>{t('mail.agentsHint')}</span>
                        </div>
                        <Switch checked={d.agent_enabled} loading={save.isPending} aria-label={t('mail.agents')}
                                onChange={(on) => save.mutate({ agent_enabled: on })} />
                    </li>
                    <li>
                        <div>
                            <b>{t('mail.language')}</b>
                            <span>{t('mail.languageHint')}</span>
                        </div>
                        <Select value={d.language} aria-label={t('mail.language')} style={{ width: 140 }}
                                onChange={(language) => save.mutate({ language })}
                                options={[{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }]} />
                    </li>
                </ul>
            </SettingsSection>

            <SettingsSection icon={<InboxOutlined />} tone="violet" title={t('mail.inbound')} subtitle={t('mail.inboundHint')}>
                {!d.inbound_configured ? (
                    <Alert type="info" showIcon message={t('mail.inboundNotConfigured')} />
                ) : (
                    <>
                        <ul className="mail-options">
                            <li>
                                <div>
                                    <b>{t('mail.inboundToggle')}</b>
                                    <span>{t('mail.inboundToggleHint')}</span>
                                </div>
                                <Switch checked={d.inbound_enabled} loading={save.isPending} aria-label={t('mail.inboundToggle')}
                                        onChange={(on) => save.mutate({ inbound_enabled: on })} />
                            </li>
                        </ul>
                        {d.inbound_address && (
                            <div className="mail-address">
                                <span>{t('mail.address')}</span>
                                <Typography.Text code copyable={{ text: d.inbound_address }}>{d.inbound_address}</Typography.Text>
                            </div>
                        )}
                    </>
                )}
                <ul className="mail-rules">
                    <li>{t('mail.ruleMembers')}</li>
                    <li>{t('mail.ruleThread')}</li>
                    <li>{t('mail.ruleSafety')}</li>
                </ul>
            </SettingsSection>

            <SettingsSection icon={<HistoryOutlined />} tone="ink" title={t('mail.recent')}
                             subtitle={t('mail.counts', {
                                 sent: counts.sent ?? 0, pending: counts.pending ?? 0,
                                 failed: counts.failed ?? 0, skipped: counts.skipped ?? 0,
                             })}>
                {d.recent.length === 0 ? <SettingsEmpty compact text={t('mail.recentEmpty')} /> : (
                    <ul className="mail-log">
                        {d.recent.map((row) => (
                            <li key={row.id}>
                                <span className="mail-log__status">
                                    <StatusBadge tone={STATUS_TONE[row.status]}>{t(`mail.status.${row.status}`)}</StatusBadge>
                                </span>
                                <span className="mail-log__main">
                                    <b>{t(`mail.kind.${row.kind}`)}</b>
                                    <small>
                                        {[row.ticket_number, row.recipient === 'team' ? t('mail.team') : row.recipient,
                                            dayjs(row.sent_at || row.created_at).format('D MMM HH:mm')].filter(Boolean).join(' · ')}
                                    </small>
                                    {row.last_error && row.status !== 'sent' && (
                                        <small className="mail-log__error">{row.last_error}</small>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </SettingsSection>
        </div>
    )
}
