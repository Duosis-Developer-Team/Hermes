/**
 * HERMES - SLA rozeti (Dalga B).
 *
 * Talebin EN YAKIN karsilanmamis hedefini gosterir: once ilk yanit, sonra
 * cozum. Durum renkle TEK BASINA anlatilmaz (metin + ikon). Karsilanmis
 * SLA listede gosterilmez (`showMet` ile detayda gosterilir).
 */
import { ClockCircleOutlined, PauseCircleOutlined, WarningOutlined, CheckCircleOutlined } from '@ant-design/icons'

import { useT } from '../../i18n'

const TONE = { breached: 'danger', at_risk: 'warning', ok: 'neutral', paused: 'neutral', met: 'success' }
const ICON = {
    breached: <WarningOutlined />, at_risk: <ClockCircleOutlined />, ok: <ClockCircleOutlined />,
    paused: <PauseCircleOutlined />, met: <CheckCircleOutlined />,
}

/** 2g 3s · 3s 10dk · 25dk */
export function formatSpan(t, ms) {
    const minutes = Math.max(0, Math.round(Math.abs(ms) / 60000))
    const d = Math.floor(minutes / 1440)
    const h = Math.floor((minutes % 1440) / 60)
    const m = minutes % 60
    if (d) return h ? t('sla.spanDH', { d, h }) : t('sla.spanD', { d })
    if (h) return m ? t('sla.spanHM', { h, m }) : t('sla.spanH', { h })
    return t('sla.spanM', { m })
}

/** Siradaki karsilanmamis ayak (yoksa en son ayak). */
export function activeLeg(sla) {
    if (!sla) return null
    const legs = [['first_response', sla.first_response], ['resolution', sla.resolution]]
        .filter(([, leg]) => leg)
    return legs.find(([, leg]) => leg.status !== 'met') || legs[legs.length - 1] || null
}

export default function SlaBadge({ sla, showMet = false, now = Date.now() }) {
    const t = useT()
    const picked = activeLeg(sla)
    if (!picked) return null
    const [kind, leg] = picked
    if (leg.status === 'met' && !showMet) return null
    const diff = new Date(leg.due_at).getTime() - now
    let text
    if (leg.status === 'breached') text = t('sla.breachedBy', { span: formatSpan(t, diff) })
    else if (leg.status === 'paused') text = t('sla.paused')
    else if (leg.status === 'met') text = t('sla.met')
    else text = t('sla.left', { span: formatSpan(t, diff) })
    const label = `${t(`sla.leg.${kind}`)}: ${text}`
    return (
        <span className={`h-badge h-badge--${TONE[leg.status]} sla-badge`} title={label} aria-label={label}>
            {ICON[leg.status]} <span>{text}</span>
        </span>
    )
}

export function TagChips({ tags }) {
    if (!tags?.length) return null
    return (
        <span className="ticket-tags">
            {tags.map((tag) => (
                <span key={tag.id} className={`ticket-tag ticket-tag--${tag.color || 'blue'}`}>{tag.name}</span>
            ))}
        </span>
    )
}
