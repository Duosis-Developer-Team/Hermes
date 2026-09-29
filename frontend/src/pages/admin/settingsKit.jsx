/**
 * =============================================================================
 * HERMES - Ayar sayfalari icin kucuk sunum kiti (Hermes Liquid, 29.09)
 * =============================================================================
 * PM Ayarlari, API Yonetimi ve Talep Entegrasyonlari ayni dili konusur:
 *   SettingsKpis     Panel ile ayni KPI karolari (lq-kpis)
 *   SettingsSection  cam bolum karti: ikon kutusu + baslik + alt satir +
 *                    sagda eylemler
 *   SettingsEmpty    ortali, dostane bos durum: ikon + tek cumle + eylem
 *   SettingsTabs     cok bolumlu sayfalar icin hap segment (sayacli)
 * Bilesenler veri BILMEZ, mutation calistirmaz; yalniz sunum yapar.
 * Stil: settingsKit.css (kayan icerikte backdrop-filter YOK).
 * =============================================================================
 */
import { CountUp, GlassCard, LiquidSegmented } from '../../components/liquid'
import './settingsKit.css'

/** KPI karolari. `value` null/undefined ise tire gosterilir. */
export function SettingsKpis({ items, ariaLabel }) {
    return (
        <div className="lq-kpis lq-enter sk-kpis" role="group" aria-label={ariaLabel}>
            {items.map((k) => (
                <GlassCard key={k.key} className="lq-kpi">
                    <span className="lq-kpi__dash" aria-hidden="true" />
                    <span className="lq-kpi__value">
                        {k.value === null || k.value === undefined
                            ? '—'
                            : <CountUp value={k.value} />}
                    </span>
                    <span className="lq-kpi__label">{k.label}</span>
                    {k.hint && <span className="sk-kpi__hint">{k.hint}</span>}
                </GlassCard>
            ))}
        </div>
    )
}

/**
 * Cam bolum karti. `tone`: 'blue' | 'violet' | 'green' | 'amber' | 'red'
 * | 'ink' (lq-mico renkleri).
 */
export function SettingsSection({
    icon, tone = 'blue', title, subtitle, count, actions, children, className = '', bodyClassName = '', ...rest
}) {
    return (
        <section className={`sk-card ${className}`} {...rest}>
            <header className="sk-card__head">
                {icon && <span className={`lq-mico lq-mico--${tone} sk-card__icon`} aria-hidden="true">{icon}</span>}
                <div className="sk-card__titles">
                    <h2 className="sk-card__title">
                        {title}
                        {typeof count === 'number' && <span className="sk-count">{count}</span>}
                    </h2>
                    {subtitle && <p className="sk-card__sub">{subtitle}</p>}
                </div>
                {actions && <div className="sk-card__actions">{actions}</div>}
            </header>
            <div className={`sk-card__body ${bodyClassName}`}>{children}</div>
        </section>
    )
}

/** Bos durum: ikon + (istege bagli baslik) + tek cumle + eylem. */
export function SettingsEmpty({ icon, title, text, action, compact = false }) {
    return (
        <div className={`sk-empty${compact ? ' sk-empty--compact' : ''}`} role="status">
            {icon && <span className="sk-empty__icon" aria-hidden="true">{icon}</span>}
            {title && <b className="sk-empty__title">{title}</b>}
            {text && <p className="sk-empty__text">{text}</p>}
            {action && <div className="sk-empty__action">{action}</div>}
        </div>
    )
}

/**
 * Bolum secici: hap segment. options: [{ value, label, count? }].
 * Dar ekranda yatay kayar (sayfa yatay kaymaz).
 */
export function SettingsTabs({ options, value, onChange, ariaLabel }) {
    return (
        <div className="sk-tabs">
            <LiquidSegmented
                ariaLabel={ariaLabel}
                value={value}
                onChange={onChange}
                options={options.map((o) => ({
                    value: o.value,
                    label: (
                        <span className="sk-tab">
                            {o.icon && <span className="sk-tab__icon" aria-hidden="true">{o.icon}</span>}
                            {o.label}
                            {typeof o.count === 'number' && <span className="sk-tab__count">{o.count}</span>}
                        </span>
                    ),
                }))}
            />
        </div>
    )
}
