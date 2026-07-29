/**
 * =============================================================================
 * HERMES DS V2 - Primitive component seti (Sprint 2, CTO paketi §10)
 * =============================================================================
 * 15 primitive; hepsi YALNIZCA semantic token tuketir (ui.css).
 * AntD'nin ustune ince sarmalayicilar: davranis (focus trap, key nav)
 * AntD'den gelir, gorsel dil tokenlardan. Yeni bagimlilik YOK.
 *
 * Kullanim kurali (§3.2): feature kodu ham hex/px shadow YAZMAZ; burada
 * olmayan bir gorsel ihtiyac cikarsa once token/primitive'e eklenir.
 */
import { Button as AntButton, Modal, Spin } from 'antd'
import './ui.css'

const cx = (...parts) => parts.filter(Boolean).join(' ')

/* --- Layout ------------------------------------------------------------ */

export function Surface({ elevated = false, className, children, ...rest }) {
    return (
        <div className={cx('h-surface', elevated && 'h-surface--elevated', className)} {...rest}>
            {children}
        </div>
    )
}

export function Card({
    interactive = false, selected = false, className, children, ...rest
}) {
    return (
        <div
            className={cx(
                'h-card',
                interactive && 'h-card--interactive',
                selected && 'h-card--selected',
                className,
            )}
            {...(interactive ? { tabIndex: 0, role: rest.role ?? 'button' } : {})}
            {...rest}
        >
            {children}
        </div>
    )
}

export function Page({ className, children, ...rest }) {
    return <div className={cx('h-page', className)} {...rest}>{children}</div>
}

export function PageHeader({ title, subtitle, extra, className, ...rest }) {
    return (
        <div className={cx('h-page-header', className)} {...rest}>
            <div>
                <h1 className="h-page-header__title">{title}</h1>
                {subtitle && <p className="h-page-header__subtitle">{subtitle}</p>}
            </div>
            {extra && <div className="h-inline" style={{ gap: 'var(--h-space-2)' }}>{extra}</div>}
        </div>
    )
}

export function Toolbar({ className, children, ...rest }) {
    return <div className={cx('h-toolbar', className)} {...rest}>{children}</div>
}
Toolbar.Spacer = function ToolbarSpacer() { return <div className="h-toolbar__spacer" /> }

export function Stack({ gap = 3, className, children, ...rest }) {
    return (
        <div className={cx('h-stack', className)}
             style={{ gap: `var(--h-space-${gap})`, ...rest.style }} {...rest}>
            {children}
        </div>
    )
}

export function Inline({ gap = 2, className, children, ...rest }) {
    return (
        <div className={cx('h-inline', className)}
             style={{ gap: `var(--h-space-${gap})`, ...rest.style }} {...rest}>
            {children}
        </div>
    )
}

/* --- Actions ------------------------------------------------------------ */

/** AntD Button sarmalayicisi: variant→AntD type esleme, loading'te
 *  genislik korunur (AntD zaten spinner'i icerde tutar). */
export function Button({ variant = 'default', danger = false, ...rest }) {
    const type = { primary: 'primary', ghost: 'text', default: 'default' }[variant] ?? 'default'
    return <AntButton type={type} danger={danger} {...rest} />
}

/** Icon-only buton: erisilebilir ad ZORUNLU (aria-label yoksa gelistirme
 *  aninda console uyarisi — sessiz erisilemezlik birikmesin). */
export function IconButton({ label, icon, size = 'middle', ...rest }) {
    if (!label && import.meta.env?.DEV) {
        console.warn('[hermes-ui] IconButton icin label zorunlu')
    }
    return (
        <AntButton
            type="text"
            aria-label={label}
            title={label}
            icon={icon}
            size={size}
            {...rest}
        />
    )
}

/* --- Status / data ------------------------------------------------------ */

const BADGE_TONES = ['neutral', 'success', 'warning', 'danger', 'info', 'brand']

export function StatusBadge({ tone = 'neutral', className, children, ...rest }) {
    const safe = BADGE_TONES.includes(tone) ? tone : 'neutral'
    return (
        <span className={cx('h-badge', `h-badge--${safe}`, className)} {...rest}>
            {children}
        </span>
    )
}

export function Metric({ label, value, hint, className, ...rest }) {
    return (
        <div className={cx('h-metric', className)} {...rest}>
            <span className="h-metric__label">{label}</span>
            <span className="h-metric__value">{value}</span>
            {hint && <span className="h-metric__hint">{hint}</span>}
        </div>
    )
}

export function EmptyState({ title, description, action, className, ...rest }) {
    return (
        <div className={cx('h-empty', className)} role="status" {...rest}>
            <span className="h-empty__title">{title}</span>
            {description && <span>{description}</span>}
            {action}
        </div>
    )
}

export function InlineError({ children, className, ...rest }) {
    return (
        <div className={cx('h-inline-error', className)} role="alert" {...rest}>
            {children}
        </div>
    )
}

export function FilterChip({ active = false, className, children, ...rest }) {
    return (
        <button
            type="button"
            className={cx('h-chip', active && 'h-chip--active', className)}
            aria-pressed={active}
            {...rest}
        >
            {children}
        </button>
    )
}

/* --- Overlays ----------------------------------------------------------- */

/** Standart modal sarmalayicisi: DS radius/motion AntD koprusunden gelir;
 *  form pending iken yanlislikla kapanmayi engelleme politikasi
 *  (maskClosable=false + keyboard=false) pending prop'uyla acilir. */
export function AppModal({ pending = false, ...rest }) {
    return (
        <Modal
            maskClosable={!pending}
            keyboard={!pending}
            closable={!pending}
            {...rest}
        />
    )
}

/** Onay diyalogu: yikici eylemler danger'la isaretlenir; pending'te
 *  kapanma kilitli, buton etiketi anlamini korur (§7 UX sozlesmesi). */
export function ConfirmDialog({
    open, title, description, confirmText = 'Onayla',
    cancelText = 'Vazgeç', danger = false, pending = false,
    onConfirm, onCancel, children,
}) {
    return (
        <AppModal
            open={open}
            title={title}
            pending={pending}
            onCancel={pending ? undefined : onCancel}
            footer={[
                <AntButton key="cancel" onClick={onCancel} disabled={pending}>
                    {cancelText}
                </AntButton>,
                <AntButton
                    key="confirm"
                    type="primary"
                    danger={danger}
                    loading={pending}
                    onClick={onConfirm}
                >
                    {confirmText}
                </AntButton>,
            ]}
        >
            {description && <p style={{ margin: 0 }}>{description}</p>}
            {children}
            {pending && (
                <div className="h-inline" style={{ gap: 'var(--h-space-2)', marginTop: 'var(--h-space-3)' }}>
                    <Spin size="small" /> <span>İşleniyor…</span>
                </div>
            )}
        </AppModal>
    )
}
