/**
 * =============================================================================
 * HERMES - Ayarlar kabugu (PM rework P0 / B1)
 * =============================================================================
 * Tek /settings rotasi: solda bolumler (izne gore), sagda secili sayfa.
 * Sayfalarin ICERIGI degismedi — yalnizca evleri degisti (B1 kapsam disi:
 * ayar iceriklerini degistirmek). Hermes Liquid: sol menu cam kart (arama +
 * 16px ikonlu satirlar, aktif = koyu hap), icerik cam kart; icerik
 * sayfalarinin baslik/sekme dili kapsamli CSS ile (SettingsPage.css). Proje duzeyindeki ayarlar (uyeler,
 * yonlendirme) BURAYA GELMEZ; projenin kendi sayfasinda yasar (B2).
 * =============================================================================
 */
import { useState } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { Input, Spin } from 'antd'
import {
    ApiOutlined, AppstoreOutlined, BarChartOutlined, BranchesOutlined,
    CustomerServiceOutlined, DatabaseOutlined, FolderOutlined, SearchOutlined,
    SettingOutlined, ShopOutlined, TagsOutlined, TeamOutlined,
} from '@ant-design/icons'

import { GlassCard, PageHero } from '../../components/liquid'

import { firstSettingsPath, visibleSections } from '../../features/settings/sections'
import { loaderByPath } from '../../routes/loaders'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'
import './SettingsPage.css'

/** /settings — ilk gorunur sayfaya gider; hicbiri yoksa ana ekrana. */
export function SettingsIndex() {
    const permissions = useAuthStore((s) => s.permissions)
    const canAny = useAuthStore((s) => s.canAny)
    // Izinler henuz yuklenmediyse yonlendirme YAPILMAZ (ProtectedRoute ile
    // ayni fail-closed kural): yanlis yere gitmektense beklemek dogru.
    if (permissions === null) {
        return <div className="settings-loading"><Spin /></div>
    }
    return <Navigate to={firstSettingsPath(canAny) || '/time-entry'} replace />
}

// Menu ikonlari (gorsel ipucu; erisilebilir ad baglanti metnidir).
const ITEM_ICONS = {
    users: <TeamOutlined />,
    capacity: <BarChartOutlined />,
    pm: <SettingOutlined />,
    'work-types': <TagsOutlined />,
    'activity-types': <AppstoreOutlined />,
    platforms: <DatabaseOutlined />,
    'work-lines': <BranchesOutlined />,
    customers: <ShopOutlined />,
    projects: <FolderOutlined />,
    api: <ApiOutlined />,
    tickets: <CustomerServiceOutlined />,
}

function SettingsPage() {
    const t = useT()
    const canAny = useAuthStore((s) => s.canAny)
    useAuthStore((s) => s.permissions) // izin gelince yeniden render
    const [query, setQuery] = useState('')
    const q = query.trim().toLocaleLowerCase()
    // Arama yalniz GORUNUR (izinli) ogeler icinde suzer.
    const sections = visibleSections(canAny)
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => !q || t(item.labelKey).toLocaleLowerCase().includes(q)),
        }))
        .filter((section) => section.items.length > 0)

    return (
        <div className="settings-page">
            <PageHero title={t('settings.title')} subtitle={t('settings.subtitle')} />
            <div className="settings-body">
                <GlassCard as="nav" className="settings-nav" aria-label={t('settings.title')}>
                    <Input
                        allowClear
                        className="settings-search"
                        prefix={<SearchOutlined />}
                        placeholder={t('settings.searchPlaceholder')}
                        aria-label={t('settings.searchPlaceholder')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    {sections.map((section) => (
                        <div key={section.key} className="settings-section">
                            <div className="settings-section-label">{t(section.labelKey)}</div>
                            {section.items.map((item) => (
                                <NavLink
                                    key={item.key}
                                    to={item.path}
                                    className={({ isActive }) =>
                                        `settings-link${isActive ? ' active' : ''}`}
                                    /* Hover'da rota chunk'i isitilir — kenar
                                       cubugundaki prefetch ile ayni harita. */
                                    onMouseEnter={() => loaderByPath[item.path]?.()}
                                >
                                    <span className="settings-link__icon" aria-hidden="true">{ITEM_ICONS[item.key]}</span>
                                    {t(item.labelKey)}
                                </NavLink>
                            ))}
                        </div>
                    ))}
                </GlassCard>
                <GlassCard className="settings-content">
                    <Outlet />
                </GlassCard>
            </div>
        </div>
    )
}

export default SettingsPage
