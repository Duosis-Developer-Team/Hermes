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
 * Yerlesim (Hermes Liquid prototipi, 28.09): 12 kolonlu bento — efor (8) +
 * dikkat (4), islerim (7) + takvim (5), ekibim (7) + organizasyon (5); bir
 * satirdaki kartlar ayni yukseklikte. Dar ekranda tek sutun.
 *
 * Denge (CTO 29.09): satir yuksekligini listeler BELIRLEMEZ — her satirin
 * sabit bir alt siniri var, uzun listeler kendi kartinda kayar (.home-fill).
 * Satirda tek kart kalirsa (izin yok / ekip uygun degil) tam genislige
 * yayilir; yaninda bos kolon kalmaz. Ekip uygunlugu icin ayni sorgu
 * (react-query onbellegi — ikinci istek yok).
 *
 * Hermes Liquid (R3, 28.09): baslik = Hermes isaretli karsilama alani +
 * hizli gecisler (yalniz mevcut rotalara BAGLANTI — yeni akis yok).
 * =============================================================================
 */
import dayjs from 'dayjs'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CalendarOutlined, CheckSquareOutlined, ClockCircleOutlined } from '@ant-design/icons'

import EffortStrip from '../features/home/components/EffortStrip'
import FocusBlock from '../features/home/components/FocusBlock'
import MyWorkBlock from '../features/home/components/MyWorkBlock'
import OrgBlock from '../features/home/components/OrgBlock'
import TeamBlock from '../features/home/components/TeamBlock'
import WeekBlock from '../features/home/components/WeekBlock'
import { useTaskPermissions } from '../hooks/useTaskPermissions'
import { homeService } from '../services/api'
import { queryKeys } from '../query/queryKeys'
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
    const tenantName = useAuthStore((s) => s.tenant?.display_name)
    const { data: team } = useQuery({ queryKey: queryKeys.home.team, queryFn: () => homeService.team() })
    const showTeam = team?.eligible === true

    return (
        <div className="home-page">
            <header className="home-page__head home-hero">
                <span className="home-hero__mark" aria-hidden="true"><i /></span>
                <div className="home-hero__text">
                    <div className="home-hero__eyebrow">
                        <span>Hermes</span>
                        {tenantName && <span className="home-hero__tenant">{tenantName} · {t('home.workspace')}</span>}
                    </div>
                    <h1 className="home-page__title">{t('home.greeting', { name: firstNameOf(user) })}</h1>
                    <span className="home-page__date">{dayjs().format('dddd, DD MMMM YYYY')}</span>
                </div>
                <nav className="home-hero__actions" aria-label={t('nav.home')}>
                    <Link to="/meetings" className="home-hero__action"><CalendarOutlined aria-hidden="true" />{t('home.quickMeetings')}</Link>
                    {showMyWork && (
                        <Link to="/project-management" className="home-hero__action"><CheckSquareOutlined aria-hidden="true" />{t('home.quickWork')}</Link>
                    )}
                    <Link to="/time-entry" className="home-hero__action home-hero__action--primary"><ClockCircleOutlined aria-hidden="true" />{t('home.quickLog')}</Link>
                </nav>
            </header>

            {/* Hermes Liquid bento (prototip): efor + dikkat, islerim +
                takvim, ekibim + organizasyon; kartlar kademeli yukselir. */}
            <div className="lq-bento lq-enter home-bento">
                <div className="lq-c8 home-slot home-slot--effort"><EffortStrip /></div>
                <div className="lq-c4 home-slot home-slot--focus"><FocusBlock showMyWork={showMyWork} /></div>
                {showMyWork && <div className="lq-c7 home-slot home-slot--work home-row-mid"><MyWorkBlock /></div>}
                <div className={`${showMyWork ? 'lq-c5' : 'lq-c12'} home-slot home-slot--week home-row-mid`}><WeekBlock /></div>
                <div className={`${showOrg ? 'lq-c7' : 'lq-c12'} home-slot home-slot--team home-row-low`}><TeamBlock /></div>
                {showOrg && <div className={`${showTeam ? 'lq-c5' : 'lq-c12'} home-slot home-slot--org home-row-low`}><OrgBlock /></div>}
            </div>
        </div>
    )
}

export default HomePage
