/**
 * Developer Portal (Stage 4A-4C) — /developer
 *
 * Onayli kurallar (D1/D3):
 *   - TUM oturum acmis kullanicilar okuyabilir; token/client YONETIMI
 *     API Management'ta ve yalnizca admin'dedir.
 *   - Bu sayfa hicbir mevcut token'i, client secret'ini, hash'i veya
 *     admin logunu GOSTEREMEZ — yalnizca dokumantasyon + kurgusal
 *     ornekler.
 *   - Canli katalog verileri /v1/capabilities'ten gelir (drift yok).
 *
 * 4C: client-side bolum aramasi (backend'siz), header'da Public API /
 * OpenAPI surum rozeti, Changelog / Known Limitations / MCP bolumleri.
 * Bolum navigasyonu URL hash'iyle senkrondur (#getting-started gibi).
 */
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Input } from 'antd'
import {
    CompassOutlined,
    ControlOutlined,
    HistoryOutlined,
    KeyOutlined,
    OrderedListOutlined,
    ReadOutlined,
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
import OverviewSection from './sections/OverviewSection'
import GettingStartedSection from './sections/GettingStartedSection'
import AuthenticationSection from './sections/AuthenticationSection'
import ApiExplorerSection from './sections/ApiExplorerSection'
import ScopesSection from './sections/ScopesSection'
import ApiReferenceSection from './sections/ApiReferenceSection'
import PaginationSection from './sections/PaginationSection'
import IdempotencySection from './sections/IdempotencySection'
import ErrorsSection from './sections/ErrorsSection'
import RateLimitsSection from './sections/RateLimitsSection'
import CodeExamplesSection from './sections/CodeExamplesSection'
import ChangelogSection from './sections/ChangelogSection'
import KnownLimitationsSection from './sections/KnownLimitationsSection'
import McpSection from './sections/McpSection'
import './DeveloperPortalPage.css'

// keywords: client-side arama icin (4C-1). Bolum basligiyla birlikte
// aranir; backend aramasi bilinclice YOK.
const SECTIONS = [
    {
        key: 'overview',
        label: 'Overview',
        icon: <ReadOutlined />,
        component: OverviewSection,
        keywords: 'public api overview quick start introduction basics',
    },
    {
        key: 'getting-started',
        label: 'Getting Started',
        icon: <RocketOutlined />,
        component: GettingStartedSection,
        keywords:
            'onboarding first request token curl me tutorial setup start',
    },
    {
        key: 'authentication',
        label: 'Authentication',
        icon: <SafetyCertificateOutlined />,
        component: AuthenticationSection,
        keywords:
            'auth bearer token rotation revoke expiry client types ' +
            'user-bound service security 401',
    },
    {
        key: 'api-explorer',
        label: 'API Explorer',
        icon: <CompassOutlined />,
        component: ApiExplorerSection,
        keywords: 'swagger openapi download spec postman import generator',
    },
    {
        key: 'scopes',
        label: 'Scopes & Data Access',
        icon: <KeyOutlined />,
        component: ScopesSection,
        keywords:
            'scopes permissions bindings data access visibility reserved ' +
            'global user group customer project 403',
    },
    {
        key: 'api-reference',
        label: 'API Reference',
        icon: <ControlOutlined />,
        component: ApiReferenceSection,
        keywords:
            'endpoints reference tasks issues suggestions customers ' +
            'projects work logs meetings comments activity status complete',
    },
    {
        key: 'pagination',
        label: 'Pagination & Filtering',
        icon: <OrderedListOutlined />,
        component: PaginationSection,
        keywords:
            'pagination filtering sorting limit offset has_more page ' +
            'delta sync updated_after query',
    },
    {
        key: 'idempotency',
        label: 'Idempotency',
        icon: <ReloadOutlined />,
        component: IdempotencySection,
        keywords: 'idempotency retry duplicate idempotency-key replay 409',
    },
    {
        key: 'errors',
        label: 'Errors',
        icon: <WarningOutlined />,
        component: ErrorsSection,
        keywords:
            'errors error codes envelope request_id 404 422 not found ' +
            'validation troubleshooting',
    },
    {
        key: 'rate-limits',
        label: 'Rate Limits',
        icon: <ThunderboltOutlined />,
        component: RateLimitsSection,
        keywords: 'rate limits throttle 429 retry-after backoff headers',
    },
    {
        key: 'code-examples',
        label: 'Code Examples',
        icon: <ControlOutlined />,
        component: CodeExamplesSection,
        keywords:
            'code examples curl python javascript snippets sample sdk ' +
            'requests fetch',
    },
    {
        key: 'changelog',
        label: 'Changelog',
        icon: <HistoryOutlined />,
        component: ChangelogSection,
        keywords: 'changelog versions releases updates history v1',
    },
    {
        key: 'limitations',
        label: 'Known Limitations',
        icon: <WarningOutlined />,
        component: KnownLimitationsSection,
        keywords:
            'known limitations email delivery reserved work_type_id ' +
            'retention caveats',
    },
    {
        key: 'mcp',
        label: 'MCP Preparation',
        icon: <RobotOutlined />,
        component: McpSection,
        keywords:
            'mcp model context protocol ai agents claude assistants tools',
    },
]

function DeveloperPortalPage() {
    const { user } = useAuthStore()
    const isAdmin = user?.is_admin === true
    const location = useLocation()
    const navigate = useNavigate()
    const [query, setQuery] = useState('')

    const hashKey = (location.hash || '').replace('#', '')
    const active = useMemo(
        () => SECTIONS.find((s) => s.key === hashKey) || SECTIONS[0],
        [hashKey]
    )

    const goTo = (key) => {
        navigate(`/developer#${key}`, { replace: false })
        // Bolum degisince icerik basina don (mobil icin onemli).
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

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

    const q = query.trim().toLowerCase()
    const visibleSections = q
        ? SECTIONS.filter((s) =>
              `${s.label} ${s.keywords}`.toLowerCase().includes(q)
          )
        : SECTIONS

    const Active = active.component

    return (
        <div className="dp-page">
            <div className="dp-header">
                <div>
                    <h1>
                        Developer Portal{' '}
                        <span className="dp-version">
                            Public API{' '}
                            {capabilities?.api_version || 'v1'}
                            {specInfo?.version
                                ? ` · OpenAPI ${specInfo.version}`
                                : ''}{' '}
                            · live-generated spec
                        </span>
                    </h1>
                    <p>
                        Build against the Hermes Public API — guided
                        onboarding, authentication, and conventions. Raw
                        reference:{' '}
                        <a
                            href="/api/public/v1/docs"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Swagger UI
                        </a>{' '}
                        ·{' '}
                        <a
                            href="/api/public/v1/openapi.json"
                            target="_blank"
                            rel="noreferrer"
                        >
                            OpenAPI
                        </a>
                    </p>
                </div>
            </div>

            <div className="dp-body">
                <nav className="dp-nav" aria-label="Documentation sections">
                    <Input
                        allowClear
                        size="small"
                        className="dp-search"
                        prefix={<SearchOutlined />}
                        placeholder="Search docs…"
                        aria-label="Search documentation sections"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    {visibleSections.map((s) => (
                        <button
                            key={s.key}
                            type="button"
                            className={
                                'dp-nav-item' +
                                (s.key === active.key ? ' is-active' : '')
                            }
                            onClick={() => goTo(s.key)}
                        >
                            {s.icon}
                            <span>{s.label}</span>
                        </button>
                    ))}
                    {q && visibleSections.length === 0 && (
                        <div className="dp-nav-empty" role="status">
                            No sections match “{query}”.
                        </div>
                    )}
                </nav>

                <main className="dp-content">
                    <Active
                        capabilities={capabilities}
                        isAdmin={isAdmin}
                        goTo={goTo}
                    />
                </main>
            </div>
        </div>
    )
}

export default DeveloperPortalPage
