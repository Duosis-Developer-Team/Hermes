/**
 * Developer Portal — API Reference (Stage 4B).
 * Kaynak bazli rehber; tam semalar Swagger/OpenAPI'de. Ornek kodlar
 * kurgusaldir.
 */
import { Tag } from 'antd'

function Method({ m }) {
    const color = { GET: 'green', POST: 'blue', PATCH: 'gold' }[m]
    return (
        <Tag color={color} className="dp-method">
            {m}
        </Tag>
    )
}

function Endpoint({ m, path, children }) {
    return (
        <li className="dp-endpoint">
            <span className="dp-endpoint-sig">
                <Method m={m} />
                <code>{path}</code>
            </span>
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
                . All endpoints are under <code>/api/public/v1</code>.
            </p>

            <h3>Meta &amp; identity</h3>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/health">
                    Liveness — no auth.
                </Endpoint>
                <Endpoint m="GET" path="/capabilities">
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
                <Endpoint m="GET" path="/tasks">
                    List with status/priority/type/customer/project/assignee
                    filters, due-date range and <code>updated_after</code>{' '}
                    delta sync.
                </Endpoint>
                <Endpoint m="GET" path="/tasks/{'{code}'}">
                    One item by code.
                </Endpoint>
                <Endpoint m="GET" path="/tasks/{'{code}'}/activity">
                    Sanitized newest-first activity feed (event type, human
                    summary, actor — never raw event payloads).
                </Endpoint>
                <Endpoint m="GET" path="/tasks/{'{code}'}/comments">
                    Oldest-first conversation; deleted comments never appear.
                </Endpoint>
                <Endpoint m="POST" path="/tasks">
                    Create as the bound user — all internal assignment rules
                    (permission, hierarchy, assignee access) apply unchanged.
                </Endpoint>
                <Endpoint m="PATCH" path="/tasks/{'{code}'}">
                    Partial update; codes, internal ids, completion metadata
                    and archive state cannot be mutated.
                </Endpoint>
                <Endpoint m="POST" path="/tasks/{'{code}'}/comments">
                    Add a comment.
                </Endpoint>
                <Endpoint m="POST" path="/tasks/{'{code}'}/complete">
                    Complete (assignee-only rule applies).
                </Endpoint>
                <Endpoint m="POST" path="/tasks/{'{code}'}/status">
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
                <Endpoint m="GET" path="/customers">
                    Active customers visible to the token (derived
                    visibility — see Scopes &amp; Data Access); name search
                    via <code>q</code>.
                </Endpoint>
                <Endpoint m="GET" path="/customers/{'{id}'}">
                    One customer.
                </Endpoint>
                <Endpoint m="GET" path="/projects">
                    Active projects; filter by <code>customer_id</code>,
                    search via <code>q</code>.
                </Endpoint>
                <Endpoint m="GET" path="/projects/{'{id}'}">
                    One project.
                </Endpoint>
            </ul>

            <h3>Work Logs</h3>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/work-logs">
                    List with date range, customer/project/user filters and
                    task/meeting link filters. Numeric ids.
                </Endpoint>
                <Endpoint m="GET" path="/work-logs/{'{id}'}">
                    One entry.
                </Endpoint>
                <Endpoint m="POST" path="/work-logs">
                    Create a time entry — always recorded for the bound user
                    (no on-behalf-of). Required: customer, project, work
                    type, date, duration (0.25–24h). Optionally link{' '}
                    <code>task_code</code> <b>or</b> <code>meeting_id</code>{' '}
                    — never both; the linked item must be visible to your
                    token.
                </Endpoint>
            </ul>

            <h3>Meetings</h3>
            <ul className="dp-endpoints">
                <Endpoint m="GET" path="/meetings">
                    Meetings where a user in your access is an attendee;
                    time-range filter, cancelled excluded by default.
                </Endpoint>
                <Endpoint m="GET" path="/meetings/{'{id}'}">
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
