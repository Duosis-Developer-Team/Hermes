/**
 * Developer Portal — /developer (Hermes Liquid, iki dilli).
 *
 * Onayli kurallar (D1/D3) aynen gecerli:
 *   - TUM oturum acmis kullanicilar okuyabilir; token/client YONETIMI
 *     API Yonetimi'nde ve yalnizca `api.manage` iznindedir.
 *   - Bu sayfa hicbir mevcut token'i, client secret'ini, hash'i veya
 *     admin logunu GOSTEREMEZ — yalnizca dokumantasyon + kurgusal ornekler.
 *   - Canli katalog verileri /v1/capabilities'ten gelir (drift yok).
 *
 * Anatomi (29.09 yeniden tasarim): Genel bakista buyuk karsilama (hero:
 * ne insa edebilirsin + uc eylem + canli rozetler), diger bolumlerde
 * kompakt baslik. Altinda yapiskan, aranabilir bolum menusu + tek bolum
 * icerigi. Bolum URL hash'iyle senkrondur (#getting-started gibi); eski
 * baglantilar (#api-explorer, #sdks) birlestirilen bolume yonlenir.
 * Metnin tamami sozlukten (devPortal.*); kod ornekleri kod olarak kalir.
 */
import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Input } from 'antd'
import {
    ApiOutlined,
    AppstoreOutlined,
    BookOutlined,
    CodeOutlined,
    FileSearchOutlined,
    HistoryOutlined,
    KeyOutlined,
    OrderedListOutlined,
    ReloadOutlined,
    RobotOutlined,
    RocketOutlined,
    SafetyCertificateOutlined,
    SearchOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from '@ant-design/icons'

import { apiManagementService } from '../../services/api'
import { useAuthStore } from '../../stores/authStore'
import { PageHero } from '../../components/liquid'
import { useT } from '../../i18n'
import DevHero from './DevHero'
import OverviewSection from './sections/OverviewSection'
import GettingStartedSection from './sections/GettingStartedSection'
import AuthenticationSection from './sections/AuthenticationSection'
import ScopesSection from './sections/ScopesSection'
import ApiReferenceSection from './sections/ApiReferenceSection'
import PaginationSection from './sections/PaginationSection'
import IdempotencySection from './sections/IdempotencySection'
import ErrorsSection from './sections/ErrorsSection'
import RateLimitsSection from './sections/RateLimitsSection'
import CodeExamplesSection from './sections/CodeExamplesSection'
import CompatibilityPolicySection from './sections/CompatibilityPolicySection'
import ChangelogSection from './sections/ChangelogSection'
import KnownLimitationsSection from './sections/KnownLimitationsSection'
import McpSection from './sections/McpSection'
import './DeveloperPortalPage.css'

const API_MANAGEMENT_PATH = '/settings/integrations/api'

// `id` sozluk anahtaridir (devPortal.nav.<id>); `kw` teknik terimler —
// dile bagli degil (curl, 429, idempotency-key), aramada her dilde calisir.
const SECTIONS = [
    { key: 'overview', id: 'overview', group: 'start', icon: <AppstoreOutlined />, component: OverviewSection,
        kw: 'overview public api status use cases' },
    { key: 'getting-started', id: 'gettingStarted', group: 'start', icon: <RocketOutlined />, component: GettingStartedSection,
        kw: 'quickstart onboarding first request token curl me setup' },
    { key: 'mcp', id: 'mcp', group: 'start', icon: <RobotOutlined />, component: McpSection,
        kw: 'mcp model context protocol ai agents claude cursor codex tools mcp-remote' },
    { key: 'api-reference', id: 'apiReference', group: 'build', icon: <ApiOutlined />, component: ApiReferenceSection,
        kw: 'endpoints reference swagger openapi explorer tasks work-logs meetings customers projects users groups' },
    { key: 'authentication', id: 'authentication', group: 'build', icon: <SafetyCertificateOutlined />, component: AuthenticationSection,
        kw: 'auth bearer token hms_dev_ hms_live_ rotation revoke 401 user-bound service' },
    { key: 'scopes', id: 'scopes', group: 'build', icon: <KeyOutlined />, component: ScopesSection,
        kw: 'scopes bindings data access global user group customer project 403' },
    { key: 'code-examples', id: 'codeExamples', group: 'build', icon: <CodeOutlined />, component: CodeExamplesSection,
        kw: 'code examples curl python javascript fetch requests snippets' },
    { key: 'pagination', id: 'pagination', group: 'rules', icon: <OrderedListOutlined />, component: PaginationSection,
        kw: 'pagination limit offset has_more filter sort updated_after delta sync' },
    { key: 'idempotency', id: 'idempotency', group: 'rules', icon: <ReloadOutlined />, component: IdempotencySection,
        kw: 'idempotency idempotency-key retry duplicate replay 409' },
    { key: 'errors', id: 'errors', group: 'rules', icon: <WarningOutlined />, component: ErrorsSection,
        kw: 'errors envelope request_id 404 422 validation_error' },
    { key: 'rate-limits', id: 'rateLimits', group: 'rules', icon: <ThunderboltOutlined />, component: RateLimitsSection,
        kw: 'rate limits 429 retry-after x-ratelimit backoff' },
    { key: 'compatibility', id: 'compatibility', group: 'info', icon: <BookOutlined />, component: CompatibilityPolicySection,
        kw: 'compatibility deprecation versioning v2 breaking sdk sdks generator' },
    { key: 'changelog', id: 'changelog', group: 'info', icon: <HistoryOutlined />, component: ChangelogSection,
        kw: 'changelog releases versions v1.2.0 v1.1.0 v1.0.0' },
    { key: 'limitations', id: 'limitations', group: 'info', icon: <FileSearchOutlined />, component: KnownLimitationsSection,
        kw: 'known limitations oauth email rate limiter work_type_id retention' },
]

const GROUPS = ['start', 'build', 'rules', 'info']

// Birlestirilen eski bolumler: paylasilmis baglantilar kirilmasin.
const ALIASES = { 'api-explorer': 'api-reference', sdks: 'compatibility' }

function DeveloperPortalPage() {
    const t = useT()
    // RBAC R3: API Yonetimi kisayolu api.manage iznine bakar
    const can = useAuthStore((s) => s.can)
    useAuthStore((s) => s.permissions)
    const canManageApi = can('api.manage')
    const location = useLocation()
    const navigate = useNavigate()
    const [query, setQuery] = useState('')
    const pageRef = useRef(null)

    const rawHash = (location.hash || '').replace('#', '')
    const hashKey = ALIASES[rawHash] || rawHash
    const active = useMemo(
        () => SECTIONS.find((s) => s.key === hashKey) || SECTIONS[0],
        [hashKey],
    )

    const goTo = (key) => {
        navigate(`/developer#${key}`)
        // Kayan kap .main-content'tir (window degil): icerik basina don.
        const scroller = pageRef.current?.closest('.main-content')
        scroller?.scrollTo?.({ top: 0, behavior: 'smooth' })
    }
    const openApiManagement = () => navigate(API_MANAGEMENT_PATH)

    const { data: capabilities } = useQuery({
        queryKey: ['public-capabilities'],
        queryFn: () => apiManagementService.getPublicCapabilities(),
        staleTime: 10 * 60 * 1000,
    })
    const { data: specInfo } = useQuery({
        queryKey: ['public-openapi-info'],
        queryFn: () => apiManagementService.getPublicOpenApiInfo(),
        staleTime: 10 * 60 * 1000,
    })
    const { data: health } = useQuery({
        queryKey: ['public-health'],
        queryFn: () => apiManagementService.getPublicHealth(),
        staleTime: 60 * 1000,
        retry: 1,
    })

    const q = query.trim().toLowerCase()
    const matches = (s) => !q || [
        t(`devPortal.nav.${s.id}`), t(`devPortal.navHint.${s.id}`), s.kw, s.key,
    ].join(' ').toLowerCase().includes(q)
    const visible = SECTIONS.filter(matches)

    const Active = active.component
    const version = capabilities?.api_version || 'v1'
    const apiOk = health?.status === 'ok'
    const sectionProps = {
        capabilities, canManageApi, goTo, health, specInfo, openApiManagement,
    }

    return (
        <div className="dp-page" ref={pageRef}>
            {active.key === 'overview' ? (
                <DevHero {...sectionProps} />
            ) : (
                <PageHero
                    className="dp-mini-hero"
                    title={t('devPortal.hero.pageTitle')}
                    subtitle={t('devPortal.hero.pageSubtitle', { version })}
                    actions={(
                        <>
                            <span className={`lq-tag ${apiOk ? 'lq-tag--ok' : ''}`}>
                                <i className={`dp-dot${apiOk ? ' is-ok' : ''}`} aria-hidden="true" />
                                {apiOk ? t('devPortal.common.operational') : t('devPortal.common.checking')}
                            </span>
                            {specInfo?.version && (
                                <span className="lq-tag lq-tag--info">OpenAPI {specInfo.version}</span>
                            )}
                            <a className="lq-chip" href="/api/public/v1/docs" target="_blank" rel="noreferrer">
                                <ApiOutlined /> {t('devPortal.common.swagger')}
                            </a>
                        </>
                    )}
                />
            )}

            <div className="dp-layout">
                <nav className="dp-nav lq-card" aria-label={t('devPortal.nav.aria')}>
                    <Input
                        allowClear
                        className="dp-nav__search"
                        prefix={<SearchOutlined />}
                        placeholder={t('devPortal.nav.search')}
                        aria-label={t('devPortal.nav.searchAria')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="dp-nav__list">
                        {GROUPS.map((g) => {
                            const items = visible.filter((s) => s.group === g)
                            if (!items.length) return null
                            return (
                                <div key={g} className="dp-nav__group">
                                    <span className="dp-nav__label">{t(`devPortal.navGroup.${g}`)}</span>
                                    {items.map((s) => (
                                        <button
                                            key={s.key}
                                            type="button"
                                            className={`dp-nav__item${s.key === active.key ? ' is-active' : ''}`}
                                            aria-current={s.key === active.key ? 'page' : undefined}
                                            onClick={() => goTo(s.key)}
                                        >
                                            {s.icon}
                                            <span>{t(`devPortal.nav.${s.id}`)}</span>
                                        </button>
                                    ))}
                                </div>
                            )
                        })}
                        {q && visible.length === 0 && (
                            <div className="dp-nav__empty" role="status">
                                {t('devPortal.nav.noMatch', { query })}
                            </div>
                        )}
                    </div>
                </nav>

                <article className="dp-content lq-enter" key={active.key} aria-label={t(`devPortal.nav.${active.id}`)}>
                    <Active {...sectionProps} />
                </article>
            </div>
        </div>
    )
}

export default DeveloperPortalPage
