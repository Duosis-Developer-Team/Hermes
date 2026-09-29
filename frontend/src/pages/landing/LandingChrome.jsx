/**
 * =============================================================================
 * HERMES - Landing kabugu: dinamik ada, alt bilgi, cerez bildirimi
 * =============================================================================
 * Landing ve yasal sayfalar (KVKK, cerez) ayni kabugu kullanir. Ada;
 * marka, bolum baglantilari (yalniz landing'de), tema + dil haplari ve
 * "Giris yap" dugmesini tasir. Cerez bildirimi yalniz ZORUNLU cerezleri
 * anlatir (Hermes reklam/analitik cerezi kullanmaz) — "Anladim" tarayici
 * depolamasina yazilir; depolama kapaliysa bildirim her ziyarette gorunur.
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoonOutlined, SafetyCertificateOutlined, SunOutlined } from '@ant-design/icons'

import { useThemeStore } from '../../stores/themeStore'
import { useLocaleStore } from '../../stores/localeStore'
import { useT } from '../../i18n'

export const COOKIE_NOTICE_KEY = 'hermes.cookieNotice.v1'

function readNoticeSeen() {
    try { return window.localStorage.getItem(COOKIE_NOTICE_KEY) === 'seen' } catch { return false }
}

/** Ada: marka + (landing'de) bolum baglantilari + tercih haplari + giris. */
export function LandingIsland({ sections = [] }) {
    const t = useT()
    const theme = useThemeStore((s) => s.theme)
    const setTheme = useThemeStore((s) => s.setTheme)
    const locale = useLocaleStore((s) => s.locale)
    const toggleLocale = useLocaleStore((s) => s.toggleLocale)
    const [scrolled, setScrolled] = useState(false)
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 12)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    return (
        <header className={`ld-island-wrap${scrolled ? ' is-scrolled' : ''}`}>
            <nav className="ld-island" aria-label={t('landing.menu')}>
                <Link to="/" className="ld-brand" aria-label="Hermes">
                    <span className="ld-mark ld-mark--sm" aria-hidden="true"><i /></span>
                    <b>Hermes</b>
                </Link>
                {sections.length > 0 && (
                    <span className="ld-island__links">
                        {sections.map(([id, label]) => (
                            <a key={id} href={`#${id}`}>{label}</a>
                        ))}
                    </span>
                )}
                <span className="ld-island__prefs">
                    <span className="island-seg" role="group" aria-label={t('login.toggleTheme')}>
                        {[['light', <SunOutlined key="s" />], ['dark', <MoonOutlined key="m" />]].map(([mode, icon]) => (
                            <button
                                key={mode}
                                type="button"
                                className={theme === mode ? 'is-on' : undefined}
                                aria-pressed={theme === mode}
                                aria-label={mode === 'light' ? t('shell.switchToLight') : t('shell.switchToDark')}
                                onClick={() => setTheme(mode)}
                            >
                                {icon}
                            </button>
                        ))}
                    </span>
                    <span className="island-seg island-seg--text" role="group" aria-label={t('shell.language')}>
                        {['tr', 'en'].map((code) => (
                            <button
                                key={code}
                                type="button"
                                className={locale === code ? 'is-on' : undefined}
                                aria-pressed={locale === code}
                                aria-label={code === 'tr' ? t('shell.switchToTurkish') : t('shell.switchToEnglish')}
                                onClick={() => { if (locale !== code) toggleLocale() }}
                            >
                                {code.toUpperCase()}
                            </button>
                        ))}
                    </span>
                    <Link to="/login" className="ld-btn ld-btn--primary ld-btn--sm">{t('landing.signIn')}</Link>
                </span>
            </nav>
        </header>
    )
}

/** Cerez bildirimi: yalniz zorunlu cerezler; "Anladim" bir kez sorulur. */
export function CookieNotice({ forceOpen = false, onClose }) {
    const t = useT()
    const [open, setOpen] = useState(() => forceOpen || !readNoticeSeen())
    useEffect(() => { if (forceOpen) setOpen(true) }, [forceOpen])
    if (!open) return null
    const accept = () => {
        try { window.localStorage.setItem(COOKIE_NOTICE_KEY, 'seen') } catch { /* depolama kapali */ }
        setOpen(false)
        onClose?.()
    }
    return (
        <div className="ld-cookie" role="region" aria-label={t('landing.cookiePrefs')}>
            <span className="ld-cookie__icon" aria-hidden="true"><SafetyCertificateOutlined /></span>
            <p>{t('landing.cookieText')}</p>
            <span className="ld-cookie__actions">
                <Link to="/cerez-politikasi" className="ld-btn ld-btn--ghost ld-btn--sm">{t('landing.cookieMore')}</Link>
                <button type="button" className="ld-btn ld-btn--primary ld-btn--sm" onClick={accept}>{t('landing.cookieOk')}</button>
            </span>
        </div>
    )
}

/** Alt bilgi: telif + yasal baglantilar + cerez bildirimini yeniden ac. */
export function LandingFooter({ onCookiePrefs }) {
    const t = useT()
    return (
        <footer className="ld-footer">
            <span className="ld-footer__brand">
                <span className="ld-mark ld-mark--sm" aria-hidden="true"><i /></span>
                {t('landing.footerRights', { year: new Date().getFullYear() })}
            </span>
            <nav className="ld-footer__links" aria-label={t('landing.kvkk')}>
                <Link to="/kvkk">{t('landing.kvkk')}</Link>
                <Link to="/cerez-politikasi">{t('landing.cookies')}</Link>
                <button type="button" onClick={onCookiePrefs}>{t('landing.cookiePrefs')}</button>
            </nav>
        </footer>
    )
}
