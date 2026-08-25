/**
 * =============================================================================
 * HERMES — Uygulama kabugu (sunum katmani)
 * =============================================================================
 * Sidebar + header + icerik alani + mobil drawer. Hicbir is verisi BILMEZ:
 * menu ogeleri, hesap bilgisi ve header eklentileri PROP olarak gelir.
 *
 * NEDEN AYRI BIR BILESEN: Platform Admin konsolu once kendi layout'unu
 * kullaniyordu ve Hermes'e benzemiyordu. "Benzer" yetmez — ayni bilesen
 * ve ayni CSS kullanilmadikca iki kabuk zamanla ayrisir. Tenant tarafi ve
 * platform tarafi artik BU bileseni paylasir; tasarim farki YAPISAL olarak
 * imkansizdir.
 *
 * Izolasyon bozulmaz: kabuk sunum katmanidir, veri kaynagini cagiran taraf
 * secer. Platform kabugu tenant store'larina HIC dokunmaz.
 * =============================================================================
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Button, Drawer, Dropdown, Layout, Menu, Space, Typography } from 'antd'
import {
    BulbFilled,
    BulbOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    UserOutlined,
} from '@ant-design/icons'

import { useThemeStore } from '../../stores/themeStore'
import { IconButton } from '../ui'
import logoFullDark from '../../assets/logos/logo-full-dark.jpg'
import logoFullLight from '../../assets/logos/logo-full-light.png'
import logoIconDark from '../../assets/logos/logo-icon-dark.jpg'
import logoIconLight from '../../assets/logos/logo-icon-light.png'
import PageSkeleton from '../common/PageSkeleton'
import { RouteErrorBoundary } from '../common/ErrorBoundaries'
import './MainLayout.css'

const { Header, Sider, Content } = Layout
const { Text } = Typography

// Bu genislikin altinda sabit Sider gizlenir (MainLayout.css) ve
// navigasyon slide-in Drawer'a tasinir.
const MOBILE_QUERY = '(max-width: 768px)'
const SIDEBAR_KEY = 'hermes-sidebar-collapsed'

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
    children,
}) {
    // Collapse tercihi persist (paket §3 Collapsed).
    const [collapsed, setCollapsedState] = useState(() => {
        try { return localStorage.getItem(SIDEBAR_KEY) === '1' } catch { return false }
    })
    const setCollapsed = (v) => {
        setCollapsedState(v)
        try { localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0') } catch { /* yok say */ }
    }
    // Header scroll durumu (§4): icerik kayarken hafif elevation.
    const [scrolled, setScrolled] = useState(false)
    const contentRef = useRef(null)
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
    // Mobil navigasyon drawer'i (768px altinda sidebar yerine).
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

    const { theme: themeMode, toggleTheme } = useThemeStore()
    const isLight = themeMode === 'light'

    // Sprint 3 §10: drawer acikken arka plan scroll'u KILITLENIR ve
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

    const handleContentScroll = useCallback((e) => {
        const next = e.currentTarget.scrollTop > 4
        setScrolled((prev) => (prev === next ? prev : next))
    }, [])

    const handleMenuClick = (info) => {
        onMenuClick?.(info)
        if (isMobile) setMobileNavOpen(false)
    }

    const routeContent = useMemo(() => (
        // Sprint 3 §6: route girisi opacity+4px; shell sabit kalir.
        <div className="route-transition" key={contentKey}>
            {children}
        </div>
    ), [contentKey, children])

    /*
     * `menuItems` bir DIZI ya da `({ collapsed }) => dizi` olabilir.
     * Sebep: collapsed sidebar'da AntD `type: 'group'` basliklarini 72px'e
     * sigmayan kirpilmis bloklar olarak render eder; tenant menusu bu
     * durumda gruplari duzlestiriyor. Bu karar menuyu KURAN tarafa aittir,
     * ama girdisi (collapsed) kabuga ait — bu yuzden fonksiyon olarak
     * geciriliyor. Drawer her zaman genistir: collapsed=false ile cozulur.
     */
    const resolve = (items, isCollapsed) =>
        (typeof items === 'function' ? items({ collapsed: isCollapsed }) : items) || []

    const siderItems = resolve(menuItems, collapsed)
    const drawerItems = mobileMenuItems
        ? resolve(mobileMenuItems, false)
        : resolve(menuItems, false)

    return (
        <Layout className="main-layout">
            {/* Sidebar */}
            <Sider
                trigger={null}
                collapsible
                collapsed={collapsed}
                width={240}
                collapsedWidth={72}
                className="main-sider"
            >
                {/* Logo: expanded'da wordmark, collapsed'da ikon —
                    crossfade; distortion yok (§3 Collapsed). */}
                <div
                    className="logo-container"
                    onClick={onLogoClick}
                    role="link"
                    aria-label="Home"
                >
                    <img
                        src={isLight ? logoFullLight : logoFullDark}
                        alt="Hermes"
                        className="sidebar-logo sidebar-logo--full"
                    />
                    <img
                        src={isLight ? logoIconLight : logoIconDark}
                        alt=""
                        aria-hidden="true"
                        className="sidebar-logo sidebar-logo--icon"
                    />
                </div>

                {/* Navigation Menu */}
                <Menu
                    theme={isLight ? 'light' : 'dark'}
                    mode="inline"
                    selectedKeys={[selectedKey]}
                    items={siderItems}
                    onClick={handleMenuClick}
                    className="main-menu"
                />

                {/* Sidebar Footer */}
                {!collapsed && (
                    <div className="sidebar-footer fade-in">
                        <div className="copyright-text">Copyright © 2026 Duosis</div>
                        <div className="rights-text">All rights reserved.</div>
                    </div>
                )}
            </Sider>

            {/* Main Content Area */}
            <Layout>
                {/* Header */}
                <Header className="main-header" data-scrolled={scrolled || undefined}>
                    {/* Collapse Button — mobilde Sider gizli oldugu icin
                        ayni buton navigasyon drawer'ini acar. */}
                    <Button
                        ref={navTriggerRef}
                        type="text"
                        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                        onClick={() =>
                            isMobile
                                ? setMobileNavOpen(true)
                                : setCollapsed(!collapsed)
                        }
                        className="collapse-btn"
                        aria-label="Toggle navigation"
                    />

                    {/* Spacer */}
                    <div style={{ flex: 1 }} />

                    {/* Tema: kisa ikon crossfade/rotate'li buton (§11);
                        reduced-motion global kuralla durur. */}
                    <IconButton
                        label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
                        icon={
                            <span className="theme-toggle-icon" data-mode={isLight ? 'light' : 'dark'}>
                                {isLight ? <BulbFilled /> : <BulbOutlined />}
                            </span>
                        }
                        onClick={toggleTheme}
                        className="theme-toggle-btn"
                    />

                    {/* Kabuga ozel eklenti: tenant tarafinda organizasyon
                        secici, platform tarafinda duzlem rozeti. */}
                    {headerExtra}

                    {/* User Dropdown */}
                    <Dropdown menu={{ items: accountMenuItems }} placement="bottomRight">
                        <Space className="user-dropdown">
                            <Avatar
                                icon={<UserOutlined />}
                                style={{ backgroundColor: 'var(--color-primary)' }}
                            />
                            <div className="user-info">
                                <Text className="user-name">{accountName}</Text>
                                <Text className="user-role">{accountRole}</Text>
                            </div>
                        </Space>
                    </Dropdown>
                </Header>

                {/* Page Content — route chunk'i yuklenirken SHELL AYAKTA
                    KALIR; icerik alani sayfa iskeletiyle degisir. */}
                {offline && (
                    <div className="offline-banner" role="status">
                        Connection lost — your work will resume when you are back online.
                    </div>
                )}
                <Content
                    className="main-content"
                    ref={contentRef}
                    onScroll={handleContentScroll}
                >
                    <RouteErrorBoundary resetKey={contentKey}>
                        <Suspense fallback={<PageSkeleton />}>
                            {routeContent}
                        </Suspense>
                    </RouteErrorBoundary>
                </Content>
            </Layout>

            {/* Mobil navigasyon drawer'i — 768px altinda gizlenen Sider'in
                yerine gecer. Ayni menu ogeleri; tiklayinca gider + kapanir. */}
            <Drawer
                open={isMobile && mobileNavOpen}
                onClose={() => setMobileNavOpen(false)}
                placement="left"
                width={264}
                closable={false}
                className="mobile-nav-drawer"
                styles={{ body: { padding: 0 } }}
            >
                <div
                    className="logo-container"
                    onClick={() => {
                        onLogoClick?.()
                        setMobileNavOpen(false)
                    }}
                >
                    <img
                        src={isLight ? logoFullLight : logoFullDark}
                        alt="Hermes"
                        className="sidebar-logo"
                    />
                </div>
                <Menu
                    theme={isLight ? 'light' : 'dark'}
                    mode="inline"
                    selectedKeys={[selectedKey]}
                    items={drawerItems}
                    onClick={handleMenuClick}
                    className="main-menu"
                />
            </Drawer>
        </Layout>
    )
}

export default AppShell
