/**
 * =============================================================================
 * HERMES - Ayarlar kabugu (PM rework P0 / B1)
 * =============================================================================
 * Tek /settings rotasi: solda bolumler (izne gore), sagda secili sayfa.
 * Sayfalarin ICERIGI degismedi — yalnizca evleri degisti (B1 kapsam disi:
 * ayar iceriklerini degistirmek). Proje duzeyindeki ayarlar (uyeler,
 * yonlendirme) BURAYA GELMEZ; projenin kendi sayfasinda yasar (B2).
 * =============================================================================
 */
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { Spin } from 'antd'

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

function SettingsPage() {
    const t = useT()
    const canAny = useAuthStore((s) => s.canAny)
    useAuthStore((s) => s.permissions) // izin gelince yeniden render
    const sections = visibleSections(canAny)

    return (
        <div className="settings-page">
            <header className="settings-head">
                <h1>{t('settings.title')}</h1>
                <p>{t('settings.subtitle')}</p>
            </header>
            <div className="settings-body">
                <nav className="settings-nav" aria-label={t('settings.title')}>
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
                                    {t(item.labelKey)}
                                </NavLink>
                            ))}
                        </div>
                    ))}
                </nav>
                <section className="settings-content">
                    <Outlet />
                </section>
            </div>
        </div>
    )
}

export default SettingsPage
