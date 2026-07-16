/**
 * Developer Portal — API Reference (Stage 4B; 4C: badge'ler + kopya).
 *
 * Her endpoint satiri taranabilir rozetler tasir (onayli 4C-3):
 *   Read / Write · User-bound only / Service supported · Idempotent ·
 *   scope adi. Kopya butonu yalnizca "METHOD /tam/yol" metnini kopyalar.
 */
import { useState } from 'react'
import { Tag, Tooltip } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'

function Method({ m }) {
    const color = { GET: 'green', POST: 'blue', PATCH: 'gold' }[m]
    return (
        <Tag color={color} className="dp-method">
            {m}
        </Tag>
    )
}

function Endpoint({ m, path, scope, write = false, idempotent = false,
                    noAuth = false, children }) {
    const [copied, setCopied] = useState(false)
    const full = `${m} /api/public/v1${path}`

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(full)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /* pano engellendiyse sessiz kal */
        }
    }

    return (
        <li className="dp-endpoint">
            <div className="dp-endpoint-main">
                <span className="dp-endpoint-sig">
                    <Method m={m} />
                    <code>{path}</code>
                    <Tooltip title={copied ? 'Copied' : `Copy "${full}"`}>
                        <button
                            type="button"
                            className="dp-endpoint-copy"
                            aria-label={`Copy ${full}`}
                            onClick={copy}
                        >
                            {copied ? <CheckOutlined /> : <CopyOutlined />}
                        </button>
                    </Tooltip>
                </span>
                <span className="dp-badges">
                    {write ? (
                        <>
                            <span className="dp-badge is-write">Write</span>
                            <span className="dp-badge is-userbound">
                                User-bound only
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="dp-badge is-read">Read</span>
                            <span className="dp-badge is-service">
                                Service supported
                            </span>
                        </>
                    )}
                    {idempotent && (
                        <span className="dp-badge is-idem">Idempotent</span>
                    )}
                    {noAuth && (
                        <span className="dp-badge">No auth</span>
                    )}
                    {scope && (
                        <span className="dp-badge is-scope">
                            <code>{scope}</code>
                        </span>
                    )}
                </span>
            </div>
            <span className="dp-endpoint-desc">{children}</span>
        </li>
    )
}

function ApiReferenceSection({ goTo }) {
    return (
        <div className="dp-section">
            <h2>API Reference</h2>
            <p className="dp-lead">
                A guided tour of every resource. Exact request/response
                schemas, field types and per-endpoint scope requirements live
                in the{' '}
                <button
                    type="button"
                    className="dp-inline-link"
                    onClick={() => goTo('api-explorer')}
                >
                    API Explorer
                </button>
                . All endpoints are under <code>/api/public/v1</code>.{' '}
                <b>Idempotent</b> marks POST endpoints that accept the
                optional <code>Idempotency-Key</code> header.
            </p>

            <h3>Meta &amp; identity</h3>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/health" noAuth>
                    Liveness — no auth.
                </Endpoint>
                <Endpoint m="GET" path="/capabilities" noAuth>
                    Machine-readable surface description: scopes, error
                    catalog, pagination limits, write/idempotency policy — no
                    auth.
                </Endpoint>
                <Endpoint m="GET" path="/me">
                    The presented token's client, scopes and bindings. Needs
                    a valid token, no scopes.
                </Endpoint>
            </ul>

            <h3>Tasks, Issues &amp; Suggestions</h3>
            <p>
                One work-item surface, three types. Public identity is the{' '}
                <b>code</b> — <code>TASK-12</code>, <code>ISSUE-3</code>,{' '}
                <code>SUGGESTION-7</code> — case-insensitive in URLs.
            </p>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/tasks" scope="tasks:read">
                    List with status/priority/type/customer/project/assignee
                    filters, due-date range and <code>updated_after</code>{' '}
                    delta sync.
                </Endpoint>
                <Endpoint m="GET" path="/tasks/{code}" scope="tasks:read">
                    One item by code.
                </Endpoint>
                <Endpoint
                    m="GET"
                    path="/tasks/{code}/activity"
                    scope="tasks:read"
                >
                    Sanitized newest-first activity feed (event type, human
                    summary, actor — never raw event payloads).
                </Endpoint>
                <Endpoint
                    m="GET"
                    path="/tasks/{code}/comments"
                    scope="tasks:read"
                >
                    Oldest-first conversation; deleted comments never appear.
                </Endpoint>
                <Endpoint
                    m="POST"
                    path="/tasks"
                    scope="tasks:write"
                    write
                    idempotent
                >
                    Create as the bound user — all internal assignment rules
                    (permission, hierarchy, assignee access) apply unchanged.
                </Endpoint>
                <Endpoint
                    m="PATCH"
                    path="/tasks/{code}"
                    scope="tasks:write"
                    write
                >
                    Partial update; codes, internal ids, completion metadata
                    and archive state cannot be mutated.
                </Endpoint>
                <Endpoint
                    m="POST"
                    path="/tasks/{code}/comments"
                    scope="tasks:comment"
                    write
                    idempotent
                >
                    Add a comment.
                </Endpoint>
                <Endpoint
                    m="POST"
                    path="/tasks/{code}/complete"
                    scope="tasks:complete"
                    write
                    idempotent
                >
                    Complete (assignee-only rule applies).
                </Endpoint>
                <Endpoint
                    m="POST"
                    path="/tasks/{code}/status"
                    scope="tasks:complete"
                    write
                    idempotent
                >
                    <code>accept</code> / <code>reject</code> /{' '}
                    <code>reopen</code> with internal transition rules.
                </Endpoint>
            </ul>
            <p>
                All writes need a <b>user-bound</b> client. There are no
                delete endpoints anywhere in v1.
            </p>

            <h3>Customers &amp; Projects</h3>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/customers" scope="customers:read">
                    Active customers visible to the token (derived
                    visibility — see Scopes &amp; Data Access); name search
                    via <code>q</code>.
                </Endpoint>
                <Endpoint
                    m="GET"
                    path="/customers/{id}"
                    scope="customers:read"
                >
                    One customer.
                </Endpoint>
                <Endpoint m="GET" path="/projects" scope="projects:read">
                    Active projects; filter by <code>customer_id</code>,
                    search via <code>q</code>.
                </Endpoint>
                <Endpoint
                    m="GET"
                    path="/projects/{id}"
                    scope="projects:read"
                >
                    One project.
                </Endpoint>
            </ul>

            <h3>Work Logs</h3>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/work-logs" scope="work-logs:read">
                    List with date range, customer/project/user filters and
                    task/meeting link filters. Numeric ids.
                </Endpoint>
                <Endpoint
                    m="GET"
                    path="/work-logs/{id}"
                    scope="work-logs:read"
                >
                    One entry.
                </Endpoint>
                <Endpoint
                    m="POST"
                    path="/work-logs"
                    scope="work-logs:write"
                    write
                    idempotent
                >
                    Create a time entry — always recorded for the bound user
                    (no on-behalf-of). Required: customer, project, work
                    type, date, duration (0.25–24h). Optionally link{' '}
                    <code>task_code</code> <b>or</b> <code>meeting_id</code>{' '}
                    — never both; the linked item must be visible to your
                    token.
                </Endpoint>
            </ul>

            <h3>Directory (Users &amp; Groups)</h3>
            <p>
                Least-privilege identity resolution — <b>not</b> a
                company-wide employee list. Non-global tokens resolve only
                identities encountered in records they can already access.
            </p>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/users" scope="users:read">
                    Visible directory entries (id, display_name,
                    work_email, is_active); search via <code>q</code> runs
                    inside the authorized set only.
                </Endpoint>
                <Endpoint m="GET" path="/users/{id}" scope="users:read">
                    Resolve one user id into a minimal entry.
                </Endpoint>
                <Endpoint m="GET" path="/groups" scope="groups:read">
                    Visible active groups (name, description, active
                    member count — never member lists).
                </Endpoint>
                <Endpoint m="GET" path="/groups/{id}" scope="groups:read">
                    One group.
                </Endpoint>
            </ul>

            <h3>Meetings</h3>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/meetings" scope="meetings:read">
                    Meetings where a user in your access is an attendee;
                    time-range filter, cancelled excluded by default.
                </Endpoint>
                <Endpoint
                    m="GET"
                    path="/meetings/{id}"
                    scope="meetings:read"
                >
                    One meeting.
                </Endpoint>
            </ul>
            <p>
                Meeting bodies are never exposed. Private/confidential
                meetings keep a masked subject (<code>is_private</code> tells
                you when). Tokens with only customer/project bindings see no
                meetings at all — meetings have no customer/project relation.
            </p>
        </div>
    )
}

export default ApiReferenceSection
