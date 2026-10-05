/**
 * =============================================================================
 * HERMES - Ayarlar (Hermes Liquid, 29.09 — Apple Developer duzeni)
 * =============================================================================
 * /settings            → AYARLAR MERKEZI: tum ikonlar bolumleriyle TEK
 *                        satirda ekran genisligine yayilir (bolum, oge
 *                        sayisi kadar kolon kaplar); buyuk ikon, ad altta.
 *                        Arama ikonlari suzer. Dar ekranda satirlar sarar.
 * /settings/<b>/<sayfa> → sayfa: ustte "‹ Ayarlar" + soldan saga tam
 *                        genislik kaydirmali ray (ikon + ad, ok dugmeleri,
 *                        kenar solmasi, secili oge gorunur alana kayar).
 * Katalog TEK kaynak: features/settings/sections.js (izin filtresi orada).
 * Izni olmayan kutucuk/serit ogesi CIZILMEZ; hic izin yoksa ana ekrana.
 * =============================================================================
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Input, Spin } from 'antd'
import {
    ApiOutlined, AppstoreOutlined, BarChartOutlined, BgColorsOutlined, BranchesOutlined, CustomerServiceOutlined, DatabaseOutlined, FolderOutlined, LeftOutlined, RightOutlined, SearchOutlined, SettingOutlined, ShopOutlined, TagsOutlined, TeamOutlined,
} from '@ant-design/icons'

import { PageHero } from '../../components/liquid'
import { hasAnySettings, visibleSections } from '../../features/settings/sections'
import { loaderByPath } from '../../routes/loaders'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'
import './SettingsPage.css'
import { matchesAny } from '../../utils/searchText'

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
    'project-types': [<BgColorsOutlined key="i" />, 'violet'],
    api: [<ApiOutlined key="i" />, 'ink'],
    tickets: [<CustomerServiceOutlined key="i" />, 'red'],
}

function Tile({ item, compact = false }) {
    const t = useT()
    const [icon, tone] = ITEMS[item.key] || [<SettingOutlined key="i" />, 'ink']
    const warm = () => loaderByPath[item.path]?.()
    const label = t(item.labelKey)
    if (compact) {
        // Ray ogesi: ikon + kisa ad (altta); secili oge vurgulu.
        return (
            <NavLink
                to={item.path}
                className={({ isActive }) => `settings-rail__item${isActive ? ' active' : ''}`}
                onMouseEnter={warm}
                title={label}
            >
                <span className={`settings-icon settings-icon--${tone} settings-icon--rail`} aria-hidden="true">{icon}</span>
                <span className="settings-rail__label">{label}</span>
            </NavLink>
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

// Bolum genisligi: oge basina 2 kolon; tek ogeli bolum baslik ve uzun ad
// sigsin diye 3 kolon.
const weightOf = (section) => section.items.length * 2 + (section.items.length === 1 ? 1 : 0)

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
    const q = query.trim()
    const sections = visibleSections(canAny)
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => !q
                || matchesAny([t(item.labelKey), t(`settings.desc.${item.key}`)], q)),
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
            <div className="settings-groups" style={{ '--total': sections.reduce((n, sec) => n + weightOf(sec), 0) || 1 }}>
            {sections.map((section, si) => (
                <section
                    key={section.key}
                    className="settings-group lq-enter"
                    style={{ animationDelay: `${si * 50}ms`, '--span': section.items.length, '--weight': weightOf(section) }}
                >
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

/**
 * Kaydirmali ray: tasma varsa kenarlarda ok dugmeleri + solma maskesi;
 * secili sayfa acilista gorunur alanin ortasina kayar. Tekerlek dikey
 * hareketi yataya cevrilir (fare ile rahat kaydirma).
 */
function SettingsRail({ items, label, pathname }) {
    const t = useT()
    const ref = useRef(null)
    const [edges, setEdges] = useState({ left: false, right: false })
    const measure = useCallback(() => {
        const el = ref.current
        if (!el) return
        setEdges({
            left: el.scrollLeft > 4,
            right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
        })
    }, [])
    useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        el.querySelector('.settings-rail__item.active')
            ?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
        measure()
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        ro?.observe(el)
        return () => ro?.disconnect()
    }, [pathname, items.length, measure])
    const onWheel = (e) => {
        const el = ref.current
        if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
        if (el.scrollWidth <= el.clientWidth) return
        el.scrollLeft += e.deltaY
    }
    const page = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' })
    return (
        <div className={`settings-rail${edges.left ? ' has-left' : ''}${edges.right ? ' has-right' : ''}`}>
            <button type="button" className="settings-rail__arrow settings-rail__arrow--left" onClick={() => page(-1)} aria-label={t('settings.scrollLeft')} tabIndex={edges.left ? 0 : -1}>
                <LeftOutlined aria-hidden="true" />
            </button>
            <nav className="settings-rail__track" aria-label={label} ref={ref} onScroll={measure} onWheel={onWheel}>
                {items.map((item) => <Tile key={item.key} item={item} compact />)}
            </nav>
            <button type="button" className="settings-rail__arrow settings-rail__arrow--right" onClick={() => page(1)} aria-label={t('settings.scrollRight')} tabIndex={edges.right ? 0 : -1}>
                <RightOutlined aria-hidden="true" />
            </button>
        </div>
    )
}

/** /settings/... — secili sayfa: geri + yatay ikon seridi + icerik. */
function SettingsPage() {
    const t = useT()
    const canAny = useAuthStore((s) => s.canAny)
    useAuthStore((s) => s.permissions) // izin gelince yeniden render
    const { pathname } = useLocation()
    const isHub = pathname.replace(/\/+$/, '') === '/settings'
    if (isHub) return <Outlet />
    const items = visibleSections(canAny).flatMap((s) => s.items)

    return (
        <div className="settings-page">
            <div className="settings-topbar">
                <Link to="/settings" className="settings-back">
                    <LeftOutlined aria-hidden="true" />{t('settings.title')}
                </Link>
                <SettingsRail items={items} label={t('settings.title')} pathname={pathname} />
            </div>
            <div className="settings-content">
                <Outlet />
            </div>
        </div>
    )
}

export default SettingsPage
