/**
 * =============================================================================
 * HERMES PLATFORM - Main Layout Component
 * =============================================================================
 * TENANT tarafinin layout'u. Gorsel kabuk (sidebar/header/icerik/drawer)
 * `AppShell` bilesenindedir ve Platform Admin konsoluyla PAYLASILIR;
 * burada yalnizca tenant'a ozel olan kurulur: izin filtreli menu, route
 * prefetch, secili anahtar ve hesap menusu.
 * =============================================================================
 */

import { useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
    CodeOutlined,
    DashboardOutlined,
    ClockCircleOutlined,
    FileTextOutlined,
    LogoutOutlined,
    FileExcelOutlined,
    SettingOutlined,
    CheckSquareOutlined,
    CalendarOutlined,
    CustomerServiceOutlined,
} from '@ant-design/icons'
import AppShell from './AppShell'
import OrganizationSwitcher from './OrganizationSwitcher'
import { useAuthStore } from '../../stores/authStore'
import { authService } from '../../services/api'
import { useTaskPermissions } from '../../hooks/useTaskPermissions'
import useTicketContext from '../../features/tickets/useTicketContext'
import { useT } from '../../i18n'
import { loaderByPath } from '../../routes/loaders'
import { hasAnySettings } from '../../features/settings/sections'

/**
 * Main Layout Component
 * 
 * Özellikler:
 * - Collapsible sidebar
 * - Admin/User bazlı menü görünürlüğü
 * - User dropdown (profil, çıkış)
 */
function MainLayout() {
    // Kabuk durumu (collapsed / scroll / offline / mobil drawer) artik
    // `AppShell` icinde yasar. MainLayout yalnizca TENANT tarafina ait
    // olani kurar: izin filtreli menu, prefetch, secili anahtar ve hesap
    // menusu.
    const navigate = useNavigate()
    const location = useLocation()
    const { user, logout } = useAuthStore()

    const isAdmin = user?.is_admin === true
    const { canAccessAny } = useTaskPermissions()
    const showTasksItem = isAdmin || canAccessAny

    // RBAC R3: menu ogeleri artik ROL/izin bazli gorunur — "hepsi ya da
    // hicbiri" admin blogu yerine her oge kendi iznini ister. Bir grup,
    // icinde gorunur oge kaldiysa render edilir. can() fail-closed:
    // izinler yuklenene dek yonetim menusu gorunmez.
    const t = useT()
    const can = useAuthStore((s) => s.can)
    useAuthStore((s) => s.permissions) // re-render tetikleyici

    // Ticket yuzeyi: hub mu portal mi? Karar SUNUCUDA verilir.
    const ticketContext = useTicketContext()
    const ticketsPath = ticketContext.isPortal ? '/support' : '/tickets'

    // Dashboard, Billable Hours, Raporlar ve Sozlesmeler AYAR DEGILDIR;
    // "Yonetim" grubunda kalirlar (03-yetenekler §6).
    const managementItems = [
        { key: '/dashboard', icon: <DashboardOutlined />, label: t('nav.dashboard'), perm: 'reports.view' },
        { key: '/management/billable-hours', icon: <ClockCircleOutlined />, label: t('nav.billableHours'), perm: 'reports.view' },
        { key: '/management/reports', icon: <FileExcelOutlined />, label: t('nav.reports'), perm: 'reports.view' },
        { key: '/management/contracts', icon: <FileTextOutlined />, label: t('nav.contractStatus'), perm: 'reports.view' },
    ].filter((i) => can(i.perm)).map(({ perm, ...i }) => i)

    /*
     * B1 — ayarlar TEK cati altinda: menude tek "Ayarlar" ogesi. Hangi
     * bolumlerin acilacagini /settings kabugu izne gore secer; burada
     * yalnizca "en az bir bolum gorunur mu?" sorulur. Eskiden sekiz ayar
     * sayfasi "YAPILANDIRMA" grubunda, ucu de "YONETIM"de duz listeydi.
     */
    const canAny = useAuthStore((s) => s.canAny)
    const settingsItems = hasAnySettings(canAny) ? [
        { key: '/settings', icon: <SettingOutlined />, label: t('nav.settings') },
    ] : []

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

        const keys = [...managementItems, ...settingsItems]
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
    }, [managementItems.length, settingsItems.length])

    // Menu items
    const menuItems = [
        // Standart Kullanıcı Menüsü
        {
            key: '/time-entry',
            icon: <ClockCircleOutlined />,
            label: t('nav.timeEntry'),
        },

        ...(showTasksItem ? [
            {
                key: '/project-management',
                icon: <CheckSquareOutlined />,
                label: t('nav.projectManagement'),
            },
        ] : []),

        // Meetings — synced from Microsoft Teams / Outlook calendars.
        // Visible to every authenticated user; backend filters down to
        // meetings the user is actually an attendee of.
        {
            key: '/meetings',
            icon: <CalendarOutlined />,
            label: t('nav.meetings'),
        },

        // Developer Portal — Public API dokumantasyonu. D3: ust seviye
        // giris, TUM oturum acmis kullanicilara acik (D1). Token/client
        // YONETIMI API Management'ta admin-only kalir.
        {
            key: '/developer',
            icon: <CodeOutlined />,
            label: t('nav.developer'),
        },

        // Ticket Hub / Destek. Menu ogesi `tickets.access` ile gorunur;
        // HEDEF ROTA sunucunun bildirdigi yuzeye gore secilir — tenant
        // kimligi frontend'e GOMULMEZ. Baglam henuz yuklenmediyse
        // /tickets kullanilir ve sayfa gerekirse /support'a yonlendirir.
        ...(can('tickets.access') ? [{
            key: ticketsPath,
            icon: <CustomerServiceOutlined />,
            label: ticketsPath === '/support' ? t('nav.support') : t('nav.tickets'),
        }] : []),

        // RBAC R3: yonetim grubu, icinde GORUNUR oge varsa render
        // edilir — tek is_admin bit'i yerine oge-bazli izinler. B1 ile
        // "Ayarlar" da bu grubun son ogesidir (prototipteki yerlesim).
        ...(managementItems.length || settingsItems.length ? [
            { type: 'divider' },
            {
                key: 'admin-group',
                label: t('nav.groupManagement'),
                type: 'group',
                children: [...managementItems, ...settingsItems],
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
    const buildMenuItems = ({ collapsed }) =>
        (collapsed ? flattenGroups(navItems) : navItems)

    // User dropdown menu
    const userMenuItems = [


        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: t('nav.logout'),
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
        // Mobil drawer'i kapatmak kabugun isi (AppShell).
        if (key.startsWith('/')) navigate(key)
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

    return (
        <AppShell
            menuItems={buildMenuItems}
            mobileMenuItems={navItems}
            selectedKey={selectedKey}
            onMenuClick={handleMenuClick}
            onLogoClick={() => navigate('/time-entry')}
            accountName={user?.full_name || user?.email}
            accountRole={isAdmin ? 'Admin' : 'User'}
            accountMenuItems={userMenuItems}
            /* WS8: organizasyon secici — YALNIZCA birden fazla aktif
               uyelik varsa render eder. */
            headerExtra={<OrganizationSwitcher />}
            contentKey={location.pathname}
        >
            <Outlet />
        </AppShell>
    )
}

export default MainLayout
