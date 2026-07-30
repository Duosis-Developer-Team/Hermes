/**
 * =============================================================================
 * HERMES - API Management: sunum kabuklari (Sprint 6A/6C)
 * =============================================================================
 * `Section` ve `StatCard` yalnizca SUNUM yapar: veri cekmez, mutation
 * calistirmaz. PM Configurations'taki acilir bolum kalibiyla ayni.
 * =============================================================================
 */
import { DownOutlined } from '@ant-design/icons'

export function Section({ icon, title, subtitle, count, accent, open, onToggle, children }) {
    return (
        <section
            className={`tm-section${open ? ' is-open' : ''}`}
            style={{ '--tm-accent': accent }}
        >
            <button
                type="button"
                className="tm-section-head"
                onClick={onToggle}
                aria-expanded={open}
            >
                <span className="tm-section-icon">{icon}</span>
                <span className="tm-section-titles">
                    <span className="tm-section-title">{title}</span>
                    {subtitle && (
                        <span className="tm-section-sub">{subtitle}</span>
                    )}
                </span>
                {typeof count === 'number' && (
                    <span className="tm-section-count">{count}</span>
                )}
                <DownOutlined className="tm-section-chevron" />
            </button>
            <div className="tm-section-body-wrap">
                <div className="tm-section-body">
                    <div className="tm-section-inner">{children}</div>
                </div>
            </div>
        </section>
    )
}

export function StatCard({ icon, label, value, accent }) {
    return (
        <div className="tm-stat" style={{ '--tm-accent': accent }}>
            <span className="tm-stat-icon">{icon}</span>
            <div className="tm-stat-body">
                <div className="tm-stat-value">{value}</div>
                <div className="tm-stat-label">{label}</div>
            </div>
        </div>
    )
}
