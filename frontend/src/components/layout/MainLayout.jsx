/**
 * =============================================================================
 * HERMES PLATFORM - Main Layout Component
 * =============================================================================
 * TENANT tarafinin layout'u. Gorsel kabuk (ada/dock/icerik/cekmece)
 * `AppShell` bilesenindedir ve Platform Admin konsoluyla PAYLASILIR;
 * burada yalnizca tenant'a ozel olan kurulur: izin filtreli menu, route
 * prefetch, secili anahtar ve hesap menusu.
 * =============================================================================
 */

import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
    CodeOutlined,
    DashboardOutlined,
    HomeOutlined,
    ClockCircleOutlined,
    FileTextOutlined,
    LogoutOutlined,
    FileExcelOutlined,
    SettingOutlined,
    CheckSquareOutlined,
    CalendarOutlined,
    CustomerServiceOutlined,
    PlusOutlined,
} from '@ant-design/icons'
import AppShell from './AppShell'
import OrganizationSwitcher from './OrganizationSwitcher'
import { useAuthStore } from '../../stores/authStore'
import { authService, customerService, projectService } from '../../services/api'
import { useTaskPermissions } from '../../hooks/useTaskPermissions'
import useTicketContext from '../../features/tickets/useTicketContext'
import { useT } from '../../i18n'
import { loaderByPath } from '../../routes/loaders'
import { hasAnySettings } from '../../features/settings/sections'
import { useNextMeeting } from '../../features/home/hooks/useNextMeeting'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../query/queryKeys'
import { useUserPhotoStore } from '../../stores/userPhotoStore'
import { useCustomerLogoStore } from '../../stores/customerLogoStore'
import { useMeetingAutoSync } from '../../features/home/hooks/useMeetingAutoSync'

/**
 * Main Layout Component — izin filtreli menu, prefetch ve hesap menusu.
 */
function MainLayout() {
    // Kabuk durumu (scroll / offline / mobil cekmece / palet) artik
    // `AppShell` icinde yasar. MainLayout yalnizca TENANT tarafina ait
    // olani kurar: izin filtreli menu, prefetch, secili anahtar ve hesap
    // menusu.
    const navigate = useNavigate()
    const location = useLocation()
    const { user, logout } = useAuthStore()

    /*
     * Profil fotografi dizini: auth dizini (has_photo + photo_etag) TEK
     * sorguyla okunur ve depoya yazilir; Avatar yalniz depoyu okur. Ayni
     * sorgu anahtari ana sayfa bloklari ile paylasilir (tek istek).
     */
    const setPhotoIndex = useUserPhotoStore((s) => s.setFromUsers)
    const directory = useQuery({
        queryKey: queryKeys.users.lookup,
        queryFn: () => authService.lookupUsers(),
        enabled: !!user?.id,
        staleTime: 10 * 60 * 1000,
    })
    useEffect(() => {
        const rows = Array.isArray(directory.data) ? directory.data : []
        setPhotoIndex(user ? [...rows, user] : rows)
    }, [directory.data, user, setPhotoIndex])

    // Musteri logolari: ayni desen — musteri listesi (has_logo + logo_etag)
    // secicilerle AYNI anahtarda okunur, CustomerLogo yalniz depoyu okur.
    const setLogoIndex = useCustomerLogoStore((s) => s.setFromCustomers)
    const customerDir = useQuery({
        queryKey: queryKeys.customers.all,
        queryFn: () => customerService.getAll(),
        enabled: !!user?.id,
        staleTime: 10 * 60 * 1000,
    })
    useEffect(() => {
        if (Array.isArray(customerDir.data)) setLogoIndex(customerDir.data)
    }, [customerDir.data, setLogoIndex])
    // Proje logolari: ayni desen (proje listesi has_logo + logo_etag).
    const setProjectLogoIndex = useCustomerLogoStore((s) => s.setFromProjects)
    const projectDir = useQuery({
        queryKey: queryKeys.projects.all,
        queryFn: () => projectService.getAll(),
        enabled: !!user?.id,
        staleTime: 10 * 60 * 1000,
    })
    useEffect(() => {
        if (Array.isArray(projectDir.data)) setProjectLogoIndex(projectDir.data)
    }, [projectDir.data, setProjectLogoIndex])

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
        // PM rework P3: ana sayfa — herkese acik, bloklar kendi iznini ister.
        {
            key: '/',
            icon: <HomeOutlined />,
            label: t('nav.home'),
        },

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
        // Hermes Liquid: ada sekmesi degil, DOCK'ta (sistem modulu).
        {
            key: '/developer',
            icon: <CodeOutlined />,
            label: t('nav.developer'),
            dock: true,
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
        // "Ayarlar" da bu grubun son ogesidir. Kabukta DOCK olur.
        ...(managementItems.length || settingsItems.length ? [
            {
                key: 'admin-group',
                label: t('nav.groupManagement'),
                type: 'group',
                children: [...managementItems, ...settingsItems],
            },
        ] : []),
    ]

    // Prefetch: her nav ogesinin label'i hover/focus intent tasir. Duz
    // metin `text` olarak korunur (⌘K paleti ve erisilebilir ad icin).
    const withPrefetch = (items) => items.map((it) => {
        if (it?.children) return { ...it, children: withPrefetch(it.children) }
        if (!it?.key?.startsWith('/')) return it
        return {
            ...it,
            text: it.label,
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

    // Adanin canli yuvasi: bugunun siradaki toplantisi (gercek veri).
    // Bu haftanin Microsoft takvimi arka planda (15 dk'da bir en fazla).
    useMeetingAutoSync(user?.id)
    const nextMeeting = useNextMeeting()
    const islandLive = nextMeeting ? {
        tone: nextMeeting.status,
        meta: nextMeeting.status === 'now'
            ? t('shellExtra.liveNow')
            : nextMeeting.minutes >= 60
                ? t('shellExtra.liveInHours', { h: Math.floor(nextMeeting.minutes / 60), m: nextMeeting.minutes % 60 })
                : t('shellExtra.liveIn', { n: nextMeeting.minutes }),
        label: nextMeeting.subject,
        ariaLabel: `${t('shellExtra.liveOpen')}: ${nextMeeting.subject}`,
        onClick: () => navigate('/meetings'),
    } : null

    // Dock hizli eylemleri (prototip): efor gir ve yeni is — mevcut derin
    // baglantilar uzerinden (yeni akis yok; izinler hedef sayfada ayni).
    const dockActions = [
        {
            key: 'log', label: t('home.quickLog'), icon: <ClockCircleOutlined />, tone: '#388BFF',
            onClick: () => navigate(`/time-entry?date=${dayjs().format('YYYY-MM-DD')}`),
        },
        ...(showTasksItem ? [{
            key: 'new-work', label: t('board.newTask'), icon: <PlusOutlined />, tone: '#22A06B',
            onClick: () => navigate('/project-management?new=task'),
        }] : []),
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
            menuItems={navItems}
            selectedKey={selectedKey}
            onMenuClick={handleMenuClick}
            onPrepareNav={(key) => loaderByPath[key]?.()}
            onLogoClick={() => navigate('/')}
            accountName={user?.full_name || user?.email}
            accountEmail={user?.email}
            accountId={user?.id}
            accountRole={isAdmin ? 'Admin' : 'User'}
            accountMenuItems={userMenuItems}
            /* WS8: organizasyon secici — YALNIZCA birden fazla aktif
               uyelik varsa render eder. */
            headerExtra={<OrganizationSwitcher />}
            contentKey={location.pathname}
            islandLive={islandLive}
            dockActions={dockActions}
        >
            <Outlet />
        </AppShell>
    )
}

export default MainLayout
