/**
 * Developer Portal — Overview (Stage 4A).
 * Canli veriler /v1/capabilities'ten gelir (drift yok).
 */
import { Tag } from 'antd'
import {
    ApiOutlined,
    FileTextOutlined,
    SafetyCertificateOutlined,
    ThunderboltOutlined,
} from '@ant-design/icons'

function StatusDot({ ok }) {
    return (
        <span
            className={`dp-status-dot ${ok ? 'is-ok' : 'is-unknown'}`}
            aria-hidden="true"
        />
    )
}

function OverviewSection({ capabilities, goTo, health, specInfo }) {
    const version = capabilities?.api_version || 'v1'
    // Canli durum: Public API health'ten, Swagger/OpenAPI spec info'nun
    // yuklenebilmis olmasindan; portal zaten goruntuleniyor.
    const apiOk = health?.status === 'ok'
    const specOk = Boolean(specInfo?.version)
    return (
        <div className="dp-section">
            <h2>Hermes Public API</h2>
            <p className="dp-lead">
                The Hermes Public API lets external systems and AI agents work
                with tasks, projects, customers, work logs and meetings in a
                secure, versioned way. Everything lives under{' '}
                <code>/api/public/{version}</code> and authenticates with
                scoped API tokens — never with your Hermes login session.
            </p>

            {/* Onayli UX istegi: 1 dakikalik quick start — detayli
                Getting Started'in YERINE degil, yanina. */}
            <div className="dp-quickstart">
                <div className="dp-quickstart-head">
                    <span className="dp-quickstart-title">
                        1-Minute Quick Start
                    </span>
                    <button
                        type="button"
                        className="dp-inline-link"
                        onClick={() => goTo('getting-started')}
                    >
                        Full guide →
                    </button>
                </div>
                <ol className="dp-quickstart-flow">
                    <li>Obtain a user-bound API client</li>
                    <li>Generate a token</li>
                    <li>
                        Call <code>GET /v1/me</code>
                    </li>
                    <li>
                        Call <code>GET /v1/tasks</code>
                    </li>
                    <li className="is-done">Integration complete</li>
                </ol>
            </div>

            {/* API Status karti (onayli Stage 4 final polish) — canli
                /v1/health + openapi info'dan beslenir. */}
            <div className="dp-status" role="status">
                <span className="dp-status-title">
                    API Status:{' '}
                    <b className={apiOk ? 'is-ok-text' : ''}>
                        {apiOk ? 'Operational' : 'Checking…'}
                    </b>
                </span>
                <span className="dp-status-item">
                    <StatusDot ok={apiOk} /> Public API
                </span>
                <span className="dp-status-item">
                    <StatusDot ok /> Developer Portal
                </span>
                <span className="dp-status-item">
                    <StatusDot ok={specOk} /> Swagger / OpenAPI
                </span>
            </div>

            <div className="dp-cards">
                <button
                    type="button"
                    className="dp-card"
                    onClick={() => goTo('getting-started')}
                >
                    <ThunderboltOutlined className="dp-card-icon" />
                    <span className="dp-card-title">Getting Started</span>
                    <span className="dp-card-sub">
                        From zero to your first successful API call in five
                        steps.
                    </span>
                </button>
                <button
                    type="button"
                    className="dp-card"
                    onClick={() => goTo('authentication')}
                >
                    <SafetyCertificateOutlined className="dp-card-icon" />
                    <span className="dp-card-title">Authentication</span>
                    <span className="dp-card-sub">
                        Bearer tokens, environments, rotation and client
                        types.
                    </span>
                </button>
                <a
                    className="dp-card"
                    href="/api/public/v1/docs"
                    target="_blank"
                    rel="noreferrer"
                >
                    <ApiOutlined className="dp-card-icon" />
                    <span className="dp-card-title">
                        Interactive API Reference
                    </span>
                    <span className="dp-card-sub">
                        Swagger UI with every endpoint, schema and scope.
                    </span>
                </a>
                <a
                    className="dp-card"
                    href="/api/public/v1/openapi.json"
                    target="_blank"
                    rel="noreferrer"
                >
                    <FileTextOutlined className="dp-card-icon" />
                    <span className="dp-card-title">OpenAPI Schema</span>
                    <span className="dp-card-sub">
                        Machine-readable spec for client generation.
                    </span>
                </a>
            </div>

            <h3>At a glance</h3>
            <ul className="dp-list">
                <li>
                    <b>Versioned</b> — all endpoints live under{' '}
                    <code>/{version}</code>; breaking changes only ship in a
                    new version prefix.
                </li>
                <li>
                    <b>Two authorization layers</b> — <i>scopes</i> say which
                    operations a token may call; <i>data-access bindings</i>{' '}
                    say which records it can see. Both always apply.
                </li>
                <li>
                    <b>One error envelope</b> —{' '}
                    <code>
                        {'{'}"error": {'{'}"code", "message", "request_id"
                        {'}'}{'}'}
                    </code>{' '}
                    on every failure.
                </li>
                <li>
                    <b>Safe retries</b> — every POST accepts an optional{' '}
                    <code>Idempotency-Key</code> header (24-hour replay
                    window).
                </li>
                <li>
                    <b>Rate limited</b> — per-token limits with{' '}
                    <code>X-RateLimit-*</code> response headers.
                </li>
                <li>
                    <b>Writes are user-bound</b> — service clients are
                    read-only in {version}; write operations always act as the
                    bound Hermes user under that user's permissions.
                </li>
            </ul>

            <div className="dp-note">
                <Tag color="purple">Coming later</Tag>
                <span>
                    A Hermes <b>MCP server</b> will let AI tools (Claude,
                    IDE agents and others) talk to Hermes natively. It will
                    reuse exactly this API's token, scope and data-access
                    model — nothing you build against the Public API is
                    throwaway.
                </span>
            </div>
        </div>
    )
}

export default OverviewSection
