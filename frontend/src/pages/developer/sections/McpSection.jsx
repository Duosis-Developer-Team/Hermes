/**
 * Developer Portal — MCP.
 *
 * Durum ayrimi (CTO karari, 17.07.2026): SERVIS aktiftir; eksik olan tek
 * sey OAuth tabanli NATIVE CONNECTOR desteğidir. Bu yuzden OAuth'un
 * yoklugu tum MCP urununu "beta" gostermek icin KULLANILMAZ — ayri bir
 * yetenek satiri olarak durur ve dürüstce "not yet available" der.
 *
 * Client matrisi ../mcpClients.js icinde versiyonlu VERI olarak yasar:
 * test kanitidir, runtime metadata degil. "Verified" yalnizca gercekten
 * denenmis client'lar icindir.
 */
import { Table, Tag } from 'antd'
import CodeBlock from '../CodeBlock'
import { MCP_CLIENTS, STATUS_TONE } from '../mcpClients'

const CONFIG_EXAMPLE = `{
  "mcpServers": {
    "hermes": {
      "url": "https://<your-hermes-host>/mcp",
      "headers": {
        "Authorization": "Bearer hms_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}`

const SMOKE = `# 1) Unauthenticated challenge (expected: 401 + WWW-Authenticate)
curl -si -X POST https://<your-hermes-host>/mcp \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | head -3

# 2) Authenticated tools/list
curl -s -X POST https://<your-hermes-host>/mcp \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -H "Authorization: Bearer $HERMES_API_TOKEN" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'`

const GROUP_CALL = `{
  "name": "hermes_create_task_for_group",
  "arguments": {
    "title": "Rotate staging credentials",
    "description": "Every team member rotates their own staging token.",
    "customer_id": "3f1c0b6e-0000-4000-8000-000000000001",
    "project_id": "3f1c0b6e-0000-4000-8000-000000000002",
    "assignee_group_id": "3f1c0b6e-0000-4000-8000-000000000003",
    "scheduled_date": "2026-08-01",
    "due_date": "2026-08-15",
    "priority": "high"
  }
}`

const GROUP_RESULT = `{
  "assignment_batch_id": "9b2f7a10-0000-4000-8000-00000000000a",
  "group_id": "3f1c0b6e-0000-4000-8000-000000000003",
  "group_name": "Platform Team",
  "created_count": 5,
  "skipped_count": 1,
  "created_tasks": [
    { "task_code": "TASK-101", "assignee_user_id": "…", "status": "pending" }
  ]
}`

function StatusRow({ label, value, tone, children }) {
    return (
        <li>
            <b>{label}:</b> <Tag color={tone}>{value}</Tag>
            {children}
        </li>
    )
}

function McpSection({ goTo }) {
    return (
        <div className="dp-section">
            <h2>
                MCP Server <Tag color="green">Active</Tag>
            </h2>
            <p className="dp-lead">
                The Hermes MCP server lets AI tools work with Hermes through
                the Model Context Protocol. It is a deliberately{' '}
                <b>thin layer over the Public API</b>: every tool maps to a
                documented endpoint, and all authorization, data-access
                bindings, rate limits, idempotency and audit logging are
                enforced by the API on every call — one security model, not
                two.
            </p>

            <h3>Status at a glance</h3>
            <ul className="dp-list dp-status-list">
                <StatusRow label="MCP service" value="Active" tone="green">
                    {' '}
                    Live and serving tool calls.
                </StatusRow>
                <StatusRow
                    label="Bearer-token integrations"
                    value="Supported"
                    tone="green"
                >
                    {' '}
                    Any client that can send a custom{' '}
                    <code>Authorization</code> header works today.
                </StatusRow>
                <StatusRow
                    label="Native OAuth connector support"
                    value="Not yet available"
                    tone="orange"
                >
                    {' '}
                    Hermes does not run an OAuth 2.1 authorization server
                    yet, so clients that <i>require</i> the full OAuth
                    discovery flow (such as Claude Desktop&apos;s native
                    connector) cannot connect directly. This limits that one
                    path — it does not limit the service.
                </StatusRow>
            </ul>

            <h3>Endpoint &amp; transport</h3>
            <ul className="dp-list">
                <li>
                    Service URL: <code>https://&lt;your-hermes-host&gt;/mcp</code>{' '}
                    — ask a Hermes administrator for the host for your
                    environment.
                </li>
                <li>
                    Transport: <b>Streamable HTTP</b> (the current MCP
                    transport). No local install, no stdio server to run.
                </li>
                <li>
                    Discovery: unauthenticated requests return{' '}
                    <code>401</code> with a <code>WWW-Authenticate</code>{' '}
                    challenge pointing at the standard Protected Resource
                    Metadata document (
                    <code>/.well-known/oauth-protected-resource/mcp</code>),
                    which states the authentication reality machine-readably.
                </li>
            </ul>

            <h3>Authentication</h3>
            <ul className="dp-list">
                <li>
                    Credential: your existing Hermes API token, sent as{' '}
                    <code>Authorization: Bearer hms_…</code> on every
                    request. <b>No separate identity model</b> — nothing extra
                    to issue, store or revoke.
                </li>
                <li>
                    Environment rules carry over: a <code>hms_dev_</code>{' '}
                    token cannot talk to a live endpoint and vice versa.
                </li>
                <li>
                    <b>Revocation is immediate.</b> Revoke the token in API
                    Management and the AI tool loses access on its very next
                    call — authorization is re-checked by the API on every
                    request, never cached. (A client that has already listed
                    the tools may keep showing them until it reconnects; the
                    calls themselves fail.)
                </li>
            </ul>

            <h3>What a token can see and do</h3>
            <ul className="dp-list">
                <li>
                    <b>User-bound clients</b> act as the bound Hermes user:
                    they see what that user sees, and writes are recorded as
                    that user under that user&apos;s permissions.
                </li>
                <li>
                    <b>Service clients are read-only.</b> They never see write
                    tools in <code>tools/list</code>, and a direct call is
                    still rejected by the API — listing is a UX nicety, the
                    API is the authority.
                </li>
                <li>
                    Tools are filtered by scope: a token without{' '}
                    <code>tasks:write</code> never even <i>sees</i>{' '}
                    <code>hermes_create_task</code>, so a model cannot plan a
                    call it may not make.
                </li>
                <li>
                    Data-access bindings apply per call, unchanged. Records
                    outside your access are indistinguishable from records
                    that do not exist — deliberate non-disclosure.
                </li>
            </ul>

            <h3>Recommended token setup</h3>
            <ul className="dp-list">
                <li>
                    Use a dedicated <b>user-bound</b> API client per AI tool
                    (clean audit trail; writes act as you under your
                    permissions).
                </li>
                <li>
                    Grant minimal scopes: start with <code>tasks:read</code>{' '}
                    (+ <code>users:read</code> to resolve names); add write
                    scopes only when needed.
                </li>
                <li>
                    Want a strictly read-only agent? Issue a read-only token.
                    There is nothing to configure on the MCP side.
                </li>
            </ul>

            <h3>Client configuration (generic shape)</h3>
            <p>
                Clients that accept a remote server URL plus custom headers
                use this shape; exact key names vary per client, and the
                matrix below records only what has actually been verified.
            </p>
            <CodeBlock
                title="mcp client config (fictional token)"
                lang="json"
                code={CONFIG_EXAMPLE}
            />

            <h3>Client compatibility</h3>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                rowKey="key"
                columns={[
                    { title: 'Client', dataIndex: 'client' },
                    {
                        title: 'Status',
                        dataIndex: 'status',
                        width: 140,
                        render: (v) => (
                            <Tag color={STATUS_TONE[v]}>{v}</Tag>
                        ),
                    },
                    { title: 'Transport', dataIndex: 'transport', width: 170 },
                    { title: 'Authentication', dataIndex: 'auth', width: 150 },
                    { title: 'Notes', dataIndex: 'notes' },
                ]}
                dataSource={MCP_CLIENTS}
                scroll={{ x: 'max-content' }}
            />
            <p>
                A client is marked <b>Verified</b> only after a real
                end-to-end run. <b>Not yet tested</b> means exactly that — it
                is not a statement that the client fails, and we would rather
                say “unknown” than guess.
            </p>

            <h3>Smoke test</h3>
            <CodeBlock title="curl" lang="bash" code={SMOKE} />

            <h3>Write tools &amp; approval</h3>
            <ul className="dp-list">
                <li>
                    Write tools (create task, create tasks for a group,
                    update, comment, complete, change status, log time) are{' '}
                    <b>user-bound only</b> and marked non-read-only, so MCP
                    clients prompt for human approval before invoking them.
                    Configure your client to auto-approve reads and{' '}
                    <b>require approval for writes</b>.
                </li>
                <li>
                    <b>No delete tools exist</b>, and nothing is annotated
                    destructive. Ownership can never be set — a write always
                    acts as the bound user.
                </li>
            </ul>

            <h3>Group assignment</h3>
            <p>
                <code>hermes_create_task_for_group</code> (scope{' '}
                <code>tasks:write</code>, user-bound only) assigns to a whole
                user group in one call — the same capability the Hermes web
                app offers — backed by{' '}
                <code>POST /api/public/v1/task-groups</code>.
            </p>
            <ul className="dp-list">
                <li>
                    One work item per <b>eligible active member</b>; all of
                    them share a single <code>assignment_batch_id</code>.
                </li>
                <li>
                    Recipients are <b>derived from the group</b> — you never
                    send a member list, and member lists are never readable
                    through the API.
                </li>
                <li>
                    The existing Hermes rules stay authoritative: the bound
                    user needs assignment permission for that group, members
                    without effective task access are <b>skipped</b>, and the
                    assigner is excluded from their own fan-out.
                </li>
                <li>
                    Because of those rules <code>created_count</code> may be
                    lower than the group&apos;s member count;{' '}
                    <code>skipped_count</code> reports the difference honestly
                    rather than letting you assume one task per member. If no
                    member is eligible, <b>nothing is created</b> and the call
                    fails.
                </li>
            </ul>
            <CodeBlock
                title="tools/call arguments (fictional ids)"
                lang="json"
                code={GROUP_CALL}
            />
            <CodeBlock
                title="result (fictional)"
                lang="json"
                code={GROUP_RESULT}
            />

            <h3>Idempotency for agent retries</h3>
            <ul className="dp-list">
                <li>
                    Transport-level retries of the same tool call are
                    automatically protected (a key is derived from the MCP
                    request id).
                </li>
                <li>
                    Retrying the same <i>logical</i> operation across separate
                    agent turns is protected ONLY if you pass the same
                    explicit <code>idempotency_key</code> argument — same key
                    + same payload replays; same key + different payload
                    returns <code>conflict</code>. Without a shared key,
                    separate calls create separate records. We do not claim
                    semantic de-duplication we cannot deliver.
                </li>
            </ul>

            <h3>Audit &amp; rate limits</h3>
            <ul className="dp-list">
                <li>
                    Every tool call is exactly one Public API request and
                    appears in the admin Request Logs with its client, token,
                    path, status and duration — User-Agent{' '}
                    <code>hermes-mcp/… tool=…</code> makes per-tool usage
                    queryable. AI traffic is not a separate, dimmer audit
                    trail.
                </li>
                <li>
                    MCP calls consume the <b>same per-token rate limit</b> as
                    direct API calls — an agent cannot out-spend the
                    integration it belongs to. A <code>429</code> surfaces
                    with retry guidance. Consider a separate client per
                    consumer so budgets and audit stay clean.
                </li>
                <li>
                    List tools return at most 50 items per call with{' '}
                    <code>has_more/next_offset</code>; long text fields are
                    truncated at 4000 chars with an explicit{' '}
                    <code>truncated</code> marker.
                </li>
            </ul>

            <h3>Prompt-injection &amp; data safety</h3>
            <ul className="dp-list">
                <li>
                    Hermes field values (titles, descriptions, comments,
                    subjects) are <b>untrusted user data</b>. The server
                    returns structured JSON only and never turns content into
                    instructions — but your agent should treat those strings
                    as data too, never as commands.
                </li>
                <li>
                    Keep write approval ON for agents that read shared Hermes
                    content; that is the effective backstop if a model follows
                    injected text.
                </li>
                <li>
                    Tool descriptions and schemas are static — no user content
                    flows into them, so they cannot be influenced by whatever
                    someone types into a task.
                </li>
            </ul>

            <h3>Troubleshooting</h3>
            <ul className="dp-list">
                <li>
                    <code>401 + WWW-Authenticate</code>: missing header — add
                    the Bearer token. <code>Hermes token problem</code>:
                    invalid/expired/revoked — check API Management.{' '}
                    <code>insufficient_scope</code>: extend the client&apos;s
                    scopes. <code>404 Not found (or not visible)</code>: the
                    record may exist outside your data access — deliberate
                    non-disclosure. <code>503 server busy</code>: concurrency
                    guard — retry shortly.
                </li>
            </ul>

            <p>
                Scope semantics and data-access rules are identical to the
                Public API — see{' '}
                <button
                    type="button"
                    className="dp-inline-link"
                    onClick={() => goTo('scopes')}
                >
                    Scopes &amp; Data Access
                </button>
                .
            </p>
        </div>
    )
}

export default McpSection
