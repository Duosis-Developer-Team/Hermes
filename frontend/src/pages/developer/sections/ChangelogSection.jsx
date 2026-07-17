/**
 * Developer Portal — Changelog (Stage 4C).
 *
 * Veri-odakli: yeni surum = CHANGELOG dizisinin BASINA bir kayit eklemek.
 * Girdi bicimi: { version, date, title?, entries: [string | {tag, text}] }.
 * Kod degisikligi gerektirmez, PR'da icerik olarak review edilir.
 */
import { Tag } from 'antd'

const CHANGELOG = [
    {
        version: 'v1.2.0',
        date: 'July 2026',
        title: 'Group assignment',
        entries: [
            {
                tag: 'API',
                text:
                    'New POST /v1/task-groups — assign to every active ' +
                    'member of a user group in one call (one work item per ' +
                    'member, sharing one assignment_batch_id), matching the ' +
                    'group assignment already available in the Hermes web ' +
                    'app. Recipients are derived from the group; member ' +
                    'lists are never sent or returned. Members without ' +
                    'access are skipped and the bound user is never ' +
                    'included, so created_count may be lower than the ' +
                    "group's member count — skipped_count reports the " +
                    'difference. Additive: POST /v1/tasks is unchanged and ' +
                    'remains the single-assignee endpoint.',
            },
            {
                tag: 'MCP',
                text:
                    'New hermes_create_task_for_group tool covering the ' +
                    'same surface, so AI clients reach feature parity with ' +
                    'the web app for group assignment. Write rules are ' +
                    'unchanged: user-bound clients only, human approval ' +
                    'annotation, optional idempotency key.',
            },
            {
                tag: 'MCP',
                text:
                    'MCP status promoted from internal beta to ACTIVE. The ' +
                    'service is live and reuses the Public API token, scope, ' +
                    'binding, audit and rate-limit model unchanged. ' +
                    'Bearer-token integrations are verified with Claude ' +
                    'Code, Cursor and Codex. A native OAuth connector is ' +
                    'still not available and remains documented as such — ' +
                    'the missing authorization server limits that one ' +
                    'connection path, not the service.',
            },
            {
                tag: 'Fix',
                text:
                    'Directory endpoints (/v1/users, /v1/groups) returned ' +
                    'internal_error in every deployment: the auth-service ' +
                    'base URL was built without stripping the configured ' +
                    '/api/v1 suffix, so the internal directory route ' +
                    'answered 404. URL derivation now lives in one shared ' +
                    'normaliser and is locked by a regression test.',
            },
            {
                tag: 'Docs',
                text:
                    'Developer Portal refreshed against the live product: ' +
                    'MCP status card, per-client compatibility matrix backed ' +
                    'by real test evidence, full MCP setup/limits/audit ' +
                    'guidance, and the group assignment endpoint and tool ' +
                    'documented across API Reference and MCP sections.',
            },
        ],
    },
    {
        version: 'v1.1.0',
        date: 'July 2026',
        title: 'Directory & MCP read foundation',
        entries: [
            {
                tag: 'API',
                text:
                    'users:read and groups:read activated — GET /v1/users, ' +
                    '/v1/users/{id}, /v1/groups, /v1/groups/{id} with ' +
                    'least-privilege directory visibility (non-global ' +
                    'tokens resolve only identities present in records ' +
                    'they can already access).',
            },
            {
                tag: 'Platform',
                text:
                    'Recipient e-mail resolution for notifications moved ' +
                    'to a dedicated service-to-service credential — ' +
                    'API-triggered events gain e-mail parity once the ' +
                    'credential is activated per deployment.',
            },
        ],
    },
    {
        version: 'v1.0.0',
        date: 'July 2026',
        title: 'Initial public release',
        entries: [
            {
                tag: 'API',
                text:
                    'Public API v1 — tasks/issues/suggestions, customers, ' +
                    'projects, work logs and meetings under /api/public/v1 ' +
                    '(reads everywhere; user-bound writes for tasks, ' +
                    'comments, status and work logs).',
            },
            {
                tag: 'Auth',
                text:
                    'Token authentication — hashed at rest, shown once, ' +
                    'environment-scoped (hms_dev_/hms_live_), rotate and ' +
                    'revoke.',
            },
            {
                tag: 'Auth',
                text:
                    'RBAC scopes plus data-access bindings as two ' +
                    'independent authorization layers (least-privilege, ' +
                    'fail-closed).',
            },
            {
                tag: 'Admin',
                text:
                    'API Management — clients, tokens, bindings, request ' +
                    'logs and retention controls for administrators.',
            },
            {
                tag: 'Docs',
                text:
                    'Developer Portal (this site) with guided onboarding, ' +
                    'plus public Swagger UI and a downloadable OpenAPI ' +
                    'schema.',
            },
            {
                tag: 'Platform',
                text:
                    'Per-token rate limiting with X-RateLimit-* headers ' +
                    'and Retry-After.',
            },
            {
                tag: 'Platform',
                text:
                    'Idempotency for all POST endpoints — 24-hour replay ' +
                    'window, race-safe reservation, stable ' +
                    'idempotency_request_in_progress signal.',
            },
            {
                tag: 'Platform',
                text:
                    'Live machine-readable catalogs at /v1/capabilities ' +
                    '(scopes, errors, limits, write policy) — this portal ' +
                    'renders from them directly.',
            },
        ],
    },
]

const TAG_COLOR = {
    API: 'blue',
    Auth: 'purple',
    Admin: 'gold',
    Docs: 'green',
    Platform: 'cyan',
}

function ChangelogSection() {
    return (
        <div className="dp-section">
            <h2>Changelog</h2>
            <p className="dp-lead">
                What shipped, per version. Additive changes (new fields, new
                endpoints, new error codes) appear here; breaking changes
                only ever ship under a new version prefix.
            </p>

            {CHANGELOG.map((rel) => (
                <div key={rel.version} className="dp-release">
                    <div className="dp-release-head">
                        <span className="dp-release-version">
                            {rel.version}
                        </span>
                        <span className="dp-release-date">{rel.date}</span>
                        {rel.title && (
                            <span className="dp-release-title">
                                {rel.title}
                            </span>
                        )}
                    </div>
                    <ul className="dp-list">
                        {rel.entries.map((e, i) => (
                            <li key={i}>
                                {typeof e === 'string' ? (
                                    e
                                ) : (
                                    <>
                                        <Tag color={TAG_COLOR[e.tag]}>
                                            {e.tag}
                                        </Tag>{' '}
                                        {e.text}
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    )
}

export default ChangelogSection
