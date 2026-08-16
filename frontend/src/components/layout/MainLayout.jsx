/**
 * =============================================================================
 * HERMES PLATFORM - Main Layout Component
 * =============================================================================
 * Ana sayfa düzeni. Sidebar navigation ve header içerir.
 * Ant Design Layout bileşenleri kullanılır.
 * =============================================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Suspense } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Drawer, Layout, Menu, Avatar, Dropdown, Space, Typography, Button } from 'antd'
import {
    ApiOutlined,
    CodeOutlined,
    DashboardOutlined,
    ClockCircleOutlined,
    TeamOutlined,
    ProjectOutlined,
    AppstoreOutlined,
    UserOutlined,
    FileTextOutlined,
    LogoutOutlined,
    FileExcelOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    SettingOutlined,
    CheckSquareOutlined,
    CalendarOutlined,
    BulbFilled,
    BulbOutlined,
} from '@ant-design/icons'
import OrganizationSwitcher from './OrganizationSwitcher'
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore } from '../../stores/themeStore'
import { authService } from '../../services/api'
import { useTaskPermissions } from '../../hooks/useTaskPermissions'
import { loaderByPath } from '../../routes/loaders'
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

/**
 * Main Layout Component
 * 
 * Özellikler:
 * - Collapsible sidebar
 * - Admin/User bazlı menü görünürlüğü
 * - User dropdown (profil, çıkış)
 */
// Below this width the fixed Sider is hidden (see MainLayout.css) and
// navigation moves into a slide-in Drawer.
const MOBILE_QUERY = '(max-width: 768px)'

const SIDEBAR_KEY = 'hermes-sidebar-collapsed'

function MainLayout() {
    // Sprint 3: collapse tercihi persist (paket §3 Collapsed).
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
    // Mobile navigation drawer (sidebar replacement under 768px).
    const [mobileNavOpen, setMobileNavOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(
        () => window.matchMedia(MOBILE_QUERY).matches
    )
    const navigate = useNavigate()
    const location = useLocation()

    useEffect(() => {
        const mq = window.matchMedia(MOBILE_QUERY)
        const onChange = (e) => {
            setIsMobile(e.matches)
            if (!e.matches) setMobileNavOpen(false)
        }
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])
    const { user, logout } = useAuthStore()
    const { theme: themeMode, toggleTheme } = useThemeStore()
    const isLight = themeMode === 'light'

    const isAdmin = user?.is_admin === true
    const { canAccessAny } = useTaskPermissions()
    const showTasksItem = isAdmin || canAccessAny

    // RBAC R3: menu ogeleri artik ROL/izin bazli gorunur — "hepsi ya da
    // hicbiri" admin blogu yerine her oge kendi iznini ister. Bir grup,
    // icinde gorunur oge kaldiysa render edilir. can() fail-closed:
    // izinler yuklenene dek yonetim menusu gorunmez.
    const can = useAuthStore((s) => s.can)
    useAuthStore((s) => s.permissions) // re-render tetikleyici

    const managementItems = [
        { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard', perm: 'reports.view' },
        { key: '/management/billable-hours', icon: <ClockCircleOutlined />, label: 'Billable Hours', perm: 'reports.view' },
        { key: '/management/reports', icon: <FileExcelOutlined />, label: 'Reports', perm: 'reports.view' },
        { key: '/management/contracts', icon: <FileTextOutlined />, label: 'Contract Status', perm: 'reports.view' },
        { key: '/pm-configurations', icon: <CheckSquareOutlined />, label: 'PM Configurations', perm: 'tasks.permissions.manage' },
        { key: '/api-management', icon: <ApiOutlined />, label: 'API Management', perm: 'api.manage' },
    ].filter((i) => can(i.perm)).map(({ perm, ...i }) => i)

    const configurationItems = [
        { key: '/customers', icon: <TeamOutlined />, label: 'Customers', perm: 'customers.manage' },
        { key: '/projects', icon: <ProjectOutlined />, label: 'Projects', perm: 'projects.manage' },
        { key: '/work-types', icon: <AppstoreOutlined />, label: 'Work Types', perm: 'reference.manage' },
        { key: '/activity-types', icon: <AppstoreOutlined />, label: 'Activity Types', perm: 'reference.manage' },
        { key: '/platforms', icon: <SettingOutlined />, label: 'Platforms', perm: 'reference.manage' },
        { key: '/work-lines', icon: <SettingOutlined />, label: 'Work Lines', perm: 'reference.manage' },
        { key: '/users', icon: <UserOutlined />, label: 'Users', perm: 'users.manage' },
    ].filter((i) => can(i.perm)).map(({ perm, ...i }) => i)

    // Sprint 3 §10: drawer acikken arka plan scroll'u KILITLENIR ve
    // kapaninca focus tetikleyiciye doner. AntD kendi kilidini gercek
    // tarayicida uygular; burada acik ve ortamdan bagimsiz garanti
    // veriyoruz (jsdom'da AntD hicbir sey yazmiyor — testle sabit).
    const navTriggerRef = useRef(null)
    useEffect(() => {
        if (!mobileNavOpen) return undefined
        const prev = document.body.style.overflow
        // Ref cleanup'ta degismis olabilir — effect ICINDE yakalanir.
        const trigger = navTriggerRef.current
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = prev
            // Focus guvenli sekilde tetikleyiciye doner.
            trigger?.focus?.()
        }
    }, [mobileNavOpen])

    // Sprint 3 §7: nav uzerinde kisa pointer-intent sonrasi route
    // CHUNK'i prefetch edilir (API verisi degil). Menu izin-filtreli
    // oldugu icin izinsiz route prefetch'i yapisal olarak imkansiz.
    const prefetchTimer = useRef(null)
    const prefetchRoute = (key) => {
        const loader = loaderByPath[key]
        if (!loader) return
        clearTimeout(prefetchTimer.current)
        prefetchTimer.current = setTimeout(() => loader(), 65)
    }
    const cancelPrefetch = () => clearTimeout(prefetchTimer.current)

    /*
     * PERFORMANS (olcumlu): cold route gecisi p95 ~458 ms, warm ~253 ms —
     * fark route CHUNK'inin ilk indirilmesi. Tarayici bosta kaldiginda,
     * kullanicinin GERCEKTEN gorebildigi menu rotalarinin chunk'lari
     * sirayla isitilir; boylece ilk tiklama da "warm" hizinda acilir.
     *
     * Sinirlar: yalnizca izin filtresinden GECMIS menu ogeleri (izinsiz
     * rota prefetch edilemez — liste zaten filtreli), initial bundle
     * BUYUMEZ (hepsi ayri lazy chunk), her chunk bir kez istenir (dinamik
     * import modul cache'i), idle yoksa kisa timeout'a duser ve
     * `save-data`/yavas baglantida hic kosmaz.
     */
    const idlePrefetchDone = useRef(false)
    useEffect(() => {
        if (idlePrefetchDone.current) return undefined
        const conn = typeof navigator !== 'undefined' ? navigator.connection : null
        if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return undefined

        const keys = [...managementItems, ...configurationItems]
            .map((i) => i.key)
            .filter((k) => loaderByPath[k])
        if (!keys.length) return undefined
        idlePrefetchDone.current = true

        let cancelled = false
        let handle = null
        const idle = window.requestIdleCallback
            || ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 400))
        const cancelIdle = window.cancelIdleCallback || clearTimeout

        const step = (index) => {
            if (cancelled || index >= keys.length) return
            handle = idle(() => {
                loaderByPath[keys[index]]?.()
                step(index + 1)
            })
        }
        step(0)
        return () => {
            cancelled = true
            if (handle != null) cancelIdle(handle)
        }
        // Menu listeleri izinler cozulunce bir kez dolar; ref tekrar
        // kosmayi engeller.
    }, [managementItems.length, configurationItems.length])

    // Menu items
    const menuItems = [
        // Standart Kullanıcı Menüsü
        {
            key: '/time-entry',
            icon: <ClockCircleOutlined />,
            label: 'Time Entry',
        },

        ...(showTasksItem ? [
            {
                key: '/project-management',
                icon: <CheckSquareOutlined />,
                label: 'Project Management',
            },
        ] : []),

        // Meetings — synced from Microsoft Teams / Outlook calendars.
        // Visible to every authenticated user; backend filters down to
        // meetings the user is actually an attendee of.
        {
            key: '/meetings',
            icon: <CalendarOutlined />,
            label: 'Meetings',
        },

        // Developer Portal — Public API dokumantasyonu. D3: ust seviye
        // giris, TUM oturum acmis kullanicilara acik (D1). Token/client
        // YONETIMI API Management'ta admin-only kalir.
        {
            key: '/developer',
            icon: <CodeOutlined />,
            label: 'Developer',
        },

        // RBAC R3: yonetim gruplari, icinde GORUNUR oge varsa render
        // edilir — tek is_admin bit'i yerine oge-bazli izinler.
        ...(managementItems.length || configurationItems.length ? [
            { type: 'divider' },
        ] : []),
        ...(managementItems.length ? [
            {
                key: 'admin-group',
                label: 'MANAGEMENT',
                type: 'group',
                children: managementItems,
            },
        ] : []),
        ...(configurationItems.length ? [
            {
                key: 'config-group',
                label: 'CONFIGURATION',
                type: 'group',
                children: configurationItems,
            },
        ] : []),
    ]

    // Prefetch: her nav ogesinin label'i hover/focus intent tasir.
    const withPrefetch = (items) => items.map((it) => {
        if (it?.children) return { ...it, children: withPrefetch(it.children) }
        if (!it?.key?.startsWith('/')) return it
        return {
            ...it,
            label: (
                <span
                    onMouseEnter={() => prefetchRoute(it.key)}
                    onMouseLeave={cancelPrefetch}
                    onFocus={() => prefetchRoute(it.key)}
                >
                    {it.label}
                </span>
            ),
        }
    })
    const navItems = withPrefetch(menuItems)

    /*
     * Sprint 8 — collapsed sidebar'da MANAGEMENT/CONFIGURATION bug'inin
     * KOK NEDENI: AntD Menu, `type: 'group'` basliklarini collapsed
     * modda da render eder ve 72px'e sigmayan buyuk harfli metin
     * kirpilmis gri bloklar olarak gorunur. `overflow: hidden` ile
     * SAKLANMADI — collapsed durumda gruplar DOM seviyesinde duzlestirilir:
     * baslik kalkar, bolum ayrimi dusuk kontrastli mevcut divider ile
     * verilir, ogeler ve tooltip davranislari aynen kalir. Drawer her
     * zaman genis oldugu icin duzlestirilmemis `navItems` kullanmaya
     * devam eder.
     */
    const flattenGroups = (items) => items.flatMap((it, i) => {
        if (it?.type !== 'group') return [it]
        // Ust uste cift divider uretme: onceki oge zaten divider ise
        // (menu, gruplardan once bir tane koyuyor) yenisi eklenmez;
        // listenin en basindaki grup da onde divider tasimaz.
        const prev = items[i - 1]
        const sep = !prev || prev.type === 'divider' ? [] : [{ type: 'divider' }]
        return [...sep, ...(it.children || [])]
    })
    const siderItems = collapsed ? flattenGroups(navItems) : navItems

    // User dropdown menu
    const userMenuItems = [


        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: 'Logout',
            danger: true,
            onClick: async () => {
                // [KRİTİK-6] Backend cookie'yi siler, sonra UI state temizlenir
                try {
                    await authService.logout()
                } finally {
                    logout()
                    navigate('/login')
                }
            },
        },
    ]

    const handleMenuClick = ({ key }) => {
        if (key.startsWith('/')) {
            navigate(key)
            setMobileNavOpen(false)
        }
    }

    // Highlight the menu item whose key is the longest prefix of the current
    // path, so sub-routes (e.g. /project-management/issues) keep the parent
    // item active.
    const flatKeys = []
    const collectKeys = (items) =>
        items.forEach((it) => {
            if (it?.key?.startsWith('/')) flatKeys.push(it.key)
            if (it?.children) collectKeys(it.children)
        })
    collectKeys(menuItems)
    const selectedKey =
        flatKeys
            .filter(
                (k) =>
                    location.pathname === k ||
                    location.pathname.startsWith(k + '/')
            )
            .sort((a, b) => b.length - a.length)[0] || location.pathname

    /*
     * PERFORMANS: `collapsed`, `scrolled` ve tema degisimi MainLayout'u
     * yeniden render ediyor; Outlet JSX'i her seferinde YENI element
     * uretince React tum route agacini da yeniden isliyordu (sidebar
     * acilip kapanirken hissedilen takilmanin kaynagi). Element
     * referansi yalniz ROTA degisince yenilenir → React bail-out.
     */
    // Scroll handler kimligi sabit: her render'da yeni fonksiyon uretip
    // Content'e yeni prop gecmez.
    const handleContentScroll = useCallback((e) => {
        const next = e.currentTarget.scrollTop > 4
        setScrolled((prev) => (prev === next ? prev : next))
    }, [])

    const routeContent = useMemo(() => (
        // Sprint 3 §6: route girisi opacity+4px; shell sabit kalir.
        <div className="route-transition" key={location.pathname}>
            <Outlet />
        </div>
    ), [location.pathname])

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
                    onClick={() => navigate('/time-entry')}
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
                    {/* Collapse Button — on mobile the Sider is hidden, so
                        the same button opens the navigation drawer instead. */}
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

                    {/* WS8: organizasyon secici — YALNIZCA birden fazla
                        aktif uyelik varsa render eder (aksi halde null
                        doner ve tek organizasyonlu kurulumda hicbir sey
                        degismez). */}
                    <OrganizationSwitcher />

                    {/* User Dropdown */}
                    <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                        <Space className="user-dropdown">
                            <Avatar
                                icon={<UserOutlined />}
                                style={{ backgroundColor: 'var(--color-primary)' }}
                            />
                            <div className="user-info">
                                <Text className="user-name">{user?.full_name || user?.email}</Text>
                                <Text className="user-role">
                                    {isAdmin ? 'Admin' : 'User'}
                                </Text>
                            </div>
                        </Space>
                    </Dropdown>
                </Header>

                {/* Page Content — Sprint 1: route chunk'i yuklenirken
                    SHELL AYAKTA KALIR; icerik alani sayfa iskeletiyle
                    degisir (full-screen spinner yasak, §5.3). Route
                    hatasi kurtarilabilir boundary'de kalir, shell'i
                    dusurmez; route degisince kendini sifirlar. */}
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
                    <RouteErrorBoundary resetKey={location.pathname}>
                        <Suspense fallback={<PageSkeleton />}>
                            {/* Sprint 3 §6: route girisi opacity+4px, ~200ms;
                                shell sabit; reduced-motion'da global kural
                                animasyonu pratik sifira indirir. */}
                            {routeContent}
                        </Suspense>
                    </RouteErrorBoundary>
                </Content>
            </Layout>

            {/* Mobile navigation drawer — replaces the hidden Sider under
                768px. Same menu items; tapping a link navigates + closes. */}
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
                        navigate('/time-entry')
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
                    items={navItems}
                    onClick={handleMenuClick}
                    className="main-menu"
                />
            </Drawer>
        </Layout>
    )
}

export default MainLayout
