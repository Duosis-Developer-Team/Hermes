/**
 * =============================================================================
 * HERMES - Ana sayfa (PM rework P3 / D3–D6)
 * =============================================================================
 * Rol basina sayfa DEGIL, izin basina BLOK (04-roller §3): tek `/` rotasi,
 * her blok kendi iznini ister, izni olmayan blok render edilmez (ve ucu
 * hic cagirmaz). Dashboard (`/dashboard`) detay sayfasi olarak kalir;
 * ana sayfa onun yerine degil ONUNE gecer (§6).
 *
 *   Efor seridi   herkes — en ustte, tam genislik
 *   Islerim       tasks.access | issues.access | tasks.admin — ana sutun
 *   Takvimim      herkes — sag kolon (ajanda)
 *   Ekibim        tasks.assign ∨ proje lideri ∨ tasks.admin (sunucu karar verir)
 *   Organizasyon  reports.view
 *
 * Yerlesim (CTO 23.09): iki sutun, bloklar icerik yuksekliginde alt alta
 * yigilir — esit yukseklige gerilen bos kart YOK. Dar ekranda tek sutun,
 * sira: efor · islerim · takvim · ekibim · organizasyon.
 * =============================================================================
 */
import dayjs from 'dayjs'

import EffortStrip from '../features/home/components/EffortStrip'
import MyWorkBlock from '../features/home/components/MyWorkBlock'
import OrgBlock from '../features/home/components/OrgBlock'
import TeamBlock from '../features/home/components/TeamBlock'
import WeekBlock from '../features/home/components/WeekBlock'
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
    const can = useAuthStore((s) => s.can)
    useAuthStore((s) => s.permissions) // izinler cozulunce yeniden ciz
    const { canAccessAny, isTaskAdmin } = useTaskPermissions()
    const showMyWork = !!user?.is_admin || isTaskAdmin || canAccessAny
    // Ekibim: liderlik istemcide bilinmez → uc hep cagrilir, sunucu
    // eligible=false derse blok cizilmez. Organizasyon: reports.view.
    const showOrg = can('reports.view')

    return (
        <div className="home-page">
            <header className="home-page__head">
                <h1 className="home-page__title">{t('home.greeting', { name: firstNameOf(user) })}</h1>
                <span className="home-page__date">{dayjs().format('dddd, DD MMMM YYYY')}</span>
            </header>

            <EffortStrip />

            <div className="home-layout">
                <div className="home-col home-col--main">
                    {showMyWork && <div className="home-slot home-slot--work"><MyWorkBlock /></div>}
                    <div className="home-slot home-slot--team"><TeamBlock /></div>
                </div>
                <div className="home-col home-col--rail">
                    <div className="home-slot home-slot--week"><WeekBlock /></div>
                    {showOrg && <div className="home-slot home-slot--org"><OrgBlock /></div>}
                </div>
            </div>
        </div>
    )
}

export default HomePage
