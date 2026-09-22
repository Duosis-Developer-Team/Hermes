/**
 * =============================================================================
 * HERMES - Ana sayfa (PM rework P3 / D3–D6)
 * =============================================================================
 * Rol basina sayfa DEGIL, izin basina BLOK (04-roller §3): tek `/` rotasi,
 * her blok kendi iznini ister, izni olmayan blok render edilmez (ve ucu
 * hic cagirmaz). Dashboard (`/dashboard`) detay sayfasi olarak kalir;
 * ana sayfa onun yerine degil ONUNE gecer (§6).
 *
 *   Efor seridi   herkes
 *   Islerim       tasks.access | issues.access | tasks.admin
 *   (P3.2) Takvimim, (P3.3) Ekibim / Organizasyon ozeti
 * =============================================================================
 */
import dayjs from 'dayjs'

import EffortStrip from '../features/home/components/EffortStrip'
import MyWorkBlock from '../features/home/components/MyWorkBlock'
import { useTaskPermissions } from '../hooks/useTaskPermissions'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../i18n'
import './HomePage.css'

function firstNameOf(user) {
    const full = (user?.full_name || '').trim()
    if (full) return full.split(/\s+/)[0]
    return user?.email || ''
}

function HomePage() {
    const t = useT()
    const { user } = useAuthStore()
    const { canAccessAny, isTaskAdmin } = useTaskPermissions()
    const showMyWork = !!user?.is_admin || isTaskAdmin || canAccessAny

    return (
        <div className="home-page h-page">
            <header className="home-page__head">
                <h1 className="home-page__title">{t('home.greeting', { name: firstNameOf(user) })}</h1>
                <span className="home-page__date">{dayjs().format('dddd, DD MMMM YYYY')}</span>
            </header>

            <EffortStrip />
            {showMyWork && <MyWorkBlock />}
        </div>
    )
}

export default HomePage
