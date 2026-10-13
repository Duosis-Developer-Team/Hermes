/**
 * =============================================================================
 * HERMES - Talep agi (super-admin, Faz 3.0)
 * =============================================================================
 * "Hangi tenant, HANGI tenant'a ve oradaki HANGI EKIBE talep acabilir?"
 * (CTO karari K3: ag yalniz super-admin'den kurulur.)
 *
 * Bir baglanti = talep eden → saglayici + varsayilan ekip. Canonical talep
 * saglayicinin verisinde durur; saglayici onu "Gelen talepler"de, talep eden
 * "Actigim talepler"de gorur. Pasif baglanti yeni talebi durdurur, gecmis
 * talepler iki tarafta da kalir.
 *
 * SINIR: bu ekran yalniz KONFIGURASYON gosterir; talep icerigi platform
 * duzlemine hic gelmez (arka uc donduremez).
 * =============================================================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Select, Switch, Typography, message } from 'antd'
import { ClusterOutlined, PlusOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons'

import { platformService } from '../../api/platformApi'
import { GlassCard, ModalHead } from '../../components/liquid'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import { matchesAny } from '../../utils/searchText'
import { useT } from '../../i18n'
import { TenantMark } from './TenantList'
import './platform.css'

const { Text } = Typography

/** Sunucunun makine-okur kodu → yerel mesaj (yoksa sunucu metni). */
export function networkError(t, err, fallbackKey = 'platform.network.saveFailed') {
    const detail = err?.response?.data?.detail
    const code = detail?.code
    const known = ['version_conflict', 'group_inactive', 'provider_unavailable', 'self_link', 'unknown_tenant']
    if (known.includes(code)) return t(`platform.network.err.${code}`)
    return detail?.message || (typeof detail === 'string' ? detail : null) || t(fallbackKey)
}

export function useNetwork() {
    const t = useT()
    const [state, setState] = useState({ items: null, providers: [], moduleState: null })
    const load = () => Promise.all([platformService.supportNetwork(), platformService.supportProviders()])
        .then(([net, prov]) => setState({
            items: net.items || [],
            providers: prov.providers || [],
            moduleState: prov.module_state || net.module_state,
        }))
        .catch(() => {
            setState((s) => ({ ...s, items: s.items || [] }))
            message.error(t('platform.network.loadFailed'))
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load() }, [])
    return { ...state, reload: load }
}

// =============================================================================
// Yeni baglanti
// =============================================================================

export function ConnectModal({ open, onClose, onDone, providers, initialProvider }) {
    const t = useT()
    const [tenants, setTenants] = useState([])
    const [requester, setRequester] = useState(null)
    const [provider, setProvider] = useState(initialProvider || null)
    const [group, setGroup] = useState(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!open) return
        setRequester(null)
        setProvider(initialProvider || providers[0]?.tenant_id || null)
        setGroup(null)
        platformService.listTenants({ limit: 100 })
            .then((d) => setTenants(d.tenants || []))
            .catch(() => setTenants([]))
    }, [open, initialProvider, providers])

    const providerRow = providers.find((p) => p.tenant_id === provider)
    const groups = providerRow?.groups || []
    const requesterRow = tenants.find((x) => x.id === requester)
    const requesterNoTickets = requesterRow && !(requesterRow.modules || []).includes('tickets')

    useEffect(() => { setGroup(groups[0]?.id || null) }, [provider]) // eslint-disable-line react-hooks/exhaustive-deps

    const submit = async () => {
        setBusy(true)
        try {
            await platformService.setNetworkLink(requester, provider, { group_id: group })
            message.success(t('platform.network.connected'))
            onDone?.()
        } catch (err) {
            message.error(networkError(t, err))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal
            open={open}
            title={<ModalHead icon={<ClusterOutlined />} tone="violet" title={t('platform.network.newConnection')} />}
            onCancel={onClose}
            onOk={submit}
            okText={t('platform.network.connect')}
            okButtonProps={{ disabled: !requester || !provider || !group, loading: busy }}
            destroyOnHidden
        >
            <div className="pc-form">
                <p className="pc-muted">{t('platform.network.connectHint')}</p>
                <label className="pc-field">
                    <span>{t('platform.network.requester')}</span>
                    <Select
                        showSearch
                        optionFilterProp="label"
                        aria-label={t('platform.network.requester')}
                        placeholder={t('platform.network.chooseRequester')}
                        value={requester}
                        onChange={setRequester}
                        options={tenants
                            .filter((x) => x.id !== provider)
                            .map((x) => ({ value: x.id, label: x.display_name }))}
                    />
                </label>
                {requesterNoTickets && (
                    <Alert type="warning" showIcon message={t('platform.network.requesterNoTickets')} />
                )}
                <label className="pc-field">
                    <span>{t('platform.network.provider')}</span>
                    <Select
                        aria-label={t('platform.network.provider')}
                        placeholder={t('platform.network.chooseProvider')}
                        value={provider}
                        onChange={setProvider}
                        options={providers
                            .filter((p) => p.tenant_id !== requester)
                            .map((p) => ({ value: p.tenant_id, label: p.display_name || p.slug }))}
                        notFoundContent={t('platform.network.noProviders')}
                    />
                </label>
                <label className="pc-field">
                    <span>{t('platform.network.team')}</span>
                    <Select
                        aria-label={t('platform.network.team')}
                        placeholder={t('platform.network.chooseTeam')}
                        value={group}
                        onChange={setGroup}
                        disabled={!provider}
                        options={groups.map((g) => ({
                            value: g.id, label: `${g.name} · ${t('platform.network.members', { count: g.member_count })}`,
                        }))}
                        notFoundContent={t('platform.network.noTeams')}
                    />
                </label>
            </div>
        </Modal>
    )
}

// =============================================================================
// Saglayici karti
// =============================================================================

function ProviderCard({ provider, links, groups, canManage, onChanged }) {
    const t = useT()
    const [pending, setPending] = useState(null)
    const unavailable = links.some((l) => !l.provider_available)

    const save = async (link, groupId, okKey) => {
        setPending(link.requester_tenant_id)
        try {
            await platformService.setNetworkLink(link.requester_tenant_id, link.provider_tenant_id, {
                group_id: groupId, expected_version: link.version,
            })
            message.success(t(okKey))
            onChanged()
        } catch (err) {
            message.error(networkError(t, err))
        } finally {
            setPending(null)
        }
    }
    const disable = async (link) => {
        setPending(link.requester_tenant_id)
        try {
            await platformService.disableNetworkLink(link.requester_tenant_id, link.provider_tenant_id, link.version)
            message.success(t('platform.network.disabled'))
            onChanged()
        } catch (err) {
            message.error(networkError(t, err))
        } finally {
            setPending(null)
        }
    }

    return (
        <GlassCard className="pc-net lq-enter">
            <header className="pc-net__head">
                <span className="pc-tenant">
                    <TenantMark name={provider.name} />
                    <span className="pc-tenant__text">
                        <b>{provider.name}</b>
                        <small>{t('platform.network.connectedCount', { count: links.length })}</small>
                    </span>
                </span>
                <span className="pc-net__badges">
                    {provider.isSupport && <span className="lq-tag lq-tag--info">{t('platform.network.supportTenant')}</span>}
                    {unavailable && (
                        <span className="lq-tag lq-tag--warn"><WarningOutlined /> {t('platform.network.providerUnavailable')}</span>
                    )}
                </span>
            </header>
            <ul className="pc-net__list">
                {links.map((link) => (
                    <li key={link.requester_tenant_id} className={link.is_active ? '' : 'is-off'}>
                        <span className="pc-tenant">
                            <TenantMark name={link.requester_display_name} />
                            <span className="pc-tenant__text">
                                <b>{link.requester_display_name}</b>
                                {!link.requester_has_tickets && (
                                    <small className="pc-warn">{t('platform.network.requesterNoTicketsShort')}</small>
                                )}
                            </span>
                        </span>
                        <Select
                            className="pc-net__team"
                            size="small"
                            aria-label={t('platform.network.teamFor', { name: link.requester_display_name })}
                            value={link.group_id || undefined}
                            placeholder={t('platform.network.chooseTeam')}
                            disabled={!canManage || !link.is_active || pending === link.requester_tenant_id}
                            onChange={(groupId) => save(link, groupId, 'platform.network.teamChanged')}
                            options={groups.map((g) => ({ value: g.id, label: g.name }))}
                        />
                        <span className="pc-net__state">
                            <Text type={link.is_active ? undefined : 'secondary'}>
                                {link.is_active ? t('common.active') : t('platform.network.inactive')}
                            </Text>
                            <Switch
                                size="small"
                                aria-label={t('platform.network.toggleFor', { name: link.requester_display_name })}
                                checked={link.is_active}
                                loading={pending === link.requester_tenant_id}
                                disabled={!canManage}
                                onChange={(on) => {
                                    if (!on) { disable(link); return }
                                    const groupId = link.group_id || groups[0]?.id
                                    if (!groupId) { message.error(t('platform.network.noTeams')); return }
                                    save(link, groupId, 'platform.network.connected')
                                }}
                            />
                        </span>
                    </li>
                ))}
            </ul>
        </GlassCard>
    )
}

// =============================================================================
// Sayfa
// =============================================================================

function TicketNetwork() {
    const t = useT()
    const canManage = usePlatformAuthStore((s) => s.can('platform.tenants.manage'))
    const { items, providers, moduleState, reload } = useNetwork()
    const [query, setQuery] = useState('')
    const [connecting, setConnecting] = useState(false)

    const groupsOf = useMemo(() => Object.fromEntries(
        providers.map((p) => [p.tenant_id, p.groups || []]),
    ), [providers])

    const cards = useMemo(() => {
        const byProvider = new Map()
        ;(items || [])
            .filter((l) => matchesAny([l.requester_display_name, l.provider_display_name], query))
            .forEach((l) => {
                const key = l.provider_tenant_id
                if (!byProvider.has(key)) {
                    const meta = providers.find((p) => p.tenant_id === key)
                    byProvider.set(key, {
                        id: key,
                        name: l.provider_display_name,
                        isSupport: Boolean(meta?.is_support_tenant),
                        links: [],
                    })
                }
                byProvider.get(key).links.push(l)
            })
        return [...byProvider.values()].sort((a, b) =>
            (b.isSupport - a.isSupport) || String(a.name).localeCompare(String(b.name), 'tr'))
    }, [items, providers, query])

    if (moduleState && moduleState !== 'ok') {
        return (
            <Alert
                type="warning" showIcon
                message={t('platform.network.moduleNotConfigured')}
                description={t('platform.network.moduleState', { state: moduleState })}
            />
        )
    }

    return (
        <>
            <div className="pc-toolbar">
                <Input
                    className="pc-toolbar__search"
                    allowClear
                    prefix={<SearchOutlined aria-hidden="true" />}
                    placeholder={t('platform.network.search')}
                    aria-label={t('platform.network.search')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <span className="pc-toolbar__spacer" />
                {canManage && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setConnecting(true)}
                            disabled={!providers.length}>
                        {t('platform.network.newConnection')}
                    </Button>
                )}
            </div>
            {items === null ? null : cards.length === 0 ? (
                <GlassCard>
                    <Empty description={query ? t('platform.network.noMatches') : t('platform.network.empty')} />
                </GlassCard>
            ) : (
                <div className="pc-net__grid">
                    {cards.map((card) => (
                        <ProviderCard
                            key={card.id}
                            provider={card}
                            links={card.links}
                            groups={groupsOf[card.id] || []}
                            canManage={canManage}
                            onChanged={reload}
                        />
                    ))}
                </div>
            )}
            <ConnectModal
                open={connecting}
                providers={providers}
                onClose={() => setConnecting(false)}
                onDone={() => { setConnecting(false); reload() }}
            />
        </>
    )
}

export default TicketNetwork
