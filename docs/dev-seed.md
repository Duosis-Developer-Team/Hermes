# Dev-only mock data seeder (hermes-dev)

Fills the `duosis` tenant on **hermes-dev** with realistic, date-relative
demo data so every screen of the redesigned frontend can be reviewed
(https://84.247.180.172:30772). It must never run on hermes-test.

Code: `backend/auth-service/app/jobs/dev_seed.py`,
`backend/core-service/app/jobs/dev_seed.py`, shared guard and id scheme in
`backend/shared/dev_seed.py`. Tests: `tests/test_dev_seed.py` in both services.

## Safety guard

Both scripts exit with code **2** before opening any database connection
unless **all** of the following hold:

| Check | hermes-dev | hermes-test |
|---|---|---|
| `--yes-dev` flag on the command line | required | — |
| `HERMES_ENVIRONMENT` env var (no default) | `dev` | `test` → refused |
| effective `PUBLIC_API_ENV` (core setting; auth reads the env var, default `dev`) | `dev` | `live` → refused |
| pod namespace from `/var/run/secrets/kubernetes.io/serviceaccount/namespace` (checked whenever `KUBERNETES_SERVICE_HOST` is set; cannot be overridden by env) | `hermes-dev` | `hermes-test` → refused |

## What gets written

* **auth_db**: 6 fake people (Ada Lovelace, Grace Hopper, Alan Turing,
  Katherine Johnson, Linus Torvalds, Margaret Hamilton) with
  `@hermes-demo.example.com` e-mails, no password, not admin — they cannot
  log in. Active `duosis` membership + `member` role. `example.com` is
  reserved by RFC 2606 and publishes a null MX, so no mail can be delivered;
  unlike `.invalid` (used before 2026-09-29) it passes e-mail syntax
  validation — a `.invalid` address made `GET /api/v1/auth/users` return 500
  on hermes-dev. Re-running the auth seeder moves already-existing demo
  users (matched by their marked id) to the current domain; the JSON summary
  reports this as `"updated": {"emails": N}`.
* **core_db** (tenant `duosis`): 5 customers, 10 projects (`DEMO-*` keys, two
  internal non-billable), 7 sub-projects, project members/leads, 2 user
  groups, routing relations (real users → demo users), ~60 work items across
  all workflow states plus 3 personal items (overdue / today / this week) for
  every real user, parent/child and links, reviewers/watchers, comments,
  activity events, in-app notifications for real users, work logs for the
  last 3 weeks + current week, absences, a part-time capacity override,
  2 plan times, ~20 meetings this and next week (overlapping, all-day and a
  cancelled one), and — only when the tenant is `HERMES_SUPPORT_TENANT_ID` —
  a demo "LogiSlot (Demo)" support application (no callback URL, so nothing
  is ever delivered outward) with 10 Ticket Hub tickets in every status,
  public messages, internal notes and resolutions.
* Real users are discovered at runtime from the auth directory (S2S
  credential already mounted in the core pod); no real e-mail is in the code.
  Fallback without the directory: user ids found in core tables.
* Existing reference data (work types) is reused; demo work types are
  created only if the tenant has none.

Every seeded row id is a deterministic uuid5 starting with `de5eed00-`.
Re-running is idempotent (existing ids are skipped; work logs are keyed by
user/day/project/description). Dates are relative to the day of the first
run; use `--reseed` to refresh them.

## Runbook (run by the operator from Termius — order matters)

Deployments: `auth-service` and `core-service` in namespace `hermes-dev`
(`k8s/03-backend-auth.yaml`, `k8s/03-backend-core.yaml`). The scripts ship in
the images, so the commit must be deployed to hermes-dev by CD first.

```bash
# 0) sanity: both must print "dev"
kubectl -n hermes-dev exec deploy/auth-service -- printenv HERMES_ENVIRONMENT
kubectl -n hermes-dev exec deploy/core-service -- printenv HERMES_ENVIRONMENT

# 1) seed: auth first (fake users), then core (business data)
kubectl -n hermes-dev exec deploy/auth-service -- python -m app.jobs.dev_seed --yes-dev
kubectl -n hermes-dev exec deploy/core-service -- python -m app.jobs.dev_seed --yes-dev

# refresh dates relative to today (purge + seed in one transaction)
kubectl -n hermes-dev exec deploy/core-service -- python -m app.jobs.dev_seed --yes-dev --reseed

# after a DEMO_EMAIL_DOMAIN change: auth re-run rewrites the demo users'
# e-mails in place; core copies of demo e-mails (meeting organizer/attendee,
# ticket requester) are only rewritten by --reseed (existing ids are skipped)
kubectl -n hermes-dev exec deploy/auth-service -- python -m app.jobs.dev_seed --yes-dev
kubectl -n hermes-dev exec deploy/core-service -- python -m app.jobs.dev_seed --yes-dev --reseed

# 2) remove: core first, then auth
kubectl -n hermes-dev exec deploy/core-service -- python -m app.jobs.dev_seed --yes-dev --purge
kubectl -n hermes-dev exec deploy/auth-service -- python -m app.jobs.dev_seed --yes-dev --purge
```

Each command prints a JSON summary (created / deleted counts). Exit codes:
`0` ok, `1` failure (transaction rolled back), `2` refused by the guard.

## Purge semantics

* Deletes rows whose id carries the `de5eed00-` marker **plus** rows that
  reference them through a foreign key (children first). This includes rows
  a person created through the UI on demo data — e.g. a comment on a demo
  work item or a work log booked on a demo project.
* `ON DELETE SET NULL` references are not followed: a real work log that
  points at a demo work item or meeting stays and its reference becomes NULL.
* Nothing else is touched. No DDL, no TRUNCATE. Consumed work-item / ticket
  numbers (`tenant_counters`) are not rolled back.
* Rows that reference demo users only by id (no FK, e.g. a real task later
  assigned to "Ada Lovelace") are left as-is after the auth purge.
