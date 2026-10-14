/**
 * =============================================================================
 * HERMES - Talep yonetimi ayarlari (Dalga B, saglayici)
 * =============================================================================
 * Sekmeler: SLA ve mesai saatleri · Etiketler · Hazir yanitlar ·
 * Otomasyonlar (D2) · E-posta (D4).
 * Yalniz SAGLAYICI tenant'ta (gelen talepleri olan) ve yapilandirma
 * yetkisiyle (`tickets.config.manage` / `tickets.admin`) gorunur.
 *
 * SLA hedefleri MESAI saatidir: takvim kapaliysa 7/24 sayilir. Yeni
 * hedefler yalniz YENI taleplere uygulanir (acik talebin sozu acilista
 * sabitlenir; oncelik degisirse yeni hedefi alir).
 * =============================================================================
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    Alert, Checkbox, DatePicker, Input, InputNumber, Modal, Select, Switch, TimePicker, message,
} from 'antd'
import {
    ClockCircleOutlined, MailOutlined, PlusOutlined, RobotOutlined, TagsOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

import { ticketHelpdeskService } from '../../api/ticketsApi'
import { Button } from '../../components/ui'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'
import { SettingsEmpty, SettingsSection, SettingsTabs } from '../admin/settingsKit'
import { TagChips } from '../../features/tickets/SlaBadge'
import { useTicketLabel } from '../../features/tickets/useTicketLabel'
import useTicketContext from '../../features/tickets/useTicketContext'
import AutomationsTab from './AutomationsTab'
import MailTab from './MailTab'
import '../../features/tickets/tickets.css'

const PRIORITIES = ['urgent', 'high', 'normal', 'low']
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7']
const TIMEZONES = ['Europe/Istanbul', 'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'America/New_York']
const TAG_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'cyan', 'gold', 'gray']

const errText = (error, fallback) => {
    const d = error?.response?.data?.detail
    return (typeof d === 'string' ? d : d?.message) || error?.normalized?.message || fallback
}

// =============================================================================
// SLA
// =============================================================================

function SlaTab() {
    const t = useT()
    const tl = useTicketLabel()
    const queryClient = useQueryClient()
    const policy = useQuery({ queryKey: queryKeys.tickets.slaPolicy, queryFn: ticketHelpdeskService.slaPolicy })
    const [draft, setDraft] = useState(null)

    useEffect(() => {
        if (!policy.data) return
        const cal = policy.data.calendar
        setDraft({
            name: policy.data.name,
            is_active: policy.data.exists ? policy.data.is_active : true,
            targets: policy.data.targets,
            always: !cal,
            timezone: cal?.timezone || 'Europe/Istanbul',
            days: Object.fromEntries(WEEKDAYS.map((d) => {
                const span = cal?.days?.[d]?.[0]
                return [d, span ? { on: true, start: span[0], end: span[1] } : { on: false, start: '09:00', end: '18:00' }]
            })),
            holidays: cal?.holidays || [],
        })
    }, [policy.data])

    const save = useMutation({
        mutationFn: () => ticketHelpdeskService.saveSlaPolicy({
            name: draft.name,
            is_active: draft.is_active,
            targets: draft.targets,
            calendar: draft.always ? null : {
                timezone: draft.timezone,
                days: Object.fromEntries(WEEKDAYS.map((d) => [d, draft.days[d].on ? [[draft.days[d].start, draft.days[d].end]] : []])),
                holidays: draft.holidays,
            },
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tickets.slaPolicy })
            message.success(t('sla.saved'))
        },
        onError: (error) => message.error(errText(error, t('sla.saveFailed'))),
    })

    if (!draft) return null
    const setTarget = (priority, key, hours) => setDraft((d) => ({
        ...d,
        targets: {
            ...d.targets,
            [priority]: { ...(d.targets[priority] || {}), [key]: hours ? Math.round(hours * 60) : undefined },
        },
    }))
    const setDay = (day, patch) => setDraft((d) => ({ ...d, days: { ...d.days, [day]: { ...d.days[day], ...patch } } }))

    return (
        <>
            {!policy.data?.exists && <Alert type="info" showIcon message={t('sla.suggested')} style={{ marginBottom: 12 }} />}
            <SettingsSection
                icon={<ClockCircleOutlined />}
                tone="blue"
                title={t('sla.targets')}
                subtitle={t('sla.targetsHint')}
                actions={(
                    <label className="sk-inline">
                        <Switch checked={draft.is_active} onChange={(on) => setDraft((d) => ({ ...d, is_active: on }))}
                                aria-label={t('sla.active')} />
                        <span>{t('sla.active')}</span>
                    </label>
                )}
            >
                <table className="sla-targets">
                    <thead>
                        <tr>
                            <th>{t('hub.priority')}</th>
                            <th>{t('sla.leg.first_response')} ({t('sla.hoursUnit')})</th>
                            <th>{t('sla.leg.resolution')} ({t('sla.hoursUnit')})</th>
                        </tr>
                    </thead>
                    <tbody>
                        {PRIORITIES.map((p) => (
                            <tr key={p}>
                                <th scope="row">{tl('priority', p)}</th>
                                {['first_response', 'resolution'].map((key) => (
                                    <td key={key}>
                                        <InputNumber
                                            min={0.25} max={2000} step={0.25}
                                            aria-label={`${tl('priority', p)} · ${t(`sla.leg.${key}`)}`}
                                            value={draft.targets[p]?.[key] ? +(draft.targets[p][key] / 60).toFixed(2) : null}
                                            onChange={(v) => setTarget(p, key, v)}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </SettingsSection>

            <SettingsSection
                icon={<ClockCircleOutlined />}
                tone="violet"
                title={t('sla.calendar')}
                subtitle={t('sla.calendarHint')}
                actions={(
                    <label className="sk-inline">
                        <Switch checked={draft.always} onChange={(on) => setDraft((d) => ({ ...d, always: on }))}
                                aria-label={t('sla.always')} />
                        <span>{t('sla.always')}</span>
                    </label>
                )}
            >
                {!draft.always && (
                    <div className="sla-calendar">
                        <label className="sla-field">
                            <span>{t('sla.timezone')}</span>
                            <Select value={draft.timezone} onChange={(v) => setDraft((d) => ({ ...d, timezone: v }))}
                                    options={TIMEZONES.map((z) => ({ value: z, label: z }))} aria-label={t('sla.timezone')}
                                    style={{ width: '100%', maxWidth: 320 }} />
                        </label>
                        <ul className="sla-days">
                            {WEEKDAYS.map((d) => (
                                <li key={d}>
                                    <Checkbox checked={draft.days[d].on} onChange={(e) => setDay(d, { on: e.target.checked })}>
                                        {t(`sla.day.${d}`)}
                                    </Checkbox>
                                    <TimePicker.RangePicker
                                        format="HH:mm" minuteStep={15} disabled={!draft.days[d].on}
                                        aria-label={t('sla.hoursFor', { day: t(`sla.day.${d}`) })}
                                        value={[dayjs(draft.days[d].start, 'HH:mm'), dayjs(draft.days[d].end, 'HH:mm')]}
                                        onChange={(range) => range && setDay(d, {
                                            start: range[0].format('HH:mm'), end: range[1].format('HH:mm'),
                                        })}
                                        allowClear={false}
                                    />
                                </li>
                            ))}
                        </ul>
                        <label className="sla-field">
                            <span>{t('sla.holidays')}</span>
                            <DatePicker
                                multiple
                                aria-label={t('sla.holidays')}
                                value={draft.holidays.map((h) => dayjs(h))}
                                onChange={(dates) => setDraft((d) => ({
                                    ...d, holidays: (dates || []).map((x) => x.format('YYYY-MM-DD')).sort(),
                                }))}
                                style={{ width: '100%', maxWidth: 520 }}
                            />
                        </label>
                    </div>
                )}
            </SettingsSection>

            <div className="sk-savebar">
                <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
            </div>
        </>
    )
}

// =============================================================================
// Etiketler
// =============================================================================

function TagsTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const tags = useQuery({
        queryKey: [...queryKeys.tickets.tags, 'all'],
        queryFn: () => ticketHelpdeskService.tags({ include_inactive: true }),
    })
    const [name, setName] = useState('')
    const [color, setColor] = useState('blue')
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tickets.tags })
    const create = useMutation({
        mutationFn: () => ticketHelpdeskService.createTag({ name: name.trim(), color }),
        onSuccess: () => { setName(''); refresh() },
        onError: (error) => message.error(errText(error, t('tags.saveFailed'))),
    })
    const update = useMutation({
        mutationFn: ({ tag, patch }) => ticketHelpdeskService.updateTag(tag.id, { name: tag.name, color: tag.color, ...patch }),
        onSuccess: refresh,
        onError: (error) => message.error(errText(error, t('tags.saveFailed'))),
    })
    const rows = tags.data ?? []
    return (
        <SettingsSection icon={<TagsOutlined />} tone="green" title={t('hub.tags')} subtitle={t('tags.hint')} count={rows.length}>
            <form className="tags-new" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
                <Input value={name} maxLength={40} placeholder={t('tags.newName')} aria-label={t('tags.newName')}
                       onChange={(e) => setName(e.target.value)} />
                <Select value={color} onChange={setColor} aria-label={t('tags.color')} style={{ width: 130 }}
                        options={TAG_COLORS.map((c) => ({ value: c, label: <span className={`ticket-tag ticket-tag--${c}`}>{t(`tags.colors.${c}`)}</span> }))} />
                <Button variant="primary" icon={<PlusOutlined />} disabled={!name.trim()} loading={create.isPending}
                        onClick={() => create.mutate()}>{t('common.add')}</Button>
            </form>
            {rows.length === 0 ? <SettingsEmpty compact text={t('tags.empty')} /> : (
                <ul className="tags-list">
                    {rows.map((tag) => (
                        <li key={tag.id} className={tag.is_active ? '' : 'is-off'}>
                            <TagChips tags={[tag]} />
                            <Select size="small" value={tag.color} aria-label={t('tags.colorFor', { name: tag.name })}
                                    onChange={(c) => update.mutate({ tag, patch: { color: c } })} style={{ width: 120 }}
                                    options={TAG_COLORS.map((c) => ({ value: c, label: t(`tags.colors.${c}`) }))} />
                            <Switch size="small" checked={tag.is_active} aria-label={t('tags.activeFor', { name: tag.name })}
                                    onChange={(on) => update.mutate({ tag, patch: { is_active: on } })} />
                        </li>
                    ))}
                </ul>
            )}
        </SettingsSection>
    )
}

// =============================================================================
// Hazir yanitlar
// =============================================================================

const EMPTY_MACRO = { name: '', body: '', visibility: 'public', set_status: null, set_priority: null, add_tag_ids: [], is_shared: true }

function MacroModal({ macro, tags, onClose, onSaved }) {
    const t = useT()
    const tl = useTicketLabel()
    const [draft, setDraft] = useState(macro)
    const isNew = !macro.id
    const save = useMutation({
        mutationFn: () => {
            const body = { ...draft, set_status: draft.set_status || null, set_priority: draft.set_priority || null }
            delete body.id
            delete body.is_mine
            return isNew ? ticketHelpdeskService.createMacro(body) : ticketHelpdeskService.updateMacro(macro.id, body)
        },
        onSuccess: () => { onSaved(); onClose() },
        onError: (error) => message.error(errText(error, t('macros.saveFailed'))),
    })
    const patch = (p) => setDraft((d) => ({ ...d, ...p }))
    return (
        <Modal open title={isNew ? t('macros.new') : t('macros.edit')} onCancel={onClose} onOk={() => save.mutate()}
               okText={t('common.save')} okButtonProps={{ loading: save.isPending, disabled: !draft.name.trim() }} width={620} destroyOnHidden>
            <div className="pc-form">
                <label className="sla-field"><span>{t('macros.name')}</span>
                    <Input value={draft.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} aria-label={t('macros.name')} />
                </label>
                <label className="sla-field"><span>{t('macros.body')}</span>
                    <Input.TextArea rows={5} maxLength={10000} value={draft.body || ''} aria-label={t('macros.body')}
                                    onChange={(e) => patch({ body: e.target.value })} />
                </label>
                <div className="macro-grid">
                    <label className="sla-field"><span>{t('macros.visibility')}</span>
                        <Select value={draft.visibility} onChange={(v) => patch({ visibility: v })} aria-label={t('macros.visibility')}
                                options={[{ value: 'public', label: t('ticket.replyToCustomer') }, { value: 'internal', label: t('ticket.internalNote') }]} />
                    </label>
                    <label className="sla-field"><span>{t('macros.setStatus')}</span>
                        <Select allowClear value={draft.set_status} onChange={(v) => patch({ set_status: v || null })} aria-label={t('macros.setStatus')}
                                placeholder={t('macros.noChange')}
                                options={['in_progress', 'waiting_customer'].map((s) => ({ value: s, label: tl('agentStatus', s) }))} />
                    </label>
                    <label className="sla-field"><span>{t('macros.setPriority')}</span>
                        <Select allowClear value={draft.set_priority} onChange={(v) => patch({ set_priority: v || null })} aria-label={t('macros.setPriority')}
                                placeholder={t('macros.noChange')}
                                options={PRIORITIES.map((p) => ({ value: p, label: tl('priority', p) }))} />
                    </label>
                    <label className="sla-field"><span>{t('macros.addTags')}</span>
                        <Select mode="multiple" value={draft.add_tag_ids} onChange={(v) => patch({ add_tag_ids: v })} aria-label={t('macros.addTags')}
                                options={tags.map((tag) => ({ value: tag.id, label: tag.name }))} />
                    </label>
                </div>
                {draft.set_status === 'waiting_customer' && (
                    <Alert type="info" showIcon message={t('macros.waitingNeedsPublic')} />
                )}
            </div>
        </Modal>
    )
}

function MacrosTab() {
    const t = useT()
    const tl = useTicketLabel()
    const queryClient = useQueryClient()
    const macros = useQuery({ queryKey: queryKeys.tickets.macros, queryFn: ticketHelpdeskService.macros })
    const tags = useQuery({ queryKey: queryKeys.tickets.tags, queryFn: () => ticketHelpdeskService.tags() })
    const [editing, setEditing] = useState(null)
    const shared = useMemo(() => (macros.data ?? []).filter((m) => m.is_shared), [macros.data])
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tickets.macros })
    return (
        <SettingsSection
            icon={<ThunderboltOutlined />} tone="orange" title={t('hub.macros')} subtitle={t('macros.hint')} count={shared.length}
            actions={<Button variant="primary" icon={<PlusOutlined />} onClick={() => setEditing(EMPTY_MACRO)}>{t('macros.new')}</Button>}
        >
            {shared.length === 0 ? <SettingsEmpty compact text={t('macros.empty')} /> : (
                <ul className="macro-list">
                    {shared.map((m) => (
                        <li key={m.id}>
                            <button type="button" onClick={() => setEditing(m)}>
                                <b>{m.name}</b>
                                <span className="lq-note">
                                    {[m.visibility === 'internal' ? t('ticket.internalNote') : t('ticket.replyToCustomer'),
                                        m.set_status && tl('agentStatus', m.set_status),
                                        m.set_priority && tl('priority', m.set_priority),
                                        m.add_tag_ids?.length ? t('hub.macroTags', { count: m.add_tag_ids.length }) : null,
                                    ].filter(Boolean).join(' · ')}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {editing && (
                <MacroModal macro={editing} tags={tags.data ?? []} onClose={() => setEditing(null)} onSaved={refresh} />
            )}
        </SettingsSection>
    )
}

// =============================================================================
// Sayfa
// =============================================================================

export default function TicketHelpdeskSettings() {
    const t = useT()
    const context = useTicketContext()
    const [tab, setTab] = useState('sla')
    if (context.isLoading) return null
    if (!context.isHub) {
        return <SettingsEmpty title={t('helpdesk.unavailable')} text={t('helpdesk.providerOnly')} />
    }
    return (
        <div className="ti-page">
            <div className="page-header">
                <h1>{t('helpdesk.title')}</h1>
                <p>{t('helpdesk.subtitle')}</p>
            </div>
            <SettingsTabs
                ariaLabel={t('helpdesk.title')}
                value={tab}
                onChange={setTab}
                options={[
                    { value: 'sla', label: t('sla.title'), icon: <ClockCircleOutlined /> },
                    { value: 'tags', label: t('hub.tags'), icon: <TagsOutlined /> },
                    { value: 'macros', label: t('hub.macros'), icon: <ThunderboltOutlined /> },
                    { value: 'automations', label: t('automation.title'), icon: <RobotOutlined /> },
                    { value: 'mail', label: t('mail.title'), icon: <MailOutlined /> },
                ]}
            />
            {tab === 'sla' && <SlaTab />}
            {tab === 'tags' && <TagsTab />}
            {tab === 'macros' && <MacrosTab />}
            {tab === 'automations' && <AutomationsTab />}
            {tab === 'mail' && <MailTab />}
        </div>
    )
}
