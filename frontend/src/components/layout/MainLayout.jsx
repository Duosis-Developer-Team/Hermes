/**
 * =============================================================================
 * HERMES PLATFORM - Main Layout Component
 * =============================================================================
 * Ana sayfa düzeni. Sidebar navigation ve header içerir.
 * Ant Design Layout bileşenleri kullanılır.
 * =============================================================================
 */

import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Switch } from 'antd'
import {
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
function MainLayout() {
    const [collapsed, setCollapsed] = useState(false)
    const navigate = useNavigate()
    const location = useLocation()
    const { user, logout } = useAuthStore()
    const { theme: themeMode, toggleTheme } = useThemeStore()
    const isLight = themeMode === 'light'

    const isAdmin = user?.is_admin === true
    const { canAccessTasks } = useTaskPermissions()
    const showTasksItem = isAdmin || canAccessTasks

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
                key: '/tasks',
                icon: <CheckSquareOutlined />,
                label: 'Tasks',
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

        // Admin Menüsü
        ...(isAdmin ? [
            {
                type: 'divider',
            },
            {
                key: 'admin-group',
                label: 'MANAGEMENT',
                type: 'group',
                children: [
                    {
                        key: '/dashboard',
                        icon: <DashboardOutlined />,
                        label: 'Dashboard',
                    },
                    {
                        key: '/management/billable-hours',
                        icon: <ClockCircleOutlined />,
                        label: 'Billable Hours',
                    },
                    {
                        key: '/management/reports',
                        icon: <FileExcelOutlined />,
                        label: 'Reports',
                    },
                    {
                        key: '/management/contracts',
                        icon: <FileTextOutlined />,
                        label: 'Contract Status',
                    },
                    {
                        key: '/task-management',
                        icon: <CheckSquareOutlined />,
                        label: 'Task Management',
                    },
                ],
            },
            {
                key: 'config-group',
                label: 'CONFIGURATION',
                type: 'group',
                children: [
                    {
                        key: '/customers',
                        icon: <TeamOutlined />,
                        label: 'Customers',
                    },
                    {
                        key: '/projects',
                        icon: <ProjectOutlined />,
                        label: 'Projects',
                    },
                    {
                        key: '/work-types',
                        icon: <AppstoreOutlined />,
                        label: 'Work Types',
                    },
                    {
                        key: '/activity-types',
                        icon: <AppstoreOutlined />,
                        label: 'Activity Types',
                    },
                    {
                        key: '/platforms',
                        icon: <SettingOutlined />,
                        label: 'Platforms',
                    },
                    {
                        key: '/work-lines',
                        icon: <SettingOutlined />,
                        label: 'Work Lines',
                    },
                    {
                        key: '/users',
                        icon: <UserOutlined />,
                        label: 'Users',
                    },
                ],
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
        }
    }

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
                    selectedKeys={[location.pathname]}
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
                    {/* Collapse Button */}
                    <Button
                        type="text"
                        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                        onClick={() => setCollapsed(!collapsed)}
                        className="collapse-btn"
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
        </Layout>
    )
}

export default MainLayout
