/**
 * =============================================================================
 * HERMES PLATFORM - Main Layout Component
 * =============================================================================
 * Ana sayfa düzeni. Sidebar navigation ve header içerir.
 * Ant Design Layout bileşenleri kullanılır.
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Drawer, Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Switch } from 'antd'
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
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore } from '../../stores/themeStore'
import { authService } from '../../services/api'
import { useTaskPermissions } from '../../hooks/useTaskPermissions'
import logoFullDark from '../../assets/logos/logo-full-dark.jpg'
import logoFullLight from '../../assets/logos/logo-full-light.png'
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

function MainLayout() {
    const [collapsed, setCollapsed] = useState(false)
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
    const permissions = useAuthStore((s) => s.permissions) // re-render tetikleyici

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

    return (
        <Layout className="main-layout">
            {/* Sidebar */}
            <Sider
                trigger={null}
                collapsible
                collapsed={collapsed}
                width={240}
                className="main-sider"
            >
                {/* Logo - Tıklandığında anasayfaya yönlendirir */}
                <div className="logo-container" onClick={() => navigate('/time-entry')}>
                    <img
                        src={isLight ? logoFullLight : logoFullDark}
                        alt="Hermes"
                        className="sidebar-logo"
                    />
                </div>

                {/* Navigation Menu */}
                <Menu
                    theme={isLight ? 'light' : 'dark'}
                    mode="inline"
                    selectedKeys={[selectedKey]}
                    items={menuItems}
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
                <Header className="main-header">
                    {/* Collapse Button — on mobile the Sider is hidden, so
                        the same button opens the navigation drawer instead. */}
                    <Button
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

                    {/* Light / Dark toggle — sliding switch, default dark */}
                    <Switch
                        className="theme-switch"
                        checked={isLight}
                        onChange={toggleTheme}
                        checkedChildren={<BulbFilled />}
                        unCheckedChildren={<BulbOutlined />}
                        aria-label="Toggle light and dark mode"
                    />

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

                {/* Page Content */}
                <Content className="main-content">
                    <Outlet />
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
                    items={menuItems}
                    onClick={handleMenuClick}
                    className="main-menu"
                />
            </Drawer>
        </Layout>
    )
}

export default MainLayout
