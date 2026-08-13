# Hermes → Drake: HTTP metrics (request rate, error ratio, p95)

Drake already gets CPU, memory, restarts and pod health from Kubernetes.
This document covers the part only the application can provide: request
rate, error ratio and p95 latency. The contract itself lives in
`HERMES_METRICS.md`; this file records what was implemented, why, and how
to roll it out.

## What each service emits

Two series, on every instrumented service:

```
http_server_requests_total{project,environment,service,status_class}          counter
http_server_request_duration_seconds{project,environment,service}             histogram (seconds)
```

| service | `project` | `environment` | `service` | `status_class` |
|---|---|---|---|---|
| core-service | `hermes` | `dev` / `test` | `core-service` | `2xx` `3xx` `4xx` `5xx` |
| auth-service | `hermes` | `dev` / `test` | `auth-service` | `2xx` `3xx` `4xx` `5xx` |
| reporting-service | `hermes` | `dev` / `test` | `reporting-service` | `2xx` `3xx` `4xx` `5xx` |
| hermes-mcp | `hermes` | `dev` / `test` | `hermes-mcp` | `2xx` `3xx` `4xx` `5xx` |

`environment` is the **catalog key**, read from the `HERMES_ENVIRONMENT`
env var set on each Deployment (`dev` in `hermes-dev`, `test` in
`hermes-test`). The existing `ENVIRONMENT` key in the `hermes-config`
ConfigMap is deliberately **not** used: it carries the value
`production` in `hermes-dev`.

No `pod`, `container`, `instance`, `route`, `path`, `method`, `tenant`,
`customer`, user or request identifier appears on either metric. The path
is aggregated away.

### Not instrumented

- **frontend** — a static nginx image serving the built SPA. It runs no
  application code that could emit the contract, and it does not proxy
  API traffic (the ingress routes `/api/*` straight to the backends), so
  every request a user makes is already counted by the service that
  handles it. Instrumenting it would mean adding an nginx exporter, which
  is a separate decision.
- **auth-db / core-db** — PostgreSQL, not HTTP servers.
- **CronJobs** (api-cleanup, task-auto-archive, backup) — batch jobs, no
  HTTP surface.
- **the retired `hermes` namespace** — out of scope by instruction;
  nothing in this repository targets it.

## Metrics port: 9090

`/metrics` is served on port **9090**, separate from each service's
application port (8000/8001/8002/8010), by a small daemon-thread WSGI
server from `prometheus_client`. Two reasons for a separate port rather
than a route on the application port:

1. The ingress only routes to the Services' port 80 → application port,
   so the metrics endpoint is structurally unreachable from outside the
   cluster. It is not a matter of no ingress rule currently matching
   `/metrics`.
2. A scrape still succeeds when the application event loop is busy, so
   Drake's `up` signal does not become a second latency alarm.

The port is overridable with `METRICS_PORT`, but the pod annotation and
the port must be changed together.

## Where the code lives

| file | role |
|---|---|
| `backend/shared/metrics.py` | middleware + metric definitions for auth / core / reporting |
| `backend/mcp-service/hermes_mcp/metrics.py` | independent copy for hermes-mcp |
| `backend/core-service/tests/test_metrics_contract.py` | full contract lock: labels, units, middleware behaviour, k8s manifests |
| `backend/auth-service/tests/test_metrics_contract.py` | auth-service wiring |
| `backend/mcp-service/tests/test_metrics_contract.py` | mcp wiring + parity with the shared copy |

`hermes_mcp` may not import `shared` (structural rule, locked by
`test_stage5a_mcp::test_runtime_imports_no_core_or_db`), so the contract
is implemented twice. `test_contract_is_identical_to_the_shared_implementation`
fails if the two copies ever drift.

Each module owns a private `CollectorRegistry`. Scrapes therefore carry
only the two contract metrics — no `process_*` / `python_gc_*` series,
which Kubernetes already provides — and the MCP test harness, which runs
core-service in the same process, cannot hit a duplicate-registration
error.

## Deliberate behaviour

- **`/health` is not measured.** Kubelet probes would otherwise dominate
  the request rate in both environments and, being fast, would drag p95
  down and hide real slowness.
- **Zero-valued series are pre-created at startup.** A Prometheus series
  only exists once written, so an idle environment with no 5xx would make
  the error-ratio query return "no data" — indistinguishable from broken
  instrumentation. The four status classes and the histogram are
  registered at 0 on boot.
- **An unset or wrong `HERMES_ENVIRONMENT` yields `environment="unknown"`,
  not a guess.** A namespace value (`hermes-dev`) is rejected. The series
  exists and is greppable, but never lands in a `dev`/`test` query
  pretending to work.
- **Measurement never breaks a request.** The middleware is raw ASGI: it
  neither reads nor buffers bodies, does not touch the response, and any
  error inside the observation itself is swallowed. Unhandled application
  exceptions propagate untouched (the outer `ServerErrorMiddleware` still
  produces the 500); the middleware only counts them as `5xx`.

## Rollout

Order matters: annotating a pod before its image can emit metrics gives a
scraped target that refuses the connection.

**1. Ship the code.** Merge to `dev`; CD runs the four gates and pins the
new immutable SHA on every Deployment.

**2. Patch the pod template** (annotations + `HERMES_ENVIRONMENT` + the
metrics containerPort). Use `patch`, never `kubectl apply -f` on these
files — applying reverts the running image to the mutable `:latest` /
`:dev` tag, as recorded in the manifest headers.

```bash
NS=hermes-dev; ENV=dev          # for the test namespace: NS=hermes-test; ENV=test

for D in auth-service core-service reporting-service hermes-mcp; do
  kubectl -n "$NS" patch deployment "$D" -p '{
    "spec":{"template":{
      "metadata":{"annotations":{
        "prometheus.io/scrape":"true",
        "prometheus.io/port":"9090",
        "prometheus.io/path":"/metrics"}},
      "spec":{"containers":[{
        "name":"'"$D"'",
        "ports":[{"containerPort":9090,"name":"metrics"}],
        "env":[{"name":"HERMES_ENVIRONMENT","value":"'"$ENV"'"}]}]}}}}'
  kubectl -n "$NS" rollout status "deployment/$D" --timeout=300s
done
```

The container name equals the deployment name for all four workloads, so
the strategic-merge patch keys correctly; `env` and `ports` merge by name
/ containerPort, leaving every existing entry in place.

**3. Verify the pod, not the Service.**

```bash
kubectl -n "$NS" get pod -l app=core-service \
  -o jsonpath='{.items[0].metadata.annotations}'; echo

kubectl -n "$NS" port-forward deploy/core-service 9090:9090 &
curl -s localhost:9090/metrics | grep '^http_server_requests_total'
```

Expected, before any traffic:

```
http_server_requests_total{environment="dev",project="hermes",service="core-service",status_class="2xx"} 0.0
... 3xx / 4xx / 5xx at 0.0
```

**4. Confirm the scrape.** `up{project="hermes",environment="dev"}` → 1,
then the three queries in `HERMES_METRICS.md`.

**5. Promote.** `git merge --ff-only origin/dev` into `test`, let CD
deploy, then repeat step 2 with `NS=hermes-test ENV=test`.

## Rollback

The instrumentation has no data path and no persistent state. Removing
the annotation stops the scrape; reverting the commit removes the
middleware and the metrics port. Neither affects request handling.
