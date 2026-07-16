/**
 * Developer Portal (Stage 4A) — /developer
 *
 * Onayli kurallar (D1/D3):
 *   - TUM oturum acmis kullanicilar okuyabilir; token/client YONETIMI
 *     API Management'ta ve yalnizca admin'dedir.
 *   - Bu sayfa hicbir mevcut token'i, client secret'ini, hash'i veya
 *     admin logunu GOSTEREMEZ — yalnizca dokumantasyon + kurgusal
 *     ornekler.
 *   - Canli katalog verileri /v1/capabilities'ten gelir (drift yok).
 *
 * Bolum navigasyonu URL hash'iyle senkrondur (#getting-started gibi) —
 * derin link verilebilir. 4B/4C bolumleri ayni kayit listesine eklenir.
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
    CompassOutlined,
    ControlOutlined,
    KeyOutlined,
    OrderedListOutlined,
    ReadOutlined,
    ReloadOutlined,
    RocketOutlined,
    SafetyCertificateOutlined,
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
import './DeveloperPortalPage.css'

const SECTIONS = [
    {
        key: 'overview',
        label: 'Overview',
        icon: <ReadOutlined />,
        component: OverviewSection,
    },
    {
        key: 'getting-started',
        label: 'Getting Started',
        icon: <RocketOutlined />,
        component: GettingStartedSection,
    },
    {
        key: 'authentication',
        label: 'Authentication',
        icon: <SafetyCertificateOutlined />,
        component: AuthenticationSection,
    },
    {
        key: 'api-explorer',
        label: 'API Explorer',
        icon: <CompassOutlined />,
        component: ApiExplorerSection,
    },
    {
        key: 'scopes',
        label: 'Scopes & Data Access',
        icon: <KeyOutlined />,
        component: ScopesSection,
    },
    {
        key: 'api-reference',
        label: 'API Reference',
        icon: <ControlOutlined />,
        component: ApiReferenceSection,
    },
    {
        key: 'pagination',
        label: 'Pagination & Filtering',
        icon: <OrderedListOutlined />,
        component: PaginationSection,
    },
    {
        key: 'idempotency',
        label: 'Idempotency',
        icon: <ReloadOutlined />,
        component: IdempotencySection,
    },
    {
        key: 'errors',
        label: 'Errors',
        icon: <WarningOutlined />,
        component: ErrorsSection,
    },
    {
        key: 'rate-limits',
        label: 'Rate Limits',
        icon: <ThunderboltOutlined />,
        component: RateLimitsSection,
    },
]

function DeveloperPortalPage() {
    const { user } = useAuthStore()
    const isAdmin = user?.is_admin === true
    const location = useLocation()
    const navigate = useNavigate()

    const hashKey = (location.hash || '').replace('#', '')
    const active = useMemo(
        () => SECTIONS.find((s) => s.key === hashKey) || SECTIONS[0],
        [hashKey]
    )
    const [, setRendered] = useState(active.key)
    useEffect(() => setRendered(active.key), [active.key])

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

    const Active = active.component

    return (
        <div className="dp-page">
            <div className="dp-header">
                <div>
                    <h1>Developer Portal</h1>
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
                    {SECTIONS.map((s) => (
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
                    <div className="dp-nav-soon">
                        Code Examples, Changelog, Known Limitations and the
                        MCP section arrive with the next portal update.
                    </div>
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
