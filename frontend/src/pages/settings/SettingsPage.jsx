/**
 * =============================================================================
 * HERMES - Ayarlar (Hermes Liquid, 29.09 — Apple Developer duzeni)
 * =============================================================================
 * /settings            → AYARLAR MERKEZI: bolum basliklari altinda buyuk
 *                        uygulama ikonlari yan yana, adlari altlarinda;
 *                        arama ikonlari suzer.
 * /settings/<b>/<sayfa> → sayfa: ustte "‹ Ayarlar" + dock (yalniz ikon,
 *                        kayar, ad ustune gelince), altta tam genislik icerik.
 * Katalog TEK kaynak: features/settings/sections.js (izin filtresi orada).
 * Izni olmayan kutucuk/serit ogesi CIZILMEZ; hic izin yoksa ana ekrana.
 * =============================================================================
 */
import { useRef, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Input, Spin, Tooltip } from 'antd'
import {
    ApiOutlined, AppstoreOutlined, BarChartOutlined, BranchesOutlined,
    CustomerServiceOutlined, DatabaseOutlined, FolderOutlined, LeftOutlined,
    SearchOutlined, SettingOutlined, ShopOutlined, TagsOutlined, TeamOutlined,
} from '@ant-design/icons'

import { PageHero } from '../../components/liquid'
import { hasAnySettings, visibleSections } from '../../features/settings/sections'
import { loaderByPath } from '../../routes/loaders'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'
import './SettingsPage.css'

// Kutucuk ikonu + rengi (uygulama ikonu gibi gradyan kare).
const ITEMS = {
    users: [<TeamOutlined key="i" />, 'blue'],
    capacity: [<BarChartOutlined key="i" />, 'green'],
    pm: [<SettingOutlined key="i" />, 'ink'],
    'work-types': [<TagsOutlined key="i" />, 'amber'],
    'activity-types': [<AppstoreOutlined key="i" />, 'violet'],
    platforms: [<DatabaseOutlined key="i" />, 'teal'],
    'work-lines': [<BranchesOutlined key="i" />, 'pink'],
    customers: [<ShopOutlined key="i" />, 'green'],
    projects: [<FolderOutlined key="i" />, 'blue'],
    api: [<ApiOutlined key="i" />, 'ink'],
    tickets: [<CustomerServiceOutlined key="i" />, 'red'],
}

function Tile({ item, compact = false }) {
    const t = useT()
    const [icon, tone] = ITEMS[item.key] || [<SettingOutlined key="i" />, 'ink']
    const warm = () => loaderByPath[item.path]?.()
    const label = t(item.labelKey)
    if (compact) {
        // Dock ogesi: yalniz ikon; ad ustune gelince (portal ipucu — dock'un
        // kaydirma kirpmasina takilmaz). Erisilebilir ad aria-label ile.
        return (
            <Tooltip title={label} placement="bottom" mouseEnterDelay={0.05}>
            <NavLink
                to={item.path}
                className={({ isActive }) => `settings-dock__item${isActive ? ' active' : ''}`}
                onMouseEnter={warm}
                aria-label={label}
            >
                <span className={`settings-icon settings-icon--${tone} settings-icon--dock`} aria-hidden="true">{icon}</span>
            </NavLink>
            </Tooltip>
        )
    }
    // Uygulama izgarasi: buyuk ikon, altinda ad (aciklama ipucunda).
    return (
        <Link to={item.path} className="settings-app" onMouseEnter={warm} title={t(`settings.desc.${item.key}`)}>
            <span className={`settings-icon settings-icon--${tone} settings-icon--lg`} aria-hidden="true">{icon}</span>
            <span className="settings-app__label">{label}</span>
        </Link>
    )
}

/** /settings — ayarlar merkezi (izinli kutucuklar). */
export function SettingsIndex() {
    const t = useT()
    const permissions = useAuthStore((s) => s.permissions)
    const canAny = useAuthStore((s) => s.canAny)
    const [query, setQuery] = useState('')
    // Izinler henuz yuklenmediyse karar verilmez (fail-closed bekleme).
    if (permissions === null) {
        return <div className="settings-loading"><Spin /></div>
    }
    if (!hasAnySettings(canAny)) return <Navigate to="/time-entry" replace />
    const q = query.trim().toLocaleLowerCase()
    const sections = visibleSections(canAny)
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => !q
                || t(item.labelKey).toLocaleLowerCase().includes(q)
                || t(`settings.desc.${item.key}`).toLocaleLowerCase().includes(q)),
        }))
        .filter((section) => section.items.length > 0)

    return (
        <div className="settings-hub">
            <PageHero
                className="lq-enter"
                title={t('settings.title')}
                subtitle={t('settings.subtitle')}
                actions={(
                    <Input
                        allowClear
                        className="settings-search"
                        prefix={<SearchOutlined aria-hidden="true" />}
                        placeholder={t('settings.searchPlaceholder')}
                        aria-label={t('settings.searchPlaceholder')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                )}
            />
            {sections.length === 0 && <p className="settings-empty">{t('settings.noMatch')}</p>}
            <div className="settings-groups">
            {sections.map((section, si) => (
                <section key={section.key} className="settings-group lq-enter" style={{ animationDelay: `${si * 50}ms` }}>
                    <h2 className="settings-group__title">{t(section.labelKey)}</h2>
                    <div className="settings-grid">
                        {section.items.map((item) => <Tile key={item.key} item={item} />)}
                    </div>
                </section>
            ))}
            </div>
        </div>
    )
}

/** /settings/... — secili sayfa: geri + yatay ikon seridi + icerik. */
function SettingsPage() {
    const t = useT()
    const canAny = useAuthStore((s) => s.canAny)
    useAuthStore((s) => s.permissions) // izin gelince yeniden render
    const { pathname } = useLocation()
    // Dock buyutmesi (macOS): imlece yakin ikonlar buyur — yalniz transform.
    const dockRef = useRef(null)
    const onDockMove = (e) => {
        dockRef.current?.querySelectorAll('.settings-dock__item').forEach((el) => {
            const r = el.getBoundingClientRect()
            const d = Math.abs(e.clientX - (r.left + r.width / 2))
            el.style.setProperty('--dock-scale', (1 + Math.max(0, 1 - d / 120) * 0.2).toFixed(3))
        })
    }
    const onDockLeave = () => dockRef.current?.querySelectorAll('.settings-dock__item')
        .forEach((el) => el.style.setProperty('--dock-scale', '1'))
    const isHub = pathname.replace(/\/+$/, '') === '/settings'
    if (isHub) return <Outlet />
    const items = visibleSections(canAny).flatMap((s) => s.items)

    return (
        <div className="settings-page">
            <div className="settings-topbar">
                <Link to="/settings" className="settings-back">
                    <LeftOutlined aria-hidden="true" />{t('settings.title')}
                </Link>
                <nav
                    className="settings-dock"
                    aria-label={t('settings.title')}
                    onMouseMove={onDockMove}
                    onMouseLeave={onDockLeave}
                    ref={dockRef}
                >
                    {items.map((item) => <Tile key={item.key} item={item} compact />)}
                </nav>
            </div>
            <div className="settings-content">
                <Outlet />
            </div>
        </div>
    )
}

export default SettingsPage
