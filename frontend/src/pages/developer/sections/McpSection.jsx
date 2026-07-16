/**
 * Developer Portal — MCP (Stage 5D/G — internal beta rehberi).
 *
 * YALNIZCA dogrulanmis gercekler: davranislar test-kilitli; client
 * matrisi gercek testler yapilana kadar "not tested" der. External
 * uyumluluk IDDIA EDILMEZ (OAuth AS henuz yok — durust durum).
 */
import { Table, Tag } from 'antd'
import CodeBlock from '../CodeBlock'

const CONFIG_EXAMPLE = `{
  "mcpServers": {
    "hermes": {
      "url": "https://<your-hermes-host>/mcp",
      "headers": {
        "Authorization": "Bearer hms_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
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

const CLIENT_ROWS = [
    {
        key: 'claude',
        client: 'Claude (remote MCP / Desktop / Code)',
        status: 'Not yet tested',
    },
    { key: 'cursor', client: 'Cursor', status: 'Not yet tested' },
    {
        key: 'openai',
        client: 'OpenAI MCP-capable tooling',
        status: 'Not yet tested',
    },
]

function McpSection({ goTo }) {
    return (
        <div className="dp-section">
            <h2>
                MCP Server <Tag color="gold">internal beta</Tag>
            </h2>
            <p className="dp-lead">
                The Hermes MCP server lets AI tools work with Hermes through
                the Model Context Protocol — <b>23 tools</b> covering every
                Public API read surface plus user-bound writes. It is a
                deliberately <b>thin layer over the Public API</b>: every
                tool maps to a documented endpoint, and all authorization,
                data-access bindings, rate limits, idempotency and audit
                logging are enforced by the API on every call.
            </p>

            <h3>Authentication — internal beta</h3>
            <ul className="dp-list">
                <li>
                    Credential: your existing Hermes API token, sent as{' '}
                    <code>Authorization: Bearer hms_…</code> on every
                    request. <b>No separate identity model.</b>
                </li>
                <li>
                    Unauthenticated requests receive an HTTP{' '}
                    <code>401</code> with a <code>WWW-Authenticate</code>{' '}
                    challenge pointing at the standard OAuth Protected
                    Resource Metadata document (
                    <code>/.well-known/oauth-protected-resource/mcp</code>).
                </li>
                <li>
                    <Tag color="orange">Honest status</Tag> Bearer-header
                    mode is <b>internal-beta</b> authentication. An OAuth
                    2.1 authorization server is not yet available, so
                    compatibility with remote MCP clients that require the
                    full OAuth discovery flow is <b>not claimed</b>. The
                    PRM document states this explicitly.
                </li>
                <li>
                    Revoking the token in API Management disconnects the AI
                    tool at its very next call.
                </li>
            </ul>

            <h3>Recommended token setup</h3>
            <ul className="dp-list">
                <li>
                    Use a dedicated <b>user-bound</b> API client per AI
                    tool (clean audit trail; writes act as you under your
                    permissions).
                </li>
                <li>
                    Grant minimal scopes: start with{' '}
                    <code>tasks:read</code> (+ <code>users:read</code> for
                    name resolution); add write scopes only when needed.
                </li>
                <li>
                    Read-only agent: a token with only read scopes never
                    even <i>sees</i> write tools in <code>tools/list</code>.
                    Service-type clients never see write tools at all.
                </li>
            </ul>

            <h3>Client configuration (generic shape)</h3>
            <p>
                MCP clients that accept a remote server URL plus custom
                headers use this shape (exact key names vary per client;
                the matrix below records what we have actually verified):
            </p>
            <CodeBlock title="mcp client config (fictional token)" lang="json" code={CONFIG_EXAMPLE} />

            <h3>Verified-client matrix</h3>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    { title: 'Client', dataIndex: 'client' },
                    {
                        title: 'Status',
                        dataIndex: 'status',
                        width: 160,
                        render: (v) => <Tag>{v}</Tag>,
                    },
                ]}
                dataSource={CLIENT_ROWS}
                scroll={{ x: 'max-content' }}
            />
            <p>
                We only mark a client as supported after a real end-to-end
                test (connect, list tools, one read, one approved write,
                revocation). Until then the honest answer is “not yet
                tested”.
            </p>

            <h3>Write tools &amp; approval</h3>
            <ul className="dp-list">
                <li>
                    Six write tools (create/update task, comment, complete,
                    change status, log time) — <b>user-bound tokens
                    only</b>, marked non-read-only so MCP clients prompt
                    for human approval. Configure your client to
                    auto-approve reads and <b>require approval for
                    writes</b>.
                </li>
                <li>
                    No delete tools exist. Ownership can never be set — a
                    write always acts as the bound user.
                </li>
            </ul>

            <h3>Idempotency for agent retries</h3>
            <ul className="dp-list">
                <li>
                    Transport-level retries of the same tool call are
                    automatically protected (a key is derived from the MCP
                    request id).
                </li>
                <li>
                    Retrying the same <i>logical</i> operation across
                    separate agent turns is protected ONLY if you pass the
                    same explicit <code>idempotency_key</code> argument —
                    same key + same payload replays; same key + different
                    payload returns <code>conflict</code>. Without a shared
                    key, separate calls create separate records.
                </li>
            </ul>

            <h3>Prompt-injection guidance</h3>
            <ul className="dp-list">
                <li>
                    Hermes field values (titles, descriptions, comments,
                    subjects) are <b>untrusted user data</b>. The server
                    returns structured JSON only and never turns content
                    into instructions — but your agent should treat those
                    strings as data too.
                </li>
                <li>
                    Keep write approval ON for agents that read shared
                    Hermes content; that is the effective backstop if a
                    model follows injected text.
                </li>
            </ul>

            <h3>Limits, audit &amp; troubleshooting</h3>
            <ul className="dp-list">
                <li>
                    MCP calls consume the same per-token rate limit as
                    direct API calls; 429s surface with retry guidance.
                    Every tool call appears in the admin Request Logs
                    (User-Agent <code>hermes-mcp/… tool=…</code>).
                </li>
                <li>
                    <code>401 + WWW-Authenticate</code>: missing header —
                    add the Bearer token. <code>Hermes token problem</code>
                    : invalid/expired/revoked token — check API
                    Management. <code>insufficient_scope</code>: extend the
                    client's scopes. <code>404 Not found (or not visible)</code>
                    : the record may exist outside your data access —
                    deliberate non-disclosure. <code>503 server busy</code>
                    : concurrency guard — retry shortly.
                </li>
                <li>
                    List tools return at most 50 items per call with{' '}
                    <code>has_more/next_offset</code>; long text fields are
                    truncated at 4000 chars with an explicit{' '}
                    <code>truncated</code> marker.
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
