/**
 * =============================================================================
 * HERMES - Talep otomasyonlari (Dalga D2) — Ayarlar > Talep yonetimi
 * =============================================================================
 * "Eger <kosullar> ise <eylemler>". Tetik: talep acildiginda, musteri
 * yanitladiginda veya zamanli (saatlik; yas kosulu zorunlu, talep basina
 * bir kez). Kurallar sirayla calisir; bozuk bir kural talep akisini bozmaz,
 * hatasi "son calismalar"da gorunur.
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    Alert, Input, InputNumber, Modal, Popconfirm, Select, Switch, message,
} from 'antd'
import {
    DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined, RobotOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

import { authService } from '../../api/authApi'
import { ticketHelpdeskService, ticketHubService } from '../../api/ticketsApi'
import { Button } from '../../components/ui'
import { LiquidSegmented } from '../../components/liquid'
import {
    AGENT_STATUS_LABELS, CATEGORY_LABELS, IMPACT_LABELS, PRIORITY_LABELS, RESOLUTION_LABELS,
} from '../../features/tickets/constants'
import { useTicketLabel } from '../../features/tickets/useTicketLabel'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'
import { SettingsEmpty, SettingsSection } from '../admin/settingsKit'

const TRIGGERS = ['created', 'customer_replied', 'schedule']
const CONDITION_FIELDS = ['category', 'impact', 'priority', 'status', 'application', 'customer', 'group', 'assignee', 'tags_any', 'text_any']
const ACTION_TYPES = ['set_priority', 'assign_group', 'assign_user', 'add_tags', 'internal_note', 'public_reply', 'set_status', 'resolve', 'notify']
const AGE_BASES = ['created', 'updated', 'public_activity']
const EMPTY_RULE = { name: '', trigger: 'created', is_active: true, conditions: {}, actions: [], position: 0 }

const errText = (error, fallback) => {
    const d = error?.response?.data?.detail
    return (typeof d === 'string' ? d : d?.message) || error?.normalized?.message || fallback
}

/** Kural secicilerinin veri kaynaklari (tek yerde). */
function useOptions() {
    const tl = useTicketLabel()
    const apps = useQuery({ queryKey: queryKeys.tickets.applications, queryFn: ticketHubService.listApplications })
    const groups = useQuery({ queryKey: queryKeys.tickets.routingGroups, queryFn: ticketHubService.routingGroups })
    const tags = useQuery({ queryKey: queryKeys.tickets.tags, queryFn: () => ticketHelpdeskService.tags() })
    const customers = useQuery({ queryKey: ['tickets', 'helpdesk', 'customers'], queryFn: ticketHelpdeskService.customers })
    const users = useQuery({ queryKey: ['auth', 'users', 'lookup', 'active'], queryFn: () => authService.lookupUsers() })
    return useMemo(() => {
        const dict = (labels, kind) => Object.keys(labels).map((value) => ({ value, label: tl(kind, value) }))
        return {
            category: dict(CATEGORY_LABELS, 'category'),
            impact: dict(IMPACT_LABELS, 'impact'),
            priority: dict(PRIORITY_LABELS, 'priority'),
            status: dict(AGENT_STATUS_LABELS, 'agentStatus'),
            resolution: dict(RESOLUTION_LABELS, 'resolution'),
            application: (apps.data ?? []).map((a) => ({ value: a.id, label: a.display_name })),
            customer: (customers.data ?? []).map((c) => ({ value: c.id, label: `${c.display_name} · ${c.application ?? ''}` })),
            group: (groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
            tags_any: (tags.data ?? []).map((g) => ({ value: g.id, label: g.name })),
            users: (users.data ?? []).map((u) => ({ value: u.id, label: u.full_name || u.email })),
        }
    }, [apps.data, groups.data, tags.data, customers.data, users.data, tl])
}

// =============================================================================
// Editor
// =============================================================================

function ConditionRow({ field, value, options, onChange, onRemove }) {
    const t = useT()
    let control
    if (field === 'assignee') {
        control = (
            <Select value={value} onChange={onChange} aria-label={t(`automation.cond.${field}`)}
                    options={['assigned', 'unassigned'].map((v) => ({ value: v, label: t(`automation.assignee.${v}`) }))} />
        )
    } else if (field === 'text_any') {
        control = (
            <Select mode="tags" value={value || []} onChange={onChange} aria-label={t(`automation.cond.${field}`)}
                    placeholder={t('automation.keywordsHint')} open={false} tokenSeparators={[',']} />
        )
    } else {
        control = (
            <Select mode="multiple" value={value || []} onChange={onChange} aria-label={t(`automation.cond.${field}`)}
                    options={options[field] || []} optionFilterProp="label" />
        )
    }
    return (
        <li className="rule-row">
            <span className="rule-row__label">{t(`automation.cond.${field}`)}</span>
            <span className="rule-row__control">{control}</span>
            <Button size="small" variant="ghost" icon={<DeleteOutlined />} aria-label={t('common.remove')} onClick={onRemove} />
        </li>
    )
}

function ActionRow({ action, options, onChange, onRemove }) {
    const t = useT()
    const set = (patch) => onChange({ ...action, ...patch })
    const label = t(`automation.action.${action.type}`)
    let control = null
    switch (action.type) {
    case 'set_priority':
        control = <Select value={action.value} onChange={(v) => set({ value: v })} options={options.priority} aria-label={label} />
        break
    case 'assign_group':
        control = <Select value={action.group_id} onChange={(v) => set({ group_id: v })} options={options.group} aria-label={label} />
        break
    case 'assign_user':
        control = <Select showSearch optionFilterProp="label" value={action.user_id} onChange={(v) => set({ user_id: v })} options={options.users} aria-label={label} />
        break
    case 'add_tags':
        control = <Select mode="multiple" value={action.tag_ids || []} onChange={(v) => set({ tag_ids: v })} options={options.tags_any} aria-label={label} />
        break
    case 'internal_note':
    case 'public_reply':
        control = <Input.TextArea rows={2} maxLength={5000} value={action.body || ''} onChange={(e) => set({ body: e.target.value })} aria-label={label} />
        break
    case 'set_status':
        control = (
            <div className="rule-row__stack">
                <Select value={action.value} onChange={(v) => set({ value: v })} aria-label={label}
                        options={['in_progress', 'waiting_customer'].map((v) => options.status.find((o) => o.value === v))} />
                {action.value === 'waiting_customer' && (
                    <Input.TextArea rows={2} maxLength={5000} value={action.body || ''} placeholder={t('automation.questionHint')}
                                    onChange={(e) => set({ body: e.target.value })} aria-label={t('automation.questionHint')} />
                )}
            </div>
        )
        break
    case 'resolve':
        control = (
            <div className="rule-row__stack">
                <Select value={action.resolution_code} onChange={(v) => set({ resolution_code: v })} options={options.resolution}
                        aria-label={t('automation.resolutionCode')} placeholder={t('automation.resolutionCode')} />
                <Input.TextArea rows={2} maxLength={5000} value={action.summary || ''} placeholder={t('automation.summaryHint')}
                                onChange={(e) => set({ summary: e.target.value })} aria-label={t('automation.summaryHint')} />
            </div>
        )
        break
    case 'notify':
        control = <Select value={action.target} onChange={(v) => set({ target: v })} aria-label={label}
                          options={['group', 'assignee', 'watchers'].map((v) => ({ value: v, label: t(`automation.notifyTarget.${v}`) }))} />
        break
    default:
        break
    }
    return (
        <li className="rule-row">
            <span className="rule-row__label">{label}</span>
            <span className="rule-row__control">{control}</span>
            <Button size="small" variant="ghost" icon={<DeleteOutlined />} aria-label={t('common.remove')} onClick={onRemove} />
        </li>
    )
}

function RuleModal({ rule, options, onClose, onSaved }) {
    const t = useT()
    const [draft, setDraft] = useState(() => ({
        ...rule,
        conditions: { ...(rule.conditions || {}) },
        actions: [...(rule.actions || [])],
    }))
    const isNew = !rule.id
    const patch = (p) => setDraft((d) => ({ ...d, ...p }))
    const conds = draft.conditions
    const usedFields = CONDITION_FIELDS.filter((f) => f in conds)
    const save = useMutation({
        mutationFn: () => {
            const body = {
                name: draft.name, trigger: draft.trigger, is_active: draft.is_active, position: draft.position,
                conditions: draft.conditions, actions: draft.actions,
            }
            return isNew ? ticketHelpdeskService.createAutomation(body) : ticketHelpdeskService.updateAutomation(rule.id, body)
        },
        onSuccess: () => { onSaved(); onClose(); message.success(t('automation.saved')) },
        onError: (error) => message.error(errText(error, t('automation.saveFailed'))),
    })
    return (
        <Modal open width={720} onCancel={onClose} onOk={() => save.mutate()} okText={t('common.save')}
               okButtonProps={{ loading: save.isPending, disabled: !draft.name.trim() || !draft.actions.length }}
               title={isNew ? t('automation.new') : t('automation.edit')} destroyOnHidden>
            <div className="pc-form">
                <label className="sla-field"><span>{t('automation.name')}</span>
                    <Input value={draft.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} aria-label={t('automation.name')} />
                </label>
                <div className="sla-field"><span>{t('automation.when')}</span>
                    <LiquidSegmented ariaLabel={t('automation.when')} value={draft.trigger}
                                     onChange={(v) => {
                                         // Zamanli kural yas kosulu ister: varsayilan eklenir;
                                         // olay kuralina donunce kaldirilir.
                                         const next = { ...conds }
                                         if (v === 'schedule' && !next.age) next.age = { basis: 'updated', hours: 24 }
                                         if (v !== 'schedule') delete next.age
                                         patch({ trigger: v, conditions: next })
                                     }}
                                     options={TRIGGERS.map((v) => ({ value: v, label: t(`automation.trigger.${v}`) }))} />
                </div>
                {draft.trigger === 'schedule' && (
                    <div className="rule-age">
                        <Select value={conds.age?.basis || 'updated'} aria-label={t('automation.ageBasis')}
                                onChange={(basis) => patch({ conditions: { ...conds, age: { hours: conds.age?.hours || 24, basis } } })}
                                options={AGE_BASES.map((v) => ({ value: v, label: t(`automation.age.${v}`) }))} style={{ minWidth: 220 }} />
                        <InputNumber min={1} max={8760} value={conds.age?.hours || 24} aria-label={t('automation.hours')}
                                     onChange={(hours) => patch({ conditions: { ...conds, age: { basis: conds.age?.basis || 'updated', hours } } })} />
                        <span>{t('automation.hoursSuffix')}</span>
                    </div>
                )}

                <h3 className="lq-grp">{t('automation.if')}</h3>
                {usedFields.length === 0 && <p className="lq-note">{t('automation.allTickets')}</p>}
                <ul className="rule-rows">
                    {usedFields.map((field) => (
                        <ConditionRow key={field} field={field} value={conds[field]} options={options}
                                      onChange={(v) => patch({ conditions: { ...conds, [field]: v } })}
                                      onRemove={() => { const next = { ...conds }; delete next[field]; patch({ conditions: next }) }} />
                    ))}
                </ul>
                <Select value={null} placeholder={t('automation.addCondition')} aria-label={t('automation.addCondition')}
                        onChange={(field) => patch({ conditions: { ...conds, [field]: field === 'assignee' ? 'unassigned' : [] } })}
                        options={CONDITION_FIELDS.filter((f) => !(f in conds)).map((f) => ({ value: f, label: t(`automation.cond.${f}`) }))}
                        style={{ maxWidth: 280 }} />

                <h3 className="lq-grp">{t('automation.then')}</h3>
                <ul className="rule-rows">
                    {draft.actions.map((action, i) => (
                        <ActionRow key={`${action.type}-${i}`} action={action} options={options}
                                   onChange={(next) => patch({ actions: draft.actions.map((a, j) => (j === i ? next : a)) })}
                                   onRemove={() => patch({ actions: draft.actions.filter((_, j) => j !== i) })} />
                    ))}
                </ul>
                <Select value={null} placeholder={t('automation.addAction')} aria-label={t('automation.addAction')}
                        onChange={(type) => patch({ actions: [...draft.actions, { type }] })}
                        options={ACTION_TYPES.map((v) => ({ value: v, label: t(`automation.action.${v}`) }))}
                        style={{ maxWidth: 280 }} />
                {draft.trigger === 'schedule' && <Alert type="info" showIcon message={t('automation.scheduleHint')} />}
            </div>
        </Modal>
    )
}

// =============================================================================
// Liste
// =============================================================================

function Runs({ ruleId }) {
    const t = useT()
    const runs = useQuery({ queryKey: ['tickets', 'helpdesk', 'automation-runs', ruleId], queryFn: () => ticketHelpdeskService.automationRuns(ruleId) })
    if (runs.isLoading) return <p className="lq-note">{t('common.loading')}</p>
    if (!(runs.data ?? []).length) return <p className="lq-note">{t('automation.noRuns')}</p>
    return (
        <ul className="rule-runs">
            {runs.data.map((r) => (
                <li key={r.id} className={r.outcome === 'error' ? 'is-error' : ''}>
                    <span className="tickets-row__code">{r.ticket_number}</span>
                    <span>{r.outcome === 'error' ? t('automation.runError') : t('automation.runApplied')}</span>
                    <span className="lq-note">{dayjs(r.ran_at).format('D MMM HH:mm')}</span>
                    {r.detail && <span className="rule-runs__detail">{r.detail}</span>}
                </li>
            ))}
        </ul>
    )
}

export function ruleSummary(t, rule) {
    const c = Object.keys(rule.conditions || {}).filter((k) => k !== 'age').length
    const age = rule.conditions?.age
    const parts = [t(`automation.trigger.${rule.trigger}`)]
    if (age) parts.push(t('automation.ageSummary', { hours: age.hours, basis: t(`automation.age.${age.basis}`) }))
    parts.push(t('automation.counts', { conditions: c, actions: (rule.actions || []).length }))
    return parts.join(' · ')
}

export default function AutomationsTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const options = useOptions()
    const rules = useQuery({ queryKey: ['tickets', 'helpdesk', 'automations'], queryFn: ticketHelpdeskService.automations })
    const [editing, setEditing] = useState(null)
    const [history, setHistory] = useState(null)
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['tickets', 'helpdesk', 'automations'] })
    const toggle = useMutation({
        mutationFn: (rule) => ticketHelpdeskService.updateAutomation(rule.id, {
            name: rule.name, trigger: rule.trigger, is_active: !rule.is_active, position: rule.position,
            conditions: rule.conditions, actions: rule.actions,
        }),
        onSuccess: refresh,
        onError: (error) => message.error(errText(error, t('automation.saveFailed'))),
    })
    const remove = useMutation({ mutationFn: (rule) => ticketHelpdeskService.deleteAutomation(rule.id), onSuccess: refresh })
    const list = rules.data ?? []

    return (
        <SettingsSection
            icon={<RobotOutlined />} tone="violet" title={t('automation.title')} subtitle={t('automation.hint')} count={list.length}
            actions={<Button variant="primary" icon={<PlusOutlined />} onClick={() => setEditing(EMPTY_RULE)}>{t('automation.new')}</Button>}
        >
            {list.length === 0 ? <SettingsEmpty compact text={t('automation.empty')} /> : (
                <ul className="rule-list">
                    {list.map((rule) => (
                        <li key={rule.id} className={rule.is_active ? '' : 'is-off'}>
                            <div className="rule-list__main">
                                <b>{rule.name}</b>
                                <span className="lq-note">{ruleSummary(t, rule)}</span>
                                <span className="rule-list__stats">
                                    {t('automation.runs7d', { count: rule.runs_7d })}
                                    {rule.errors_7d > 0 && <span className="rule-list__errors"> · {t('automation.errors7d', { count: rule.errors_7d })}</span>}
                                </span>
                            </div>
                            <Switch size="small" checked={rule.is_active} aria-label={t('automation.activeFor', { name: rule.name })}
                                    onChange={() => toggle.mutate(rule)} />
                            <Button size="small" variant="ghost" icon={<HistoryOutlined />} aria-label={t('automation.history')}
                                    onClick={() => setHistory(history === rule.id ? null : rule.id)} />
                            <Button size="small" variant="ghost" icon={<EditOutlined />} aria-label={t('automation.edit')}
                                    onClick={() => setEditing(rule)} />
                            <Popconfirm title={t('automation.deleteConfirm')} onConfirm={() => remove.mutate(rule)}
                                        okText={t('common.delete')} cancelText={t('common.cancel')}>
                                <Button size="small" variant="ghost" icon={<DeleteOutlined />} aria-label={t('common.delete')} />
                            </Popconfirm>
                            {history === rule.id && <div className="rule-list__runs"><Runs ruleId={rule.id} /></div>}
                        </li>
                    ))}
                </ul>
            )}
            {editing && <RuleModal rule={editing} options={options} onClose={() => setEditing(null)} onSaved={refresh} />}
        </SettingsSection>
    )
}
