# Hermes → Drake: OpenTelemetry traces

Hermes emits distributed traces from inside the application with the
OpenTelemetry SDK and sends them over OTLP gRPC to Drake's collector
(`drake-otel-gateway.drake-otel.svc:4317`). Metrics (request rate, error
ratio, p95) are a separate contract: see `observability-metrics.md`.

## Why the SDK and not eBPF (OBI)

Drake's eBPF instrumentation (OBI) only sees processes on the node it runs
on, and it runs only on node2. Most of `hermes-test` (core, auth,
reporting, mcp and the databases) is scheduled on node1, the control-plane
node, which is already short on headroom (high iowait, etcd on the same
disk). The SDK produces the same traces from inside each pod, wherever it
is scheduled, without another privileged agent on node1.

## Scope

| service | traced | notes |
|---|---|---|
| core-service | yes | HTTP server, SQLAlchemy, outgoing httpx |
| auth-service | yes | HTTP server, SQLAlchemy, outgoing httpx |
| reporting-service | yes | HTTP server, outgoing httpx (no DB) |
| hermes-mcp | **not yet** | MCP has a test-locked "single upstream" guarantee; adding the telemetry endpoint needs that guarantee widened explicitly first |
| frontend, CronJobs, databases | no | static nginx, batch jobs, PostgreSQL |

The resource identity matches the metrics contract:

| attribute | value |
|---|---|
| `service.name` | `core-service` / `auth-service` / `reporting-service` |
| `service.namespace` | `hermes` |
| `deployment.environment.name` | `dev` / `test` (from `HERMES_ENVIRONMENT`, the catalog key) |
| `k8s.namespace.name`, `k8s.pod.name`, `k8s.node.name` | Downward API → `OTEL_RESOURCE_ATTRIBUTES` |
| `k8s.deployment.name` | literal per Deployment |
| `k8s.cluster.name` | added by the Drake gateway |

Drake's gateway does **not** run `k8sattributes` on traces, so the pod sets
its own `k8s.*` attributes.

## Coexisting with Datadog (deliberate)

The cluster runs Datadog single-step APM. Every Hermes pod gets `ddtrace`
injected by seven init containers. ddtrace writes and reads
`x-datadog-*` and W3C `traceparent`/`tracestate` headers. Datadog stays
exactly as it is: the company pays for it and relies on it. Hermes avoids
the conflict on its own side:

1. **Propagation is B3** (single `b3` header) by default. ddtrace neither
   writes nor reads B3 by default. The two tracers never overwrite or
   adopt each other's context: Datadog keeps its trace tree, Drake gets
   its own.
2. **No `FastAPIInstrumentor`.** ddtrace replaces Starlette's outermost
   middleware. `FastAPIInstrumentor` then logs "unexpected middleware
   stack" and **silently skips** the app (reproduced under `ddtrace-run`).
   Hermes installs the plain ASGI `OpenTelemetryMiddleware` and resolves
   the route template itself, including mounted sub-apps such as
   `/api/public`.
3. **The TracerProvider is passed explicitly** to every instrumentation.
   If ddtrace's OTel bridge were ever switched on, our spans would still
   go to Drake.

Verified locally with ddtrace 4.17 under `ddtrace-run`:
- Two services form one connected OTel trace.
- The downstream request carries `b3` (ours) next to untouched
  `x-datadog-*` and `traceparent` (Datadog's).
- No query string reaches any span.

**When Datadog is retired**, switch to W3C by setting
`OTEL_PROPAGATORS=tracecontext,baggage` on the Deployments. No code change.

## Guarantees (locked by `core-service/tests/test_tracing.py`)

- **Off unless configured.** With no `OTEL_EXPORTER_OTLP_ENDPOINT` (or
  `..._TRACES_ENDPOINT`), nothing is installed and no instrumentation is
  imported. `OTEL_SDK_DISABLED=true` and `OTEL_TRACES_EXPORTER=none`
  turn it off explicitly.
- **No leaks.**
  - Query strings, fragments and `user:password@` are stripped from URL
    attributes.
  - Request and response headers are not captured.
  - SQL is recorded as the parameterised statement only, without values.
  - The SQL commenter is off, so statements are never modified.
- **Bounded span names.** Spans are named by route template
  (`GET /api/public/v1/tasks/{task_id}`), never by raw path. An unmatched
  path is named by method only.
- **Not traced:** `/health`, `/ready`, `/metrics`. ASGI per-chunk
  `send`/`receive` spans are also dropped.
- **Never breaks a request or a startup.** Setup errors are caught and the
  service starts without traces. Export runs in a background thread; an
  unreachable collector drops spans. Shutdown flushing is capped at 3 s so
  pod termination does not hang.

## Code

| file | role |
|---|---|
| `backend/shared/tracing.py` | setup, sanitising, propagation, route naming, bounded shutdown |
| `backend/{core,auth,reporting}-service/app/main.py` | `setup_tracing(app, service=..., engine=...)` + `shutdown_tracing()` in lifespan |
| `backend/{core,auth,reporting}-service/requirements.txt` | pinned `opentelemetry-*` 1.45.2 / 0.66b2 |
| `k8s/03-backend-*.yaml`, `k8s/test/03-backend-*.yaml` | env wiring (record of intent; CD does not apply manifests) |

## Rollout

Shipping the code changes nothing on its own: without the endpoint env the
SDK stays off. Turn traces on per namespace with a `patch`. Never
`kubectl apply -f` these manifests: applying reverts the pinned image to a
mutable tag, and the test manifests drift from live.

**1. Patch (dev first).** `K8S_*` must come before
`OTEL_RESOURCE_ATTRIBUTES`; `$(VAR)` only expands variables defined
earlier.

```bash
NS=hermes-dev   # hermes-test only after the CTO's go

for D in auth-service core-service reporting-service; do
  kubectl -n "$NS" patch deployment "$D" -p '{
    "spec":{"template":{"spec":{"containers":[{
      "name":"'"$D"'",
      "env":[
        {"name":"OTEL_EXPORTER_OTLP_ENDPOINT","value":"http://drake-otel-gateway.drake-otel.svc:4317"},
        {"name":"K8S_POD_NAME","valueFrom":{"fieldRef":{"fieldPath":"metadata.name"}}},
        {"name":"K8S_NAMESPACE_NAME","valueFrom":{"fieldRef":{"fieldPath":"metadata.namespace"}}},
        {"name":"K8S_NODE_NAME","valueFrom":{"fieldRef":{"fieldPath":"spec.nodeName"}}},
        {"name":"OTEL_RESOURCE_ATTRIBUTES","value":"k8s.namespace.name=$(K8S_NAMESPACE_NAME),k8s.pod.name=$(K8S_POD_NAME),k8s.node.name=$(K8S_NODE_NAME),k8s.deployment.name='"$D"'"}
      ]}]}}}}' --dry-run=server -o jsonpath='{.spec.template.spec.containers[0].env[*].name}'; echo
done
# Check the order in the dry-run output, then re-run without --dry-run and:
#   kubectl -n "$NS" rollout status deployment/<D> --timeout=600s
# Datadog's init containers make rollouts slow; keep the timeout long.
```

**2. Verify.**
- The pod log shows `🔭 OpenTelemetry izleri acik (<service>)` and no
  `Failed to export` warnings.
- Drake shows traces for `service.namespace=hermes`, environment `dev`.

**3. Tell the Drake owner** to remove the namespace from OBI's
`discovery.instrument` allowlist. Otherwise requests from pods on node2 are
traced twice: OBI and the SDK do not share context.

**Kill switch** (instant, no image change):

```bash
kubectl -n "$NS" set env deployment/<D> OTEL_SDK_DISABLED=true
```
