/**
 * =============================================================================
 * HERMES - Super-admin genel bakis (Faz 2)
 * =============================================================================
 * Sayilar (kiraci / etkin / askida / aktif destek oturumu), modul kullanimi
 * (kac kiraci hangi modulu kullaniyor) ve son eklenen kiracilar. Yalniz
 * kontrol duzlemi metadata'si.
 * =============================================================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Empty } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { platformService } from '../../api/platformApi'
import { CountUp, GlassCard } from '../../components/liquid'
import { MODULE_CODES } from '../../features/modules/catalog'
import { useT } from '../../i18n'
import { MODULE_ICON, MODULE_TONE, ModuleBadges } from './ModulePicker'
import { TenantMark, TenantStatus, useTenants } from './TenantList'
import './platform.css'

function PlatformOverview({ onOpenTenant, onViewTenants }) {
    const t = useT()
    const [data, setData] = useState(null)
    const { rows } = useTenants()

    useEffect(() => {
        platformService.overview().then(setData).catch(() => setData({}))
    }, [])

    const byStatus = data?.tenants?.by_status || {}
    const kpis = [
        { key: 'total', label: t('platform.tenants'), value: data?.tenants?.total ?? rows.length },
        { key: 'active', label: t('common.active'), value: byStatus.active ?? 0 },
        { key: 'suspended', label: t('platform.suspended'), value: byStatus.suspended ?? 0 },
        { key: 'sessions', label: t('platform.activeSessions'), value: data?.support_sessions_active ?? 0 },
    ]

    const usage = useMemo(() => MODULE_CODES.map((code) => ({
        code, n: rows.filter((r) => (r.modules || []).includes(code)).length,
    })), [rows])
    const max = Math.max(1, ...usage.map((u) => u.n))
    const recent = useMemo(() => [...rows]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 6), [rows])

    return (
        <>
            <div className="lq-kpis lq-enter" role="group" aria-label={t('platform.overview')}>
                {kpis.map((k) => (
                    <GlassCard key={k.key} className="lq-kpi">
                        <span className="lq-kpi__dash" aria-hidden="true" />
                        <span className="lq-kpi__value"><CountUp value={k.value} /></span>
                        <span className="lq-kpi__label">{k.label}</span>
                    </GlassCard>
                ))}
            </div>
            <div className="pc-ov lq-enter">
                <GlassCard title={t('platform.moduleStats')}>
                    <ul className="pc-mstat">
                        {usage.map(({ code, n }) => (
                            <li key={code} className={`pc-tone--${MODULE_TONE[code]}`}>
                                <span className="pc-mbadge" aria-hidden="true">{MODULE_ICON[code]}</span>
                                <span className="pc-mstat__name">{t(`modules.${code}`)}</span>
                                <span className="pc-mstat__track" aria-hidden="true"><i style={{ width: `${(n / max) * 100}%` }} /></span>
                                <span className="pc-mstat__n">{n}</span>
                            </li>
                        ))}
                    </ul>
                </GlassCard>
                <GlassCard
                    title={t('platform.recentTenants')}
                    link={<Button type="link" size="small" onClick={onViewTenants}>{t('platform.viewAll')} <RightOutlined /></Button>}
                >
                    {recent.length === 0 ? <Empty description={t('platform.noTenants')} /> : (
                        <ul className="pc-recent">
                            {recent.map((r) => (
                                <li key={r.id}>
                                    <button type="button" onClick={() => onOpenTenant(r.id)}>
                                        <span className="pc-tenant">
                                            <TenantMark name={r.display_name} />
                                            <span className="pc-tenant__text">
                                                <b>{r.display_name}</b>
                                                <small>{r.created_at ? dayjs(r.created_at).format('D MMM YYYY') : r.slug}</small>
                                            </span>
                                        </span>
                                        <span className="pc-tenant">
                                            <ModuleBadges modules={r.modules || []} />
                                            <TenantStatus status={r.status} />
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </GlassCard>
            </div>
        </>
    )
}

export default PlatformOverview
