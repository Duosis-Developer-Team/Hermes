# Hermes RBAC — Design & Implementation Record

> Status: **IMPLEMENTED** (CTO-approved plan, 17.07.2026). Replaces the
> single `is_admin` bit (~118 decision points) with dynamic, role-based
> permissions. LogiSlot's RBAC was studied source-level as the reference
> implementation; its proven patterns were adopted and its 13 identified
> weaknesses deliberately corrected (see §5).

## 1. Approved decisions (D1–D7)

| # | Decision |
|---|---|
| D1 | Role data lives in **auth_db** (identity + authorization, one authority) |
| D2 | Permissions are **never embedded in JWTs**. core resolves via S2S (60s cache), reporting via the caller's own JWT, auth from its DB. Fail-closed; **no is_admin-claim fallback** |
| D3 | Catalog starts at **13 permissions**, dotted `resource.action` naming (public API scopes use `resource:action` — visual separation is deliberate) |
| D4 | `users.is_admin` stays as a **derived** column (system-admin role ⇒ true); the dead `role` enum stays untouched and deprecated |
| D5 | The task permission subsystem (5 tables) **remains** — it is the data-level assignment layer; RBAC is the capability layer above it |
| D6 | System roles: `system-admin` (full catalog, locked) + `member` (empty template) |
| D7 | Public API scopes/bindings untouched; synthesized actors carry `allow_rbac_resolution=False` — RBAC can never leak through an API token (test-locked) |

## 2. Data model (auth_db, additive create_all)

```
rbac_roles:      id, code (STABLE slug, unique), name, description,
                 permissions JSONB (list[str]), is_system, is_active
rbac_user_roles: user_id FK CASCADE, role_id FK RESTRICT,
                 UNIQUE(user_id, role_id), created_by
```
Roles attach directly to users (Hermes has no tenant/facility dimension —
LogiSlot's membership layer intentionally not copied). Effective
permissions = union of ACTIVE roles of an ACTIVE user ∩ catalog.

## 3. Permission catalog (shared/permissions.py)

Single source for both services; MCP never imports it (structural rule).
`ALL_PERMISSIONS` is **derived** from the class, never hand-maintained.

`users.manage · roles.manage · groups.manage · tasks.admin ·
tasks.permissions.manage · api.manage · reports.view · plans.manage ·
worklogs.admin · meetings.admin · customers.manage · projects.manage ·
reference.manage`

Mapping of the old surface: 82 `require_admin` guards (74 core + 6 auth +
2 reporting), 20 inline `is_admin` branches and the 16-site
`is_task_admin` shortcut (single definition → `tasks.admin`).

## 4. Resolution & enforcement

- **auth-service**: `rbac_service.effective_permissions` (DB),
  `require_permissions` / `require_any_permission` dependency factories.
  Role CRUD + assignment API under `/api/v1/auth/rbac/*`; S2S batch
  resolve at `/internal/authz/resolve` (same dual-key guard as the
  directory); own `/rbac/me` for any valid JWT.
- **core-service**: `services/authz_client.py` (S2S, 60s positive cache,
  `AuthzUnavailable` on failure) + `app/authz.py` guards. Two-level
  fail-closed: route guards → **503** on resolution outage (an admin
  action never runs with unknown authority), visibility checks
  (`user_has`) → **False** (users keep their normal scope; nothing
  opens). URL derivation goes through the shared normaliser
  (`shared/auth_upstream.py`) — the 2026-07-17 live-URL-bug lesson.
- **reporting-service**: `app/rbac.py` — caller's JWT forwarded to
  `/api/v1/auth/rbac/me` (no S2S secret there by policy). Also closes
  the old G10 defect (empty-token proxy on cookie-auth requests).
- **frontend**: `authStore.permissions` loaded from `/rbac/me` at boot
  and after login; `can()/canAny()` fail-closed. Routes, menu groups and
  page-level branches are permission-driven. Roles admin UI under
  Users → Roles (grouped checkbox editor); user role assignment in the
  user modal. Legacy `is_admin ? 'ADMIN' : role` display fallback
  removed.

## 5. LogiSlot lessons — adopted vs corrected

Adopted: permissions-as-JSON-on-role · dependency-factory guards ·
no permissions in JWT (instant revocation) · `/me` permission delivery ·
system-role lock · grouped-checkbox role editor · last-admin guard.

Corrected (LogiSlot weakness → Hermes behavior):
1. `role.manage` defined but never enforced (user.manage was de-facto
   full admin) → role CRUD really requires `roles.manage`.
2. No self-escalation guard → **subset rule**: an actor can neither
   create/extend a role with, nor assign roles containing, permissions
   the actor does not hold.
3. Deactivated role kept granting (silent security bug) → inactive
   roles grant nothing (test-locked), and are not assignable.
4. Migrations matched roles by NAME → stable `code` slug, all
   programmatic matching by code.
5. Manual `ALL` list + 6 sync points → derived `ALL`, catalog test-locked,
   bootstrap re-syncs system-admin to the catalog on every startup (no
   hand-written data migrations for new permissions).
6. No global default-deny → route-walk structural test: every /admin
   route must declare its permission or CI is red.
7. Duplicated default-role seeds → single bootstrap function.

## 6. Migration semantics (zero behavior change on day one)

Startup bootstrap (idempotent, fail-fast): create/sync `system-admin`
(full catalog) and `member`; assign `system-admin` to every
`is_admin=True` user; derive `is_admin` from the role. Legacy write
paths (`PUT /users/{id}` with `is_admin`, create) bridge to role
assignment; the last active system administrator can never be stripped,
deactivated or deleted (409). No manifest, secret or config changes:
core reuses the existing `hermes-s2s` credential; reporting already has
`AUTH_SERVICE_URL`.

Deployment note: auth-service should roll before/with core (core's
resolver 503s politely until `/internal/authz/resolve` exists).

## 7. Honest limitations

1. **Effective-permission latency in core is ≤60s** (S2S cache TTL) for
   *inline visibility* decisions; route guards also ride the same cache.
   Auth-side enforcement is immediate.
2. A user's own UI updates on refresh/boot — no live permission push;
   stale UI actions fail server-side (fail-closed).
3. The dead `role` enum column (`users.role`) still exists (additive
   rule); it is written by legacy sync but read by nothing.
4. In-memory authz cache is per-pod (same reality as the rate limiter).
