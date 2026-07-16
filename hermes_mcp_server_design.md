# Hermes MCP Server — Architecture & Design Document

Stage 5 design — **APPROVED WITH AMENDMENTS** (CTO, 2026-07-16); this
revision incorporates every amendment. Implementation starts at 5A.
Treats Hermes MCP as a production-grade developer product: same rigor
as the Public API (staged delivery, CI gates, security review, honest
documentation), not an experimental feature.

Author's frame: everything below is derived from one non-negotiable
principle, already published in the Developer Portal —

> **MCP is a deliberately thin layer over the Public API. One security
> model, not two.**

---

## 1. Overall architecture

```
MCP client (Claude / Cursor / OpenAI Agents / IDE)
        │  MCP protocol (Streamable HTTP)
        ▼
┌──────────────────────────────┐
│  hermes-mcp  (new service)   │   backend/mcp-service
│  - MCP session handling      │   Python, official `mcp` SDK
│  - tool registry + schemas   │   stateless between sessions
│  - error/pagination mapping  │
└──────────────┬───────────────┘
               │  plain HTTPS, Authorization: Bearer hms_…
               ▼
   core-service  /api/public/v1   (UNCHANGED)
   auth, scopes, bindings, rate limit, audit, idempotency
```

**Decision D5-1 — separate service, API-only access (recommended).**
The MCP server is a new, small deployment (`backend/mcp-service`) that
talks to the Public API **over HTTP only**. It has **no database
connection, no imports from core-service, no shared session state**.

Why this and not mounting MCP inside core-service:
- The "thin layer" guarantee becomes **structural**: it is impossible
  for a tool to bypass scope checks, data-access bindings, rate limits
  or audit, because the only thing the process can reach is the public
  surface itself.
- Blast-radius isolation: an MCP bug cannot take down the core API;
  restarts/deploys are independent; it can scale separately.
- The MCP dependency set (MCP SDK, HTTP client) never enters the core
  image.
Cost: one more deployment + one in-cluster HTTP hop (~1–3 ms). Accepted.

In-cluster it calls **`http://core-service/api/public/v1`** — VERIFIED
against k8s/03-backend-core.yaml: the ClusterIP Service exposes port 80
→ targetPort 8001, so the Service DNS name without a port is correct.
The base URL is **configuration-only** (single env var); the code
refuses any per-request/upstream override — tools cannot select another
host (SSRF-proof by construction, test-enforced). NetworkPolicy egress
restriction to core-service+DNS is preferred at deployment time where
cluster support permits. Rate limiter, audit middleware and error
envelope are app-level, so in-cluster calls get identical treatment to
external ones.

## 2. Transport model

**Decision D5-2 — remote-first Streamable HTTP.**
- Primary transport: **Streamable HTTP** (current MCP spec transport),
  served at a dedicated ingress path `https://<hermes-host>/mcp`.
  Rationale: Hermes is a hosted product; remote MCP means zero local
  install, instant token revocation, central upgrades.
- Backwards compatibility: the SDK's HTTP+SSE compatibility mode stays
  enabled for older clients during the beta.
- **stdio** is NOT shipped in v1. A stdio wrapper (thin proxy binary)
  is a later convenience for air-gapped local dev, not a launch need.
- Sessions: MCP session id handled by the SDK; the server keeps only
  in-memory per-session context (validated token + resolved scope
  snapshot + client info). No session persistence; a reconnect simply
  re-initializes.

## 3. Authentication

**Same token model. No separate authentication. Nothing new to issue,
store, or revoke.**

- The MCP client sends the existing Hermes API token:
  `Authorization: Bearer hms_dev_… / hms_live_…` on every HTTP request
  (all target clients support per-server headers).
- On MCP `initialize`, the server calls `GET /v1/me` with that token:
  - success → session established; scopes + client type cached ONLY
    for tool-list visibility (tool filtering, §4) with a SHORT TTL
    (≤15 s; `tools/list` re-validates via /v1/me when the cache is
    stale) so a revoked token's write tools disappear from client UIs
    quickly;
  - failure → the MCP handshake is rejected with the API's own error
    text (invalid/expired/revoked).
- Every subsequent tool call forwards the same bearer token; the API
  re-validates on each request (the session cache is only for tool
  listing, never for authorization decisions — fail-closed stays with
  the API).
- The token is held in memory for the life of the session only. It is
  never logged, never persisted, never echoed in tool output.
- **OAuth roadmap (D5-3, amended).** Bearer-header auth is the
  **internal dev-beta credential for 5A–5C only** — it is NOT claimed
  to be the final production-compatible remote MCP authorization
  design. The current MCP authorization specification prescribes
  OAuth 2.1 + **Protected Resource Metadata** for protected remote
  HTTP servers, and client surfaces differ in what they accept. Before
  Stage 5D external-client rollout we design and implement (or
  explicitly gate 5D on) MCP OAuth 2.1 compatibility with Protected
  Resource Metadata and standard client discovery behavior. Hard
  constraint: OAuth must NOT create a second RBAC or data-access
  model — any OAuth access credential resolves to the same Hermes API
  client, scopes, bindings, environment, revocation/expiry state and
  audit identity. One **authorization model**; the credential
  *transport* may standardize. User JWTs are never fabricated or
  forwarded.
- Environment rule carries over: a dev token cannot talk to the live
  MCP endpoint and vice versa (enforced by the API itself).

## 4. Scope mapping

Tools map 1:1 onto Public API endpoints, and therefore onto scopes.
The MCP server adds **tool visibility filtering**: `tools/list` returns
only tools whose scope the session's token holds. A token without
`tasks:write` never even *sees* `hermes_create_task` — the model cannot
hallucinate calls into 403s, and least-privilege is visible in the UX.

| Tool | Endpoint | Scope |
|---|---|---|
| hermes_whoami | GET /v1/me | (none) |
| hermes_list_tasks | GET /v1/tasks | tasks:read |
| hermes_get_task | GET /v1/tasks/{code} | tasks:read |
| hermes_get_task_activity | GET /v1/tasks/{code}/activity | tasks:read |
| hermes_list_task_comments | GET /v1/tasks/{code}/comments | tasks:read |
| hermes_create_task | POST /v1/tasks | tasks:write |
| hermes_update_task | PATCH /v1/tasks/{code} | tasks:write |
| hermes_add_task_comment | POST /v1/tasks/{code}/comments | tasks:comment |
| hermes_complete_task | POST /v1/tasks/{code}/complete | tasks:complete |
| hermes_change_task_status | POST /v1/tasks/{code}/status | tasks:complete |
| hermes_list_customers | GET /v1/customers | customers:read |
| hermes_get_customer | GET /v1/customers/{id} | customers:read |
| hermes_list_projects | GET /v1/projects | projects:read |
| hermes_get_project | GET /v1/projects/{id} | projects:read |
| hermes_list_work_logs | GET /v1/work-logs | work-logs:read |
| hermes_get_work_log | GET /v1/work-logs/{id} | work-logs:read |
| hermes_log_time | POST /v1/work-logs | work-logs:write |
| hermes_list_meetings | GET /v1/meetings | meetings:read |
| hermes_get_meeting | GET /v1/meetings/{id} | meetings:read |

19 tools in v1. Data-access bindings need **zero** MCP-side logic —
the API applies them per request, unchanged. Write rules carry over:
service-client tokens see no write tools (client type from /v1/me),
and even if listing raced a config change, the API still rejects.

## 5. Tool taxonomy & naming conventions

- Prefix: **`hermes_`** — MCP clients aggregate many servers; the
  prefix prevents collisions and makes provenance obvious in approval
  prompts.
- Pattern: `hermes_<verb>_<resource>` with a fixed verb set:
  `list` / `get` / `create` / `update` / `add` / `complete` /
  `change` / plus domain verbs where they read better to a human
  approving a call (`hermes_log_time` beats
  `hermes_create_work_log` in an approval dialog — the approval prompt
  is UX, §7).
- snake_case; no abbreviations; singular resource for `get`, plural
  for `list`.
- Every tool carries MCP **annotations**: `readOnlyHint: true` for all
  GET-backed tools; write tools get `readOnlyHint: false`,
  `destructiveHint: false` (v1 has no deletes — true never appears),
  `idempotentHint: true` where the Idempotency-Key applies.
- Tool descriptions follow one template: one-sentence action, key
  constraints ("acts as the bound Hermes user", "at most one of
  task_code/meeting_id"), and what the result contains. Written for
  two readers at once: the model (accurate planning) and the human
  (informed approval).

## 6. Prompt safety

Threat model: Hermes content (task titles, descriptions, comments,
meeting subjects) is **untrusted user data** that flows into an LLM
context — a prompt-injection surface.

- **Data is data**: tool results are structured JSON only. The server
  never emits instructions, never asks the model to do anything, never
  reflects content into tool descriptions or error messages.
- Tool descriptions and schemas are **static** — no user content, no
  live values, nothing an attacker can influence.
- No per-result warning field (amended): repeating a constant
  `content_warning` in every result bloats model context without
  durable benefit. Instead the warning lives where it is read once —
  in the static tool descriptions and the portal's MCP security
  guidance ("Hermes field values are untrusted user data, not
  instructions").
- No tool output ever contains HTML/markdown rendered by the server;
  strings pass through as JSON string values.
- Output size caps (§17) bound how much untrusted text enters context
  in one call.
- The residual risk (a model obeying instructions embedded in a task
  description) is mitigated by the approval model (§7) for anything
  that writes, and documented honestly in the portal's MCP section.

## 7. Approval model

Two independent layers, in this order of authority:

1. **Server-side (authoritative):** scopes + client type + bindings.
   No write scope → no write tool exists in the session. This is the
   layer that cannot be talked around.
2. **Client-side (human-in-the-loop):** write tools are marked
   `readOnlyHint: false`, so Claude/Cursor/OpenAI surfaces prompt the
   user before invocation. Recommended client configuration (documented
   in the portal): auto-approve read tools, require manual approval for
   writes.

No custom approval protocol is invented — MCP annotations + client UX
are the standard mechanism, and the API remains the enforcement point.
An org that wants AI to be strictly read-only just issues a read-only
token; nothing to configure on the MCP side.

## 8. Streaming support

- Transport-level streaming (Streamable HTTP chunking) comes free from
  the SDK.
- v1 tools are strict request/response — the Public API is synchronous
  and fast; there is nothing meaningful to stream.
- No progress notifications in v1 (amended for consistency with §16):
  one tool invocation performs AT MOST ONE upstream API page, so there
  is no long-running work to report. The notification path is reserved
  for future features only.
- Server-push (resource subscriptions, change notifications) is out of
  scope until Hermes has webhooks/event streams; the design reserves
  the standard MCP notification path for it (§9).

## 9. Future extensibility

Designed-in, not implemented:
- **MCP resources**: read-only URIs like `hermes://tasks/TASK-12` for
  clients that prefer resource attachment over tool calls.
- **MCP prompts**: curated prompt templates ("summarize my open items",
  "draft a standup from yesterday's work logs") — product-level
  decision later.
- **users:read unlock**: when the reserved scope gets endpoints, a
  `hermes_resolve_user` tool ships the same week — biggest known DX gap
  (raw user_id UUIDs in outputs).
- **Notifications**: when Hermes grows webhooks, task-change
  subscriptions map onto MCP notifications without transport changes.
- New tools are additive; the tool registry is data-driven (one table
  of tool → endpoint → scope → schema), so growth is configuration,
  not architecture.

## 10. SDK compatibility

- Server built on the **official Python MCP SDK** (`mcp` package,
  Streamable HTTP server) — protocol version negotiation, session
  management and transport compat come from the maintained SDK rather
  than hand-rolled protocol code. Python keeps the stack aligned with
  the existing backend team skillset and CI tooling.
- Nothing MCP-specific leaks into client expectations: any spec-
  compliant MCP client works. The future REST SDKs (portal §SDKs) are
  orthogonal — they wrap the Public API directly and share nothing
  with the MCP server except the token.

## 11. OpenAI / Claude / Cursor compatibility

| Client | Mechanism | Notes |
|---|---|---|
| Claude (claude.ai connectors, Desktop, Claude Code) | Remote MCP over Streamable HTTP + custom header | primary target; approval UX built in |
| Cursor / VS Code agents | `mcpServers` config with `url` + `headers` | header-based bearer works today |
| OpenAI (Agents SDK / hosted MCP tool) | Remote MCP server URL + headers | supports Streamable HTTP MCP servers |
| Anything else spec-compliant | Standard MCP | no Hermes-specific extensions required |

Amended: the table above is a TARGET matrix, not a claim. Remote MCP
client behavior (especially accepted auth methods) changes quickly and
differs per surface. Before Stage 5D completion we run REAL smoke
tests against Claude's remote MCP/custom connector surface, Claude
Code/Desktop where applicable, Cursor, and OpenAI MCP-capable tooling,
and the portal documents the exact supported authentication and
configuration PER CLIENT — nothing is stated as compatible before it
is tested.

## 12. Security model

Inherited (enforcement stays in the API): token hashing, env
separation, scope checks, data-access bindings, user-bound write
ceiling, 404 non-disclosure, idempotency, rate limits, audit.

MCP-server-specific additions:
- **No secrets at rest**: no DB, no cache files; the only secret it
  ever touches is the caller's bearer token, in memory, per session.
- **No admin surface**: the MCP service exposes exactly one thing —
  the MCP endpoint. No config UI, no introspection endpoints beyond
  its own /health.
- **Session isolation**: per-session state is the token + scope
  snapshot; sessions cannot see each other; no cross-request caching
  of API responses (correctness + privacy over latency in v1).
- **Revocation latency ≤ 60 s** for tool *listing*, **0 s** for actual
  authorization (every call revalidates at the API).
- **Egress discipline**: the process talks to exactly one upstream
  (core-service public API). No other outbound calls. Enforced by code
  review + a config with a single base URL.
- **TLS** at the ingress, as with every Hermes surface. hermes-test is
  untouched; dev gets its own `/mcp` route first.
- Non-disclosure preserved end-to-end: the server never enriches 404s.

## 13. Audit model

Reuse, don't reinvent: every tool call becomes exactly one Public API
request and lands in `api_request_logs` with client_id, token_id,
path, status, duration, source IP — the existing admin Request Logs UI
shows MCP traffic with zero changes.

MCP enrichment without schema changes (v1):
- `User-Agent: hermes-mcp/<version> tool=<tool_name>` on every
  upstream request — the existing `user_agent` column makes per-tool
  usage queryable immediately.
- The MCP server's own stdout log is sanitized and structural only:
  session open/close, tool name, upstream status, duration,
  request_id. Never token values, never argument contents, never
  result bodies.
BACKLOG (recorded): structured audit fields on api_request_logs —
`channel` (direct_api | mcp), `tool_name`, `mcp_server_version` —
additive migration when per-tool analytics outgrow user_agent parsing
(explicitly NOT in v1).

Never logged, anywhere, at any level: bearer tokens, tool arguments,
result bodies, task/comment/description content, session headers.

## 14. Rate limiting

- MCP calls consume the **same per-token budget** as direct API calls
  — one limiter, one truth; an agent cannot out-spend the integration
  it belongs to.
- On upstream 429, the tool returns a structured, retryable error with
  the server's `Retry-After` value surfaced in the message (§16) so
  the model waits instead of thrashing.
- The MCP server adds a light **per-session concurrency cap**
  (default: 4 in-flight upstream calls) purely as a stampede guard for
  agentic loops; it is not an authorization mechanism.
- Documented honestly: one token shared between an MCP agent and a
  batch integration shares one budget — recommend separate clients per
  consumer (which also cleans up audit).

## 15. Error mapping

The API's error envelope maps mechanically to MCP tool errors
(`isError: true` with structured content). One table, no creativity:

| API code | Tool error text pattern | Model guidance embedded |
|---|---|---|
| invalid_token / expired_token / revoked_token | "Hermes token problem: <message>" | non-retryable; tell the user to check the token |
| insufficient_scope | "This token lacks <scope>." | non-retryable; name the missing scope explicitly |
| resource_access_denied | API message as-is | e.g. writes from service clients |
| resource_not_found | "Not found (or not visible to this token)." | preserves non-disclosure — never speculate which |
| validation_error | field-level message as-is | actionable: the model can fix its arguments and retry |
| conflict / idempotency_request_in_progress | message as-is + "safe to retry after completion" for in-progress | retry semantics explicit |
| rate_limit_exceeded | "Rate limited; retry after <n>s." | with the Retry-After value |
| internal_error | "Hermes internal error, request_id <id>." | include request_id for reporting |

`request_id` is always included — the audit thread from an AI
conversation to a specific logged request stays unbroken.

**Idempotency for writes (D5-4, amended — two layers, honest claims):**
1. *Transport-retry layer (automatic):* the server derives an
   Idempotency-Key from stable MCP request/session metadata, so a
   protocol-level retry of the SAME tool call cannot duplicate.
2. *Logical layer (explicit, optional):* every write tool also accepts
   an optional `idempotency_key` argument, normalized and validated by
   the Public API's own rules (8-128 chars, client-scoped, 24h replay
   window). Agents/workflows retrying the same LOGICAL operation
   across separate turns must pass the same explicit key — a new agent
   turn gets a new tool-call id, so the automatic layer alone does NOT
   deduplicate semantically, and the design does not claim it does.
   Keys are convenience, never authorization secrets.
Human approval dialogs show a summary of the object about to be
created. Required tests: same-request retry creates one record;
same explicit key across separate calls replays; same explicit key +
different payload conflicts; different tool-call ids WITHOUT a shared
explicit key are documented (and tested) as NOT semantically
deduplicated.

## 16. Pagination strategy

Token-economy first: MCP results enter a model context window.
- List tools accept `limit` (default **25**, max **50** — deliberately
  below the API's 100) and `offset`; results return `has_more` and an
  explicit `next_offset` the model can pass back verbatim.
- Responses are **compact projections**: list tools return the fields
  a model actually reasons about (code, title, status, priority,
  assignee id, dates, customer/project names) — detail tools return
  the full public schema. Projections are documented per tool and are
  strict subsets of the public schema (nothing new invented).
- No auto-draining: a tool call fetches at most one page upstream; the
  model decides whether to page (visible, auditable, rate-limit
  friendly). Progress notifications cover the UX gap for long pulls.

## 17. Versioning strategy

- The MCP server has its own semver (`hermes-mcp 1.x`), reported in
  the MCP `initialize` result; it binds to **Public API v1** only.
- Tools are additive within a major; a breaking tool change (schema or
  semantics) means a **new tool name** or a major bump — never silent
  mutation. Deprecations mirror the published API policy: minimum 90
  days, changelog entry, deprecation note in the tool description.
- When Public API v2 exists, hermes-mcp 2.x targets it; 1.x keeps
  running against v1 through the same support window as v1 itself.
- The portal Changelog covers MCP releases with an `MCP` tag.

## 18. Testing strategy

Same bar as the API (real dependencies, CI-gated):
- **Contract lock**: a test asserts every registered tool's
  (method, path) exists in the live `openapi.json` and its scope is in
  the capabilities catalog — tool/API drift breaks CI, exactly like
  the 3E `SURFACE` lock.
- **Unit**: tool schema validation, error-mapping table (every API
  code → expected MCP error shape), idempotency-key derivation,
  pagination projection correctness.
- **Integration** (docker, real Postgres + core-service app in
  process or container): MCP client SDK drives the real server against
  the real API — initialize/handshake with valid/invalid/revoked
  tokens; tools/list filtered by scopes (read-only token sees no write
  tools); each tool happy path; 404 non-disclosure via MCP; write as
  service client rejected; rate-limit propagation; token revoked
  mid-session (next call fails cleanly).
- **Security tests**: token never appears in any log line or tool
  result (grep-based, like the portal sweep); no upstream host other
  than the configured base URL is contacted.
- CI: an `mcp_tests` job alongside `backend_tests`, gating the same
  build_push_deploy.

## 19. Rollout plan (incremental, approval-gated like Stages 2–4)

- **5A — skeleton + auth + first read tools.** Service scaffold,
  Streamable HTTP endpoint, initialize→/v1/me handshake, tool registry
  mechanism, hermes_whoami + task read tools. CI job. Report + gate.
- **5B — full read coverage + hardening + directory endpoints.**
  Remaining read tools, pagination projections, error-mapping table
  complete, contract-lock test. PLUS (approved D5-6): restricted
  Public API `users:read`/`groups:read` endpoints — GET /v1/users,
  /v1/users/{id}, /v1/groups, /v1/groups/{id} with least-privilege
  visibility (global binding → broad active directory; explicit
  user/group bindings → those targets; otherwise ONLY identities
  encountered in business records already visible to the token; a
  user-bound token can never enumerate unrelated employees). Minimal
  public schema: id, display_name, work e-mail where appropriate —
  no permission rows, no role internals, no private profile fields,
  no auth metadata, no unrelated group memberships. Then
  hermes_resolve_user / hermes_list_groups tools. Report + gate.
- **5C — writes.** Write tools with tool-call-id idempotency keys,
  annotations, approval-model docs, service-client rejection surfaced
  properly. Report + gate.
- **5D — deployment + docs + remote-auth gate.** k8s manifests
  (deployment + service + `/mcp` ingress route, dev only, manual apply
  per deploy mechanics; NetworkPolicy where supported), OAuth 2.1 /
  Protected Resource Metadata compatibility implemented or 5D
  explicitly gated on it (D5-3), REAL client smoke tests (Claude /
  Cursor / OpenAI surfaces) with per-client documented auth+config,
  portal MCP section upgraded from "coming later" to real setup
  guides (fictional tokens), changelog entry. Report + gate.
- **5E — security review + internal beta.** Sweep (token leakage,
  non-disclosure, egress), real-client testing (Claude Desktop/Code +
  Cursor) with a scoped dev token, beta feedback round, RC report with
  go/no-go for wider rollout. hermes-test/live promotion is a separate
  CTO decision, as always.

Estimated new tests: ~55–70; estimated code: small (the entire point
of the thin-layer design).

## Decision record (CTO, 2026-07-16)

- **D5-1 APPROVED** — separate backend/mcp-service; no PostgreSQL, no
  core-service imports, Public API over HTTP only, no admin surface;
  upstream URL verified against the real k8s Service (port 80).
- **D5-2 APPROVED** — remote-first Streamable HTTP at /mcp; no stdio
  in v1; SDK-provided compatibility only; no custom transport.
- **D5-3 APPROVED WITH MODIFICATION** — bearer header for 5A–5C
  internal beta only; OAuth 2.1 + Protected Resource Metadata designed
  and implemented (or explicitly gating) before 5D external rollout;
  OAuth resolves to the same client/scopes/bindings/env/revocation/
  audit identity; one authorization model, credential transport may
  standardize; never fabricate/forward user JWTs.
- **D5-4 APPROVED AS TRANSPORT LAYER ONLY** — automatic key from MCP
  request metadata for protocol retries + optional explicit
  `idempotency_key` tool argument for logical retries; no semantic-
  dedup overclaim; test list mandated (see §15).
- **D5-5 APPROVED** — compact projections, default 25 / max 50, one
  upstream page per invocation, has_more + next_offset, no auto
  draining, no v1 progress notifications.
- **D5-6 APPROVED** — restricted users:read/groups:read endpoints in
  Stage 5B with least-privilege directory visibility and minimal
  public schemas (see §19/5B).
