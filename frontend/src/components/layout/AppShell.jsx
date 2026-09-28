/**
 * =============================================================================
 * HERMES — Uygulama kabugu (sunum katmani) · Hermes Liquid (R2, 28.09.2026)
 * =============================================================================
 * Sol sidebar YERINE: ustte yuzen bir "ada" (dynamic island) — logo, ana
 * sekmeler, ⌘K arama, bildirim, kabuk eklentisi ve profil karti; altta
 * macOS tarzi bir DOCK — yonetim/sistem modulleri. Mobilde sekmeler alt
 * sekme cubuguna iner, tum liste "Menu" cekmecesindedir.
 *
 * Hicbir is verisi BILMEZ: menu ogeleri, hesap bilgisi ve header eklentileri
 * PROP olarak gelir (sozlesme onceki kabukla AYNI):
 *   menuItems        dizi | ({ collapsed }) => dizi — ust seviye oge = ada
 *                    sekmesi; `type: 'group'` cocuklari ve `dock: true`
 *                    ogeler = dock; `type: 'divider'` yok sayilir.
 *   mobileMenuItems  cekmecede gosterilecek liste (yoksa menuItems)
 *   selectedKey / onMenuClick / onLogoClick / accountName / accountRole /
 *   accountMenuItems / headerExtra / contentKey / children
 *   islandLive       (ops.) adanin canli yuvasi: { tone, label, meta, onClick }
 *   dockActions      (ops.) dock'un sagindaki hizli eylemler:
 *                    [{ key, label, icon, tone, onClick }]
 *
 * HAREKET (prototip): sekmelerde yayli kayan gosterge; kabuktan yapilan
 * gezinme View Transitions ile (destek yoksa aninda); paneller adadan
 * yayla acilir; dock imlece gore buyur ve tiklaninca ziplar. Hepsi
 * azaltilmis harekette kapanir.
 *
 * NEDEN AYRI BIR BILESEN: tenant tarafi ve Platform Admin konsolu AYNI
 * kabugu paylasir; tasarim farki yapisal olarak imkansizdir. Izolasyon
 * bozulmaz: kabuk veri kaynagini cagiran taraf secer, tenant store'una
 * dokunmaz.
 * =============================================================================
 */

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Drawer, Dropdown, Tooltip } from 'antd'
import {
    AppstoreOutlined,
    CheckOutlined,
    SearchOutlined,
} from '@ant-design/icons'

import { useThemeStore } from '../../stores/themeStore'
import { useLocaleStore } from '../../stores/localeStore'
import { useT } from '../../i18n'
import PageSkeleton from '../common/PageSkeleton'
import NotificationBell from './NotificationBell'
import LiquidBackdrop from './LiquidBackdrop'
import CommandPalette from './CommandPalette'
import { RouteErrorBoundary } from '../common/ErrorBoundaries'
import './MainLayout.css'

// Bu genislikin altinda ada sekmeleri gizlenir; alt sekme cubugu +
// cekmece devreye girer (MainLayout.css ile ayni esik).
const MOBILE_QUERY = '(max-width: 768px)'
// Dock ikonlari icin Hermes paleti — oge sirasina gore dongusel.
const DOCK_TONES = ['#388BFF', '#22A06B', '#8F7EE7', '#E2B203', '#526174', '#0C66E4', '#E2483D', '#6E5DD3']
const MOBILE_TABS = 4

const textOf = (it) => it.text ?? (typeof it.label === 'string' ? it.label : it.key)

const initialsOf = (name = '') => {
    const parts = String(name).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'H'
}

/** Menu listesini ada sekmeleri + dock gruplari olarak ayristirir. */
function splitNav(items) {
    const tabs = []
    const groups = []
    const extra = []
    for (const it of items) {
        if (!it || it.type === 'divider') continue
        if (it.type === 'group') {
            const children = (it.children || []).filter((c) => c && c.type !== 'divider')
            if (children.length) groups.push({ key: it.key, label: it.label, items: children })
        } else if (it.dock) {
            extra.push(it)
        } else {
            tabs.push(it)
        }
    }
    if (extra.length) groups.push({ key: 'dock-extra', label: null, items: extra })
    return { tabs, groups }
}

function AppShell({
    menuItems = [],
    mobileMenuItems,
    selectedKey,
    onMenuClick,
    onLogoClick,
    accountName,
    accountRole,
    accountMenuItems = [],
    headerExtra = null,
    contentKey,
    islandLive = null,
    dockActions = [],
    children,
}) {
    const t = useT()
    const { theme: themeMode, setTheme } = useThemeStore()
    const locale = useLocaleStore((s) => s.locale)
    const toggleLocale = useLocaleStore((s) => s.toggleLocale)

    // Icerik kayarken adaya hafif derinlik (§4).
    const [scrolled, setScrolled] = useState(false)
    // Offline banner (§9): sakin, toast-spam'siz.
    const [offline, setOffline] = useState(
        typeof navigator !== 'undefined' && navigator.onLine === false
    )
    useEffect(() => {
        const on = () => setOffline(false)
        const off = () => setOffline(true)
        window.addEventListener('online', on)
        window.addEventListener('offline', off)
        return () => {
            window.removeEventListener('online', on)
            window.removeEventListener('offline', off)
        }
    }, [])

    const [mobileNavOpen, setMobileNavOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(
        () => window.matchMedia(MOBILE_QUERY).matches
    )
    useEffect(() => {
        const mq = window.matchMedia(MOBILE_QUERY)
        const onChange = (e) => {
            setIsMobile(e.matches)
            if (!e.matches) setMobileNavOpen(false)
        }
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])

    // Sprint 3 §10: cekmece acikken arka plan scroll'u KILITLENIR ve
    // kapaninca focus tetikleyiciye doner.
    const navTriggerRef = useRef(null)
    useEffect(() => {
        if (!mobileNavOpen) return undefined
        const prev = document.body.style.overflow
        const trigger = navTriggerRef.current
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = prev
            trigger?.focus?.()
        }
    }, [mobileNavOpen])

    // ⌘K / Ctrl+K komut paleti.
    const [paletteOpen, setPaletteOpen] = useState(false)
    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                setPaletteOpen((v) => !v)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const [profileOpen, setProfileOpen] = useState(false)

    const handleContentScroll = useCallback((e) => {
        const next = e.currentTarget.scrollTop > 4
        setScrolled((prev) => (prev === next ? prev : next))
    }, [])

    // Kabuktan gezinme: View Transitions API varsa eski sayfa bulaniklasarak
    // cikar, yenisi yukselerek girer (liquid.css). flushSync, gecisin
    // "sonraki" durumu yakalayabilmesi icin rota guncellemesini esler.
    const go = (key) => {
        setMobileNavOpen(false)
        const run = () => onMenuClick?.({ key })
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        if (typeof document !== 'undefined' && document.startViewTransition && !reduce) {
            // Gecis surerken sayfa ici giris animasyonu susar (cift hareket yok).
            const root = document.documentElement
            root.classList.add('vt-nav')
            const vt = document.startViewTransition(() => flushSync(run))
            vt.finished.finally(() => root.classList.remove('vt-nav'))
        } else {
            run()
        }
    }

    // Ada sekmelerinde yayli kayan gosterge (prototipteki .tabs .ind).
    const tabsRef = useRef(null)
    const [tabInd, setTabInd] = useState(null)
    useLayoutEffect(() => {
        const measure = () => {
            const el = tabsRef.current?.querySelector('.island-tab.is-active')
            setTabInd(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [selectedKey, menuItems])

    const routeContent = useMemo(() => (
        // Sprint 3 §6: route girisi opacity+4px; kabuk sabit kalir.
        <div className="route-transition" key={contentKey}>
            {children}
        </div>
    ), [contentKey, children])

    const resolve = (items) =>
        (typeof items === 'function' ? items({ collapsed: false }) : items) || []
    const navItems = resolve(menuItems)
    const drawerItems = mobileMenuItems ? resolve(mobileMenuItems) : navItems
    const { tabs, groups } = splitNav(navItems)
    const drawerNav = splitNav(drawerItems)

    const paletteItems = [
        ...tabs.map((it) => ({ key: it.key, text: textOf(it), icon: it.icon })),
        ...groups.flatMap((g) => g.items.map((it) => ({
            key: it.key, text: textOf(it), icon: it.icon,
            group: typeof g.label === 'string' ? g.label : undefined,
        }))),
    ]

    // Dock magnification (macOS): imlece yakin ikonlar buyur. Yalnizca
    // transform — yerlesim kaymaz; azaltilmis harekette CSS kapatir.
    const dockRef = useRef(null)
    const onDockMove = (e) => {
        const icons = dockRef.current?.querySelectorAll('.dock-item') || []
        icons.forEach((el) => {
            const r = el.getBoundingClientRect()
            const d = Math.abs(e.clientX - (r.left + r.width / 2))
            const s = 1 + Math.max(0, 1 - d / 150) * 0.45
            el.style.setProperty('--dock-scale', s.toFixed(3))
        })
    }
    const onDockLeave = () => {
        dockRef.current?.querySelectorAll('.dock-item')
            .forEach((el) => el.style.setProperty('--dock-scale', '1'))
    }

    let toneIndex = 0
    const isActive = (key) => key === selectedKey

    const profileCard = (
        <div className="profile-card" role="dialog" aria-label={t('shellExtra.account')}>
            <div className="profile-card__cover" />
            <div className="profile-card__id">
                <span className="profile-card__avatar" aria-hidden="true">
                    {initialsOf(accountName)}
                    <span className="profile-card__presence" />
                </span>
                <div className="profile-card__name">
                    <strong className="user-name">{accountName}</strong>
                    {accountRole && <span className="profile-card__role">{accountRole}</span>}
                </div>
            </div>

            <div className="profile-card__section">
                <div className="profile-card__label">{t('shellExtra.appearance')}</div>
                <div className="theme-tiles" role="group" aria-label={t('shellExtra.appearance')}>
                    {['light', 'dark'].map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            className={`theme-tile${themeMode === mode ? ' is-on' : ''}`}
                            aria-pressed={themeMode === mode}
                            aria-label={mode === 'light' ? t('shell.switchToLight') : t('shell.switchToDark')}
                            onClick={() => setTheme(mode)}
                        >
                            <span className={`theme-tile__preview theme-tile__preview--${mode}`}>
                                <i /><i />
                            </span>
                            <span className="theme-tile__label">
                                {mode === 'light' ? t('shellExtra.light') : t('shellExtra.dark')}
                                {themeMode === mode && <CheckOutlined aria-hidden="true" />}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="profile-card__row">
                    <span>{t('shell.language')}</span>
                    <div className="seg" role="group" aria-label={t('shell.language')}>
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
                    </div>
                </div>
            </div>

            {accountMenuItems.length > 0 && (
                <div className="profile-card__section profile-card__actions">
                    {accountMenuItems.map((it) => (
                        <button
                            key={it.key}
                            type="button"
                            className={`profile-card__action${it.danger ? ' is-danger' : ''}`}
                            onClick={() => { setProfileOpen(false); it.onClick?.() }}
                        >
                            <span className="profile-card__action-icon">{it.icon}</span>
                            {it.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )

    return (
        <div className="main-layout">
            <LiquidBackdrop />

            {/* Ada — ust gezinme */}
            <header className="main-header" data-scrolled={scrolled || undefined}>
                <nav className="island" aria-label="Hermes">
                    <button
                        type="button"
                        className="island-brand"
                        onClick={onLogoClick}
                        aria-label={t('shellExtra.home')}
                    >
                        <span className="brand-mark" aria-hidden="true"><i /></span>
                        <span className="island-brand__word">Hermes</span>
                    </button>

                    <div className="island-tabs" role="list" ref={tabsRef}>
                        <span
                            className="island-tabs__ind"
                            aria-hidden="true"
                            style={tabInd ? { left: tabInd.left, width: tabInd.width } : { opacity: 0 }}
                        />
                        {tabs.map((it) => (
                            <button
                                key={it.key}
                                type="button"
                                role="listitem"
                                className={`island-tab${isActive(it.key) ? ' is-active' : ''}`}
                                aria-current={isActive(it.key) ? 'page' : undefined}
                                onClick={() => go(it.key)}
                            >
                                <span className="island-tab__icon" aria-hidden="true">{it.icon}</span>
                                <span className="island-tab__label">{it.label}</span>
                            </button>
                        ))}
                    </div>

                    <span className="island-sep" aria-hidden="true" />

                    {islandLive && (
                        <button
                            type="button"
                            className={`island-live island-live--${islandLive.tone || 'soon'}`}
                            onClick={islandLive.onClick}
                            aria-label={islandLive.ariaLabel}
                        >
                            <span className="island-live__dot" aria-hidden="true" />
                            <span className="island-live__meta">{islandLive.meta}</span>
                            <span className="island-live__label">{islandLive.label}</span>
                        </button>
                    )}

                    <button
                        type="button"
                        className="island-icon"
                        onClick={() => setPaletteOpen(true)}
                        aria-label={`${t('shellExtra.search')} (⌘K)`}
                    >
                        <SearchOutlined />
                    </button>
                    {/* PM rework P2.2: uygulama ici bildirim zili. */}
                    <NotificationBell />
                    {/* Kabuga ozel eklenti: tenant tarafinda organizasyon
                        secici, platform tarafinda duzlem rozeti. */}
                    {headerExtra && <span className="island-extra">{headerExtra}</span>}

                    <Dropdown
                        open={profileOpen}
                        onOpenChange={setProfileOpen}
                        trigger={['click']}
                        placement="bottomRight"
                        rootClassName="island-drop"
                        popupRender={() => profileCard}
                    >
                        <button
                            type="button"
                            className="island-avatar"
                            aria-label={`${t('shellExtra.account')}: ${accountName || ''}`}
                            aria-haspopup="dialog"
                            aria-expanded={profileOpen}
                        >
                            {initialsOf(accountName)}
                        </button>
                    </Dropdown>
                </nav>
            </header>

            {offline && (
                <div className="offline-banner" role="status">
                    Connection lost — your work will resume when you are back online.
                </div>
            )}

            {/* Sayfa icerigi — route chunk'i yuklenirken KABUK AYAKTA
                KALIR; icerik alani sayfa iskeletiyle degisir. */}
            <main className="main-content" onScroll={handleContentScroll}>
                <RouteErrorBoundary resetKey={contentKey}>
                    <Suspense fallback={<PageSkeleton />}>
                        {routeContent}
                    </Suspense>
                </RouteErrorBoundary>
            </main>

            {/* Dock — yonetim/sistem modulleri + hizli eylemler (masaustu) */}
            {(groups.length > 0 || dockActions.length > 0) && (
                <nav
                    className="app-dock"
                    aria-label={t('shellExtra.allModules')}
                    ref={dockRef}
                    onPointerMove={onDockMove}
                    onPointerLeave={onDockLeave}
                >
                    {groups.map((g, gi) => (
                        <div
                            key={g.key}
                            className="app-dock__group"
                            role="group"
                            aria-label={typeof g.label === 'string' ? g.label : undefined}
                        >
                            {gi > 0 && <span className="app-dock__sep" aria-hidden="true" />}
                            {g.items.map((it) => {
                                const tone = it.tone || DOCK_TONES[toneIndex++ % DOCK_TONES.length]
                                return (
                                    <Tooltip key={it.key} title={it.label} placement="top" mouseEnterDelay={0.05}>
                                        <button
                                            type="button"
                                            className={`dock-item${isActive(it.key) ? ' is-active' : ''}`}
                                            style={{ '--dock-tone': tone }}
                                            aria-label={textOf(it)}
                                            aria-current={isActive(it.key) ? 'page' : undefined}
                                            onClick={(e) => {
                                                // macOS dock ziplamasi (yalniz transform).
                                                const el = e.currentTarget
                                                el.classList.remove('is-bouncing')
                                                void el.offsetWidth
                                                el.classList.add('is-bouncing')
                                                go(it.key)
                                            }}
                                            onAnimationEnd={(e) => e.currentTarget.classList.remove('is-bouncing')}
                                        >
                                            {it.icon}
                                        </button>
                                    </Tooltip>
                                )
                            })}
                        </div>
                    ))}
                    {dockActions.length > 0 && (
                        <div className="app-dock__group" role="group" aria-label={t('shellExtra.quickActions')}>
                            {groups.length > 0 && <span className="app-dock__sep" aria-hidden="true" />}
                            {dockActions.map((a) => (
                                <Tooltip key={a.key} title={a.label} placement="top" mouseEnterDelay={0.05}>
                                    <button
                                        type="button"
                                        className="dock-item"
                                        style={{ '--dock-tone': a.tone }}
                                        aria-label={a.label}
                                        onClick={(e) => {
                                            const el = e.currentTarget
                                            el.classList.remove('is-bouncing')
                                            void el.offsetWidth
                                            el.classList.add('is-bouncing')
                                            a.onClick?.()
                                        }}
                                        onAnimationEnd={(e) => e.currentTarget.classList.remove('is-bouncing')}
                                    >
                                        {a.icon}
                                    </button>
                                </Tooltip>
                            ))}
                        </div>
                    )}
                </nav>
            )}

            {/* Mobil alt sekme cubugu + tum liste cekmecesi */}
            <nav className="mobile-tabbar" aria-label="Hermes">
                {tabs.slice(0, MOBILE_TABS).map((it) => (
                    <button
                        key={it.key}
                        type="button"
                        className={isActive(it.key) ? 'is-active' : undefined}
                        aria-current={isActive(it.key) ? 'page' : undefined}
                        onClick={() => go(it.key)}
                    >
                        <span aria-hidden="true">{it.icon}</span>
                        <span className="mobile-tabbar__label">{it.label}</span>
                    </button>
                ))}
                <button
                    ref={navTriggerRef}
                    type="button"
                    onClick={() => setMobileNavOpen(true)}
                    aria-label={t('shellExtra.toggleNav')}
                    aria-expanded={mobileNavOpen}
                >
                    <AppstoreOutlined aria-hidden="true" />
                    <span className="mobile-tabbar__label">{t('shellExtra.menu')}</span>
                </button>
            </nav>

            <Drawer
                open={isMobile && mobileNavOpen}
                onClose={() => setMobileNavOpen(false)}
                placement="bottom"
                height="auto"
                closable={false}
                className="mobile-nav-drawer"
                styles={{ body: { padding: 0 } }}
            >
                <div className="mobile-nav">
                    {[{ key: 'tabs', label: null, items: drawerNav.tabs }, ...drawerNav.groups].map((g) => (
                        <section key={g.key} className="mobile-nav__group" aria-label={typeof g.label === 'string' ? g.label : undefined}>
                            {g.label && <h6>{g.label}</h6>}
                            {g.items.map((it) => (
                                <button
                                    key={it.key}
                                    type="button"
                                    className={`mobile-nav__item${isActive(it.key) ? ' is-active' : ''}`}
                                    aria-current={isActive(it.key) ? 'page' : undefined}
                                    onClick={() => go(it.key)}
                                >
                                    <span aria-hidden="true">{it.icon}</span>
                                    {it.label}
                                </button>
                            ))}
                        </section>
                    ))}
                </div>
            </Drawer>

            <CommandPalette
                open={paletteOpen}
                items={paletteItems}
                onClose={() => setPaletteOpen(false)}
                onSelect={go}
            />
        </div>
    )
}

export default AppShell
